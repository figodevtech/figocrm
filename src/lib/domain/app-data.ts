// src/lib/domain/app-data.ts
// Leituras das telas do app (somente leitura, sempre com o cliente Supabase do usuário → RLS).
// Não calcula saldo "na mão": saldos vêm das colunas mantidas pelas RPCs/triggers
// (receivables.balance, installments.balance). Aqui só agrupamos para exibir.

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatBRL } from '@/lib/format';
import { todayISO } from '@/lib/domain/loan-plan';
import {
  buildCustomerTimeline,
  debtLabel,
  installmentState,
  InstallmentStateKey,
  isOpenInstallment,
  itemStatusView,
  ItemStatusKey,
  TimelineEvent,
} from '@/lib/domain/views';
import type { DashboardIndicators } from '@/types/domain';

const n = (v: unknown) => Number(v ?? 0);
const LIST_LIMIT = 500;
export const ITEM_PHOTO_BUCKET = 'item-photos';

// ------------------------------------------------------------------ painel

export async function getDashboard(supabase: SupabaseClient, userId: string): Promise<DashboardIndicators | null> {
  const { data, error } = await supabase.rpc('get_dashboard_indicators', { p_user_id: userId });
  if (error || !data || !data[0]) return null;
  const row = data[0];
  return {
    naRua: n(row.na_rua),
    atrasado: n(row.atrasado),
    emMercadoria: n(row.em_mercadoria),
    quantoGanhouMes: n(row.quanto_ganhou_mes),
  };
}

export interface ProfileView {
  fullName: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  businessSegment: string | null;
  document: string | null;
  address: string | null;
}

export async function getProfile(supabase: SupabaseClient, userId: string, fallbackEmail = ''): Promise<ProfileView> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, email, phone, business_name, business_segment, document, address')
    .eq('id', userId)
    .maybeSingle();
  return {
    fullName: data?.full_name ?? '',
    email: data?.email ?? fallbackEmail,
    phone: data?.phone ?? null,
    businessName: data?.business_name ?? null,
    businessSegment: data?.business_segment ?? null,
    document: data?.document ?? null,
    address: data?.address ?? null,
  };
}

// ------------------------------------------------------------------ dívidas (receivables)

export interface InstallmentView {
  id: string;
  number: number;
  total: number;
  originalValue: number;
  paidValue: number;
  adjustedValue: number;
  balance: number;
  dueDate: string;
  status: string;
  state: InstallmentStateKey;
  stateLabel: string;
  open: boolean;
}

export interface DebtView {
  receivableId: string;
  kind: 'deal' | 'loan';
  dealId: string | null;
  loanContractId: string | null;
  label: string;
  totalAmount: number;
  balance: number;
  overdue: number;
  status: string;
  installments: InstallmentView[];
  nextInstallment: InstallmentView | null;
}

type ReceivableRow = {
  id: string;
  customer_id: string;
  deal_id: string | null;
  loan_contract_id: string | null;
  total_amount: number;
  balance: number;
  status: string;
  created_at: string;
  deals: { deal_type: string; deal_date: string; deal_items: Array<{ direction: string; items: { name: string } | null }> } | null;
  loan_contracts: { principal_amount: number } | null;
  installments?: Array<{
    id: string;
    installment_number: number;
    total_installments: number;
    original_value: number;
    paid_value: number;
    adjusted_value: number;
    balance: number;
    due_date: string;
    status: string;
  }>;
};

const RECEIVABLE_SELECT =
  'id, customer_id, deal_id, loan_contract_id, total_amount, balance, status, created_at, ' +
  'deals(deal_type, deal_date, deal_items(direction, items(name))), loan_contracts(principal_amount)';

function labelForReceivable(r: ReceivableRow): string {
  return debtLabel(
    {
      dealId: r.deal_id,
      loanContractId: r.loan_contract_id,
      itemsOut: (r.deals?.deal_items ?? []).filter((i) => i.direction === 'OUT' && i.items?.name).map((i) => i.items!.name),
      dealType: r.deals?.deal_type,
      dealDate: r.deals?.deal_date,
      loanPrincipal: r.loan_contracts ? n(r.loan_contracts.principal_amount) : null,
    },
    formatBRL
  );
}

function toInstallmentView(i: NonNullable<ReceivableRow['installments']>[number], today: string): InstallmentView {
  const base = {
    status: i.status,
    balance: n(i.balance),
    dueDate: i.due_date,
    paidValue: n(i.paid_value),
    adjustedValue: n(i.adjusted_value),
  };
  const state = installmentState(base, today);
  return {
    id: i.id,
    number: i.installment_number,
    total: i.total_installments,
    originalValue: n(i.original_value),
    paidValue: base.paidValue,
    adjustedValue: base.adjustedValue,
    balance: base.balance,
    dueDate: i.due_date,
    status: i.status,
    state: state.key,
    stateLabel: state.label,
    open: isOpenInstallment(base),
  };
}

function toDebtView(r: ReceivableRow, today: string): DebtView {
  const installments = (r.installments ?? [])
    .map((i) => toInstallmentView(i, today))
    .sort((a, b) => (a.dueDate === b.dueDate ? a.number - b.number : a.dueDate < b.dueDate ? -1 : 1));
  const open = installments.filter((i) => i.open);
  return {
    receivableId: r.id,
    kind: r.loan_contract_id ? 'loan' : 'deal',
    dealId: r.deal_id,
    loanContractId: r.loan_contract_id,
    label: labelForReceivable(r),
    totalAmount: n(r.total_amount),
    balance: n(r.balance),
    overdue: open.filter((i) => i.dueDate < today).reduce((acc, i) => acc + i.balance, 0),
    status: r.status,
    installments,
    nextInstallment: open[0] ?? null,
  };
}

/** Dívidas em aberto de um cliente (vendas e empréstimos), com as parcelas. */
export async function listOpenDebts(supabase: SupabaseClient, userId: string, customerId: string): Promise<DebtView[]> {
  const { data, error } = await supabase
    .from('receivables')
    .select(`${RECEIVABLE_SELECT}, installments(id, installment_number, total_installments, original_value, paid_value, adjusted_value, balance, due_date, status)`)
    .eq('user_id', userId)
    .eq('customer_id', customerId)
    .in('status', ['pending', 'partially_paid'])
    .gt('balance', 0)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Falha ao consultar dívidas: ${error.message}`);
  const today = todayISO();
  return ((data ?? []) as unknown as ReceivableRow[]).map((r) => toDebtView(r, today));
}

// ------------------------------------------------------------------ clientes

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
  document: string | null;
  owes: number;
  overdue: number;
  /** Criado pela voz sem cadastro: pode ser vinculado a outro cliente ou confirmado. */
  isProvisional: boolean;
}

export async function listCustomers(supabase: SupabaseClient, userId: string): Promise<CustomerListItem[]> {
  const today = todayISO();
  const [customersRes, receivablesRes, overdueRes] = await Promise.all([
    supabase.from('customers').select('id, name, phone, document, is_provisional').eq('user_id', userId).order('name').limit(LIST_LIMIT),
    supabase.from('receivables').select('customer_id, balance').eq('user_id', userId).in('status', ['pending', 'partially_paid']).gt('balance', 0),
    supabase
      .from('installments')
      .select('balance, receivables!inner(customer_id)')
      .eq('user_id', userId)
      .lt('due_date', today)
      .in('status', ['pending', 'partially_paid', 'overdue'])
      .gt('balance', 0),
  ]);
  if (customersRes.error) throw new Error(`Falha ao consultar clientes: ${customersRes.error.message}`);

  const owes = new Map<string, number>();
  for (const r of receivablesRes.data ?? []) owes.set(r.customer_id, (owes.get(r.customer_id) ?? 0) + n(r.balance));
  const overdue = new Map<string, number>();
  for (const i of (overdueRes.data ?? []) as unknown as Array<{ balance: number; receivables: { customer_id: string } }>) {
    const id = i.receivables?.customer_id;
    if (id) overdue.set(id, (overdue.get(id) ?? 0) + n(i.balance));
  }

  return (customersRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    document: c.document,
    owes: owes.get(c.id) ?? 0,
    overdue: overdue.get(c.id) ?? 0,
    isProvisional: !!c.is_provisional,
  }));
}

export interface CustomerDetail {
  customer: { id: string; name: string; phone: string | null; document: string | null; address: string | null; notes: string | null; is_provisional: boolean };
  owes: number;
  overdue: number;
  next: { dueDate: string; amount: number } | null;
  debts: DebtView[];
  timeline: TimelineEvent[];
}

export async function getCustomerDetail(supabase: SupabaseClient, userId: string, customerId: string): Promise<CustomerDetail | null> {
  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, phone, document, address, notes, is_provisional')
    .eq('id', customerId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!customer) return null;

  const [debts, allReceivables, deals, loans, settlements] = await Promise.all([
    listOpenDebts(supabase, userId, customerId),
    supabase.from('receivables').select(RECEIVABLE_SELECT).eq('user_id', userId).eq('customer_id', customerId).limit(LIST_LIMIT),
    supabase
      .from('deals')
      .select('id, deal_type, created_at, total_value, deal_items(direction, evaluated_value, items(name))')
      .eq('user_id', userId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('loan_contracts')
      .select('id, created_at, principal_amount, total_amount')
      .eq('user_id', userId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('settlements')
      .select('id, kind, amount, created_at, reversal_of, adjustment_type, payment_method, receivable_id, payable_id')
      .eq('user_id', userId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const receivableRows = (allReceivables.data ?? []) as unknown as ReceivableRow[];
  const debtLabels = Object.fromEntries(receivableRows.map((r) => [r.id, labelForReceivable(r)]));
  const receivableIds = receivableRows.map((r) => r.id);
  const renegotiations = receivableIds.length
    ? await supabase
        .from('renegotiations')
        .select('id, created_at, renegotiated_amount, new_count, receivable_id')
        .eq('user_id', userId)
        .in('receivable_id', receivableIds)
        .limit(100)
    : { data: [] };

  const today = todayISO();
  const openInstallments = debts.flatMap((d) => d.installments.filter((i) => i.open));
  const upcoming = openInstallments.filter((i) => i.dueDate >= today).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const nextInst = upcoming ?? openInstallments.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];

  return {
    customer,
    owes: debts.reduce((acc, d) => acc + d.balance, 0),
    overdue: debts.reduce((acc, d) => acc + d.overdue, 0),
    next: nextInst ? { dueDate: nextInst.dueDate, amount: nextInst.balance } : null,
    debts,
    timeline: buildCustomerTimeline({
      deals: (deals.data ?? []) as never,
      loans: (loans.data ?? []) as never,
      settlements: (settlements.data ?? []) as never,
      renegotiations: (renegotiations.data ?? []) as never,
      debtLabels,
    }),
  };
}

// ------------------------------------------------------------------ estoque

export interface StockItemView {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  identifier: string | null;
  imei: string | null;
  serialNumber: string | null;
  plate: string | null;
  modelYear: number | null;
  description: string | null;
  acquisitionCost: number;
  extraCosts: number;
  totalCost: number;
  targetSalePrice: number | null;
  status: string;
  statusKey: ItemStatusKey;
  statusLabel: string;
  receivedInTrade: boolean;
  /** Vendida sem estar no estoque: pode ser vinculada a uma mercadoria do estoque ou confirmada. */
  isProvisional: boolean;
  /** Custo não informado: o lucro da venda ainda não conta. */
  costPending: boolean;
  photoPath: string | null;
  photoUrl: string | null;
  createdAt: string;
}

type ItemRow = {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  identifier: string | null;
  imei: string | null;
  serial_number: string | null;
  plate: string | null;
  model_year: number | null;
  description: string | null;
  acquisition_cost: number;
  target_sale_price: number | null;
  status: string;
  photo_url: string | null;
  created_at: string;
  is_provisional: boolean;
  cost_pending: boolean;
  item_costs?: Array<{ amount: number }>;
  deal_items?: Array<{ direction: string }>;
};

const ITEM_SELECT =
  'id, name, category, brand, model, identifier, imei, serial_number, plate, model_year, description, acquisition_cost, ' +
  'target_sale_price, status, photo_url, created_at, is_provisional, cost_pending, item_costs(amount), deal_items(direction)';

async function signedPhotoUrls(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const storagePaths = paths.filter((p) => p && !/^https?:\/\//.test(p));
  for (const p of paths) if (/^https?:\/\//.test(p)) map.set(p, p);
  if (storagePaths.length === 0) return map;
  try {
    const { data } = await supabase.storage.from(ITEM_PHOTO_BUCKET).createSignedUrls(storagePaths, 60 * 60);
    for (const entry of data ?? []) if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl);
  } catch {
    // Sem bucket configurado: lista continua sem foto
  }
  return map;
}

function toStockItem(r: ItemRow, photos: Map<string, string>): StockItemView {
  const extra = (r.item_costs ?? []).reduce((acc, c) => acc + n(c.amount), 0);
  const receivedInTrade = (r.deal_items ?? []).some((d) => d.direction === 'IN');
  const status = itemStatusView(r.status, receivedInTrade);
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    brand: r.brand,
    model: r.model,
    identifier: r.identifier,
    imei: r.imei,
    serialNumber: r.serial_number,
    plate: r.plate,
    modelYear: r.model_year,
    description: r.description,
    acquisitionCost: n(r.acquisition_cost),
    extraCosts: extra,
    totalCost: n(r.acquisition_cost) + extra,
    targetSalePrice: r.target_sale_price === null ? null : n(r.target_sale_price),
    status: r.status,
    statusKey: status.key,
    statusLabel: status.label,
    receivedInTrade,
    isProvisional: !!r.is_provisional,
    costPending: !!r.cost_pending,
    photoPath: r.photo_url,
    photoUrl: r.photo_url ? photos.get(r.photo_url) ?? null : null,
    createdAt: r.created_at,
  };
}

export async function listStock(supabase: SupabaseClient, userId: string, statuses?: string[]): Promise<StockItemView[]> {
  let query = supabase.from('items').select(ITEM_SELECT).eq('user_id', userId);
  if (statuses && statuses.length > 0) query = query.in('status', statuses);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) throw new Error(`Falha ao consultar estoque: ${error.message}`);
  const rows = (data ?? []) as unknown as ItemRow[];
  const photos = await signedPhotoUrls(supabase, rows.map((r) => r.photo_url).filter(Boolean) as string[]);
  return rows.map((r) => toStockItem(r, photos));
}

export interface ItemDetail {
  item: StockItemView;
  costs: Array<{ id: string; category: string; description: string; amount: number; costDate: string }>;
  origin: { dealId: string; customerId: string; customerName: string; date: string } | null;
  sale: { dealId: string; customerId: string; customerName: string; date: string; value: number } | null;
}

export async function getItemDetail(supabase: SupabaseClient, userId: string, itemId: string): Promise<ItemDetail | null> {
  const { data } = await supabase.from('items').select(ITEM_SELECT).eq('id', itemId).eq('user_id', userId).maybeSingle();
  if (!data) return null;
  const row = data as unknown as ItemRow;

  const [costs, movements, photos] = await Promise.all([
    supabase.from('item_costs').select('id, category, description, amount, cost_date').eq('item_id', itemId).eq('user_id', userId).order('created_at'),
    supabase.from('deal_items').select('direction, evaluated_value, deals(id, deal_date, customer_id, customers(name))').eq('item_id', itemId),
    signedPhotoUrls(supabase, row.photo_url ? [row.photo_url] : []),
  ]);

  type Movement = { direction: string; evaluated_value: number; deals: { id: string; deal_date: string; customer_id: string; customers: { name: string } | null } | null };
  const moves = (movements.data ?? []) as unknown as Movement[];
  const inMove = moves.find((m) => m.direction === 'IN' && m.deals);
  const outMove = moves.find((m) => m.direction === 'OUT' && m.deals);

  return {
    item: toStockItem(row, photos),
    costs: (costs.data ?? []).map((c) => ({ id: c.id, category: c.category, description: c.description, amount: n(c.amount), costDate: c.cost_date })),
    origin: inMove?.deals
      ? { dealId: inMove.deals.id, customerId: inMove.deals.customer_id, customerName: inMove.deals.customers?.name ?? '', date: inMove.deals.deal_date }
      : null,
    sale: outMove?.deals
      ? { dealId: outMove.deals.id, customerId: outMove.deals.customer_id, customerName: outMove.deals.customers?.name ?? '', date: outMove.deals.deal_date, value: n(outMove.evaluated_value) }
      : null,
  };
}

// ------------------------------------------------------------------ negócios

export interface DealCardView {
  id: string;
  type: 'venda' | 'troca' | 'compra' | 'outro';
  typeLabel: string;
  title: string;
  customerId: string;
  customerName: string;
  date: string;
  totalValue: number;
  received: number;
  paid: number;
  toReceive: number;
  toPay: number;
}

export async function listDeals(supabase: SupabaseClient, userId: string): Promise<DealCardView[]> {
  const { data, error } = await supabase
    .from('deals')
    .select(
      'id, deal_type, deal_date, created_at, total_value, customer_id, customers(name), deal_items(direction, items(name)), ' +
        'receivables(balance), payables(balance), cash_movements(direction, amount, reversal_of)'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw new Error(`Falha ao consultar negócios: ${error.message}`);

  type Row = {
    id: string;
    deal_type: string;
    deal_date: string;
    total_value: number;
    customer_id: string;
    customers: { name: string } | null;
    deal_items: Array<{ direction: string; items: { name: string } | null }>;
    receivables: Array<{ balance: number }>;
    payables: Array<{ balance: number }>;
    cash_movements: Array<{ direction: string; amount: number; reversal_of: string | null }>;
  };

  return ((data ?? []) as unknown as Row[]).map((d) => {
    const out = d.deal_items.filter((i) => i.direction === 'OUT').map((i) => i.items?.name).filter(Boolean).join(' + ');
    const inn = d.deal_items.filter((i) => i.direction === 'IN').map((i) => i.items?.name).filter(Boolean).join(' + ');
    const sum = (dir: string, reversal: boolean) =>
      d.cash_movements.filter((c) => c.direction === dir && !!c.reversal_of === reversal).reduce((acc, c) => acc + n(c.amount), 0);
    const type = (['venda', 'troca', 'compra'].includes(d.deal_type) ? d.deal_type : 'outro') as DealCardView['type'];
    return {
      id: d.id,
      type,
      typeLabel: type === 'venda' ? 'Venda' : type === 'troca' ? 'Troca' : type === 'compra' ? 'Compra' : 'Negócio',
      title: type === 'troca' ? `${out || '?'} ⇄ ${inn || '?'}` : type === 'compra' ? inn || 'Mercadoria' : out || 'Negócio',
      customerId: d.customer_id,
      customerName: d.customers?.name ?? '',
      date: d.deal_date,
      totalValue: n(d.total_value),
      // Estorno de recebimento gera saída ligada ao original: entra no líquido
      received: sum('IN', false) - sum('OUT', true),
      paid: sum('OUT', false) - sum('IN', true),
      toReceive: d.receivables.reduce((acc, r) => acc + n(r.balance), 0),
      toPay: d.payables.reduce((acc, p) => acc + n(p.balance), 0),
    };
  });
}

// ------------------------------------------------------------------ empréstimos

export interface LoanView {
  id: string;
  customerId: string;
  customerName: string;
  principal: number;
  interestType: string;
  interestRate: number | null;
  interestAmount: number;
  total: number;
  paid: number;
  balance: number;
  overdue: number;
  installmentsCount: number;
  startDate: string;
  status: string;
  statusLabel: string;
  notes: string | null;
  receivableId: string | null;
  installments: InstallmentView[];
  nextInstallment: InstallmentView | null;
}

type LoanRow = {
  id: string;
  customer_id: string;
  principal_amount: number;
  interest_type: string;
  interest_rate: number | null;
  interest_amount: number;
  total_amount: number;
  installments_count: number;
  start_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  customers: { name: string } | null;
  receivables: Array<{
    id: string;
    balance: number;
    status: string;
    installments: NonNullable<ReceivableRow['installments']>;
  }>;
};

const LOAN_SELECT =
  'id, customer_id, principal_amount, interest_type, interest_rate, interest_amount, total_amount, installments_count, start_date, status, notes, created_at, ' +
  'customers(name), receivables(id, balance, status, installments(id, installment_number, total_installments, original_value, paid_value, adjusted_value, balance, due_date, status))';

function toLoanView(l: LoanRow, today: string): LoanView {
  const receivable = l.receivables?.[0];
  const installments = (receivable?.installments ?? [])
    .map((i) => toInstallmentView(i, today))
    .sort((a, b) => (a.dueDate === b.dueDate ? a.number - b.number : a.dueDate < b.dueDate ? -1 : 1));
  const open = installments.filter((i) => i.open);
  const balance = receivable ? n(receivable.balance) : 0;
  const overdue = open.filter((i) => i.dueDate < today).reduce((acc, i) => acc + i.balance, 0);
  const statusLabel = l.status === 'paid' || balance <= 0 ? 'Quitado' : l.status === 'canceled' ? 'Cancelado' : overdue > 0 ? 'Atrasado' : 'Em dia';
  return {
    id: l.id,
    customerId: l.customer_id,
    customerName: l.customers?.name ?? '',
    principal: n(l.principal_amount),
    interestType: l.interest_type,
    interestRate: l.interest_rate === null ? null : n(l.interest_rate),
    interestAmount: n(l.interest_amount),
    total: n(l.total_amount),
    paid: n(l.total_amount) - balance,
    balance,
    overdue,
    installmentsCount: l.installments_count,
    startDate: l.start_date,
    status: l.status,
    statusLabel,
    notes: l.notes,
    receivableId: receivable?.id ?? null,
    installments,
    nextInstallment: open[0] ?? null,
  };
}

export async function listLoans(supabase: SupabaseClient, userId: string): Promise<LoanView[]> {
  const { data, error } = await supabase.from('loan_contracts').select(LOAN_SELECT).eq('user_id', userId).order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) throw new Error(`Falha ao consultar empréstimos: ${error.message}`);
  const today = todayISO();
  return ((data ?? []) as unknown as LoanRow[]).map((l) => toLoanView(l, today));
}

export async function getLoanDetail(supabase: SupabaseClient, userId: string, loanId: string): Promise<LoanView | null> {
  const { data } = await supabase.from('loan_contracts').select(LOAN_SELECT).eq('id', loanId).eq('user_id', userId).maybeSingle();
  return data ? toLoanView(data as unknown as LoanRow, todayISO()) : null;
}

// ------------------------------------------------------------------ seletores de formulário

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  owes: number;
  isProvisional?: boolean;
}

export async function listCustomerOptions(supabase: SupabaseClient, userId: string): Promise<CustomerOption[]> {
  const list = await listCustomers(supabase, userId);
  return list.map((c) => ({ id: c.id, name: c.name, phone: c.phone, owes: c.owes, isProvisional: c.isProvisional }));
}

export interface ItemOption {
  id: string;
  name: string;
  detail: string;
  totalCost: number;
  targetSalePrice: number | null;
  /** Mercadoria que não está no estoque (descrita na hora da venda/troca). */
  isNew?: boolean;
  /** Custo informado para a mercadoria nova; ausente = custo pendente. */
  knownCost?: number;
}

export interface ReviewCounts {
  provisionalCustomers: number;
  provisionalItems: number;
  costPending: number;
}

/** O que a voz registrou como avulso ou sem custo e o usuário ainda pode completar. */
export async function getReviewCounts(supabase: SupabaseClient, userId: string): Promise<ReviewCounts> {
  const count = async (table: 'customers' | 'items', column: 'is_provisional' | 'cost_pending') => {
    const { count: n } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId).eq(column, true);
    return n ?? 0;
  };
  const [provisionalCustomers, provisionalItems, costPending] = await Promise.all([
    count('customers', 'is_provisional'),
    count('items', 'is_provisional'),
    count('items', 'cost_pending'),
  ]);
  return { provisionalCustomers, provisionalItems, costPending };
}

export async function listAvailableItemOptions(supabase: SupabaseClient, userId: string): Promise<ItemOption[]> {
  const items = await listStock(supabase, userId, ['disponivel']);
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    detail: [i.brand, i.model, i.imei ? `IMEI ${i.imei}` : null, i.plate ? `Placa ${i.plate}` : null].filter(Boolean).join(' · '),
    totalCost: i.totalCost,
    targetSalePrice: i.targetSalePrice,
  }));
}
