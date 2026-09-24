// src/lib/domain/views.ts
// Traduções e visões puras (sem banco) usadas pelas telas: status em português, rótulo de dívida,
// estado da parcela e histórico (timeline) do cliente. Nenhuma regra financeira nova: só leitura.

import type { PaymentMethod } from '@/types/domain';
import { formatBRL } from '@/lib/format';

// ------------------------------------------------------------------ mercadoria

export type ItemStatusKey = 'available' | 'reserved' | 'sold' | 'trade_in' | 'preparing' | 'returned';

const ITEM_STATUS: Record<string, { key: ItemStatusKey; label: string }> = {
  disponivel: { key: 'available', label: 'Disponível' },
  reservado: { key: 'reserved', label: 'Reservado' },
  vendido: { key: 'sold', label: 'Vendido' },
  em_preparacao: { key: 'preparing', label: 'Em preparação' },
  devolvido: { key: 'returned', label: 'Devolvido' },
};

/** Item disponível que entrou numa troca aparece como "Recebido em troca". */
export function itemStatusView(status: string, receivedInTrade = false): { key: ItemStatusKey; label: string } {
  if (status === 'disponivel' && receivedInTrade) return { key: 'trade_in', label: 'Recebido em troca' };
  return ITEM_STATUS[status] ?? { key: 'available', label: status };
}

export const COST_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'reparo', label: 'Conserto' },
  { value: 'transporte', label: 'Frete' },
  { value: 'pecas', label: 'Peça' },
  { value: 'documentacao', label: 'Documentação' },
  { value: 'servico', label: 'Serviço' },
  { value: 'estetica', label: 'Estética' },
  { value: 'outros', label: 'Outro' },
];

export function costCategoryLabel(value: string): string {
  return COST_CATEGORIES.find((c) => c.value === value)?.label ?? 'Outro';
}

// ------------------------------------------------------------------ pagamento

export const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'pix', label: 'Pix' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'credit_card', label: 'Cartão' },
  { value: 'bank_transfer', label: 'Transferência' },
];

export function paymentMethodLabel(value: string | null | undefined): string {
  if (value === 'debit_card') return 'Cartão';
  return PAYMENT_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? 'Outro';
}

// ------------------------------------------------------------------ parcelas

export type InstallmentStateKey = 'paid' | 'partial' | 'overdue' | 'pending' | 'renegotiated' | 'canceled';

export interface InstallmentLike {
  status: string;
  balance: number;
  dueDate: string;
  paidValue?: number;
  adjustedValue?: number;
}

/** Estado da parcela para a tela: vencida é calculada pela data (o banco só marca por job). */
export function installmentState(inst: InstallmentLike, today: string): { key: InstallmentStateKey; label: string } {
  if (inst.status === 'renegotiated') return { key: 'renegotiated', label: 'Renegociada' };
  if (inst.status === 'canceled') return { key: 'canceled', label: 'Cancelada' };
  if (inst.status === 'paid' || inst.balance <= 0) return { key: 'paid', label: 'Pago' };
  if (inst.dueDate < today) return { key: 'overdue', label: 'Atrasada' };
  if ((inst.paidValue ?? 0) + (inst.adjustedValue ?? 0) > 0 || inst.status === 'partially_paid') return { key: 'partial', label: 'Pago em parte' };
  return { key: 'pending', label: 'Em aberto' };
}

export function isOpenInstallment(inst: { status: string; balance: number }): boolean {
  return inst.balance > 0 && !['paid', 'canceled', 'renegotiated'].includes(inst.status);
}

// ------------------------------------------------------------------ dívida

export interface DebtOrigin {
  dealId?: string | null;
  loanContractId?: string | null;
  itemsOut?: string[];
  dealType?: string | null;
  dealDate?: string | null;
  loanPrincipal?: number | null;
}

/** Nome curto da dívida para o usuário: a mercadoria vendida ou "Empréstimo". */
export function debtLabel(origin: DebtOrigin, formatMoney: (v: number) => string): string {
  if (origin.loanContractId) {
    return origin.loanPrincipal ? `Empréstimo de ${formatMoney(origin.loanPrincipal)}` : 'Empréstimo';
  }
  if (origin.itemsOut && origin.itemsOut.length > 0) return origin.itemsOut.join(' + ');
  if (origin.dealDate) {
    const [, m, d] = origin.dealDate.split('-');
    return `${origin.dealType === 'troca' ? 'Troca' : 'Negócio'} de ${d}/${m}`;
  }
  return 'Negócio';
}

// ------------------------------------------------------------------ histórico do cliente

export type TimelineKind = 'sale' | 'trade' | 'purchase' | 'loan' | 'payment' | 'adjustment' | 'reversal' | 'renegotiation' | 'deal';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  /** Valor em reais (sempre positivo; o sinal vem de `direction`). */
  amount: number;
  /** in = dinheiro/valor que entrou para o usuário; out = saiu; none = neutro. */
  direction: 'in' | 'out' | 'none';
  detail?: string;
}

export interface TimelineDealRow {
  id: string;
  deal_type: string;
  created_at: string;
  total_value: number;
  deal_items?: Array<{ direction: string; evaluated_value?: number; items?: { name: string } | null }>;
}

export interface TimelineLoanRow {
  id: string;
  created_at: string;
  principal_amount: number;
  total_amount: number;
}

export interface TimelineSettlementRow {
  id: string;
  kind: 'payment' | 'adjustment';
  amount: number;
  created_at: string;
  reversal_of: string | null;
  adjustment_type?: string | null;
  payment_method?: string | null;
  receivable_id?: string | null;
  payable_id?: string | null;
}

export interface TimelineRenegotiationRow {
  id: string;
  created_at: string;
  renegotiated_amount: number;
  new_count: number;
  receivable_id?: string | null;
}

const ADJUSTMENT_LABEL: Record<string, string> = {
  item_trade_in: 'Abatimento com mercadoria',
  service_labor: 'Abatimento com serviço',
  discount: 'Desconto',
  write_off: 'Abatimento',
};

export function buildCustomerTimeline(input: {
  deals?: TimelineDealRow[];
  loans?: TimelineLoanRow[];
  settlements?: TimelineSettlementRow[];
  renegotiations?: TimelineRenegotiationRow[];
  /** receivable_id → rótulo da dívida ("iPhone 13", "Empréstimo de R$ 2.000"). */
  debtLabels?: Record<string, string>;
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const labelFor = (receivableId?: string | null) => (receivableId && input.debtLabels?.[receivableId]) || undefined;

  for (const d of input.deals ?? []) {
    const out = (d.deal_items ?? []).filter((i) => i.direction === 'OUT').map((i) => i.items?.name).filter(Boolean) as string[];
    const inn = (d.deal_items ?? []).filter((i) => i.direction === 'IN').map((i) => i.items?.name).filter(Boolean) as string[];
    const total = Number(d.total_value);
    if (d.deal_type === 'troca') {
      events.push({ id: `deal:${d.id}`, at: d.created_at, kind: 'trade', title: `Troca — ${out.join(' + ') || '?'} por ${inn.join(' + ') || '?'}`, amount: total, direction: 'none' });
    } else if (d.deal_type === 'compra') {
      events.push({ id: `deal:${d.id}`, at: d.created_at, kind: 'purchase', title: `Compra — ${inn.join(' + ') || 'mercadoria'}`, amount: total, direction: 'out' });
    } else if (d.deal_type === 'venda') {
      events.push({ id: `deal:${d.id}`, at: d.created_at, kind: 'sale', title: `Venda — ${out.join(' + ') || 'mercadoria'}`, amount: total, direction: 'none' });
    } else {
      events.push({ id: `deal:${d.id}`, at: d.created_at, kind: 'deal', title: 'Negócio', amount: total, direction: 'none' });
    }
  }

  for (const l of input.loans ?? []) {
    const principal = Number(l.principal_amount);
    const total = Number(l.total_amount);
    events.push({
      id: `loan:${l.id}`,
      at: l.created_at,
      kind: 'loan',
      title: 'Empréstimo',
      amount: principal,
      direction: 'out',
      detail: total > principal ? `Volta com juros: ${formatBRL(total)}` : undefined,
    });
  }

  for (const s of input.settlements ?? []) {
    const amount = Number(s.amount);
    const debt = labelFor(s.receivable_id);
    if (s.reversal_of) {
      events.push({
        id: `settlement:${s.id}`,
        at: s.created_at,
        kind: 'reversal',
        title: s.kind === 'payment' ? 'Estorno de pagamento' : 'Estorno de abatimento',
        amount,
        direction: s.kind === 'payment' && s.receivable_id ? 'out' : 'none',
        detail: debt,
      });
    } else if (s.kind === 'payment') {
      events.push({
        id: `settlement:${s.id}`,
        at: s.created_at,
        kind: 'payment',
        title: s.receivable_id ? 'Pagamento' : 'Pagamento feito por você',
        amount,
        direction: s.receivable_id ? 'in' : 'out',
        detail: debt,
      });
    } else {
      events.push({
        id: `settlement:${s.id}`,
        at: s.created_at,
        kind: 'adjustment',
        title: ADJUSTMENT_LABEL[s.adjustment_type ?? ''] ?? 'Abatimento',
        amount,
        direction: 'none',
        detail: debt,
      });
    }
  }

  for (const r of input.renegotiations ?? []) {
    events.push({
      id: `reneg:${r.id}`,
      at: r.created_at,
      kind: 'renegotiation',
      title: `Renegociação em ${r.new_count}x`,
      amount: Number(r.renegotiated_amount),
      direction: 'none',
      detail: labelFor(r.receivable_id),
    });
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** "Hoje", "Ontem" ou "10/09" (com ano quando não é o corrente). `at` e `today` no fuso local do usuário. */
export function timelineDayLabel(atISO: string, todayISO: string): string {
  const day = atISO.slice(0, 10);
  if (day === todayISO) return 'Hoje';
  const [y, m, d] = todayISO.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  if (day === yesterday) return 'Ontem';
  const [yy, mm, dd] = day.split('-');
  return yy === todayISO.slice(0, 4) ? `${dd}/${mm}` : `${dd}/${mm}/${yy}`;
}

/** Converte timestamp do banco para a data no fuso do Brasil (YYYY-MM-DD). */
export function toLocalDate(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts));
}
