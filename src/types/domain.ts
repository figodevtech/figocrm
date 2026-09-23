// src/types/domain.ts
// Tipos de Domínio Canônicos do SaaS Voice-First

export type UUID = string;

// --- 1. Usuário e Assinatura ---
export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'blocked';

export interface UserProfile {
  id: UUID;
  email: string;
  fullName: string;
  phone?: string;
  businessSegment?: string;
  subscriptionStatus: SubscriptionStatus;
  trialStartedAt: string;
  trialEndsAt: string;
  createdAt: string;
  updatedAt: string;
}

// --- 2. Cliente / Contraparte ---
export interface Customer {
  id: UUID;
  userId: UUID;
  name: string;
  phone?: string;
  document?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// --- 3. Mercadoria e Custos Agregados ---
export type ItemStatus =
  | 'disponivel'
  | 'em_preparacao'
  | 'reservado'
  | 'vendido'
  | 'devolvido';

export type ItemCostCategory =
  | 'pecas'
  | 'reparo'
  | 'estetica'
  | 'transporte'
  | 'documentacao'
  | 'outros';

export interface ItemCost {
  id: UUID;
  userId: UUID;
  itemId: UUID;
  category: ItemCostCategory;
  description: string;
  amount: number;
  costDate: string;
  createdAt: string;
}

export interface Item {
  id: UUID;
  userId: UUID;
  name: string;
  category?: string;
  description?: string;
  acquisitionCost: number;
  targetSalePrice?: number;
  status: ItemStatus;
  photoUrl?: string;
  acquiredAt: string;
  costs?: ItemCost[];
  totalCMV?: number; // Custo de aquisição + soma de custos agregados
  createdAt: string;
  updatedAt: string;
}

// --- 4. Negociação Principal e Itens ---
export type DealType =
  | 'venda'
  | 'compra'
  | 'troca'
  | 'renegociacao'
  | 'avulso';

export type DealStatus =
  | 'pendente'
  | 'concluida'
  | 'renegociada'
  | 'cancelada';

export type FlowDirection = 'IN' | 'OUT';

export interface DealItem {
  id: UUID;
  dealId: UUID;
  itemId: UUID;
  direction: FlowDirection;
  evaluatedValue: number;
  itemSnapshot?: Item;
  createdAt: string;
}

export interface Deal {
  id: UUID;
  userId: UUID;
  customerId: UUID;
  dealType: DealType;
  totalValue: number;
  recognizedProfit: number;
  status: DealStatus;
  notes?: string;
  source: 'voice' | 'manual';
  dealDate: string;
  items?: DealItem[];
  cashMovements?: CashMovement[];
  receivables?: Receivable[];
  payables?: Payable[];
  createdAt: string;
  updatedAt: string;
}

// --- 5. Caixa e Fluxo Monetário Imediato ---
export type PaymentMethod =
  | 'pix'
  | 'cash'
  | 'debit_card'
  | 'credit_card'
  | 'bank_transfer'
  | 'other';

export interface CashMovement {
  id: UUID;
  userId: UUID;
  dealId?: UUID;
  direction: FlowDirection;
  amount: number;
  paymentMethod: PaymentMethod;
  movementDate: string;
  description?: string;
  createdAt: string;
}

// --- 6. Recebíveis, Obrigações e Parcelas ---
export type ObligationStatus =
  | 'pending'
  | 'partially_paid'
  | 'paid'
  | 'renegotiated'
  | 'canceled';

export type InstallmentStatus =
  | 'pending'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'canceled';

export interface Installment {
  id: UUID;
  userId: UUID;
  receivableId?: UUID;
  payableId?: UUID;
  installmentNumber: number;
  totalInstallments: number;
  originalValue: number;
  paidValue: number;
  balance: number;
  dueDate: string;
  status: InstallmentStatus;
  isPromissory: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Receivable {
  id: UUID;
  userId: UUID;
  dealId: UUID;
  customerId: UUID;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: ObligationStatus;
  installments?: Installment[];
  createdAt: string;
  updatedAt: string;
}

export interface Payable {
  id: UUID;
  userId: UUID;
  dealId?: UUID;
  customerId: UUID;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: ObligationStatus;
  installments?: Installment[];
  createdAt: string;
  updatedAt: string;
}

// --- 7. Liquidações e Pagamentos ---
export interface Payment {
  id: UUID;
  userId: UUID;
  installmentId: UUID;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: string;
  notes?: string;
  createdAt: string;
}

// --- 8. Abatimentos e Ajustes Não-Monetários ---
export type AdjustmentType =
  | 'item_trade_in'     // Dação em pagamento de mercadoria
  | 'service_labor'     // Mão de obra / prestação de serviço
  | 'discount'          // Desconto concedido
  | 'write_off';        // Perdão negociado

export interface Adjustment {
  id: UUID;
  userId: UUID;
  dealId?: UUID;
  installmentId?: UUID;
  counterItemId?: UUID; // Item que entrou como abatimento
  adjustmentType: AdjustmentType;
  amount: number;
  reason?: string;
  createdAt: string;
}

// --- 9. Inteligência Artificial e Voz ---
export type ExecutionStatus =
  | 'executed'
  | 'requires_confirmation'
  | 'rejected'
  | 'failed';

export interface AIInteraction {
  id: UUID;
  userId: UUID;
  targetDealId?: UUID;
  spokenText: string;
  detectedIntent: string;
  extractedEntities: Record<string, unknown>;
  requiredConfirmation: boolean;
  confirmationPrompt?: string;
  executionStatus: ExecutionStatus;
  latencyMs?: number;
  createdAt: string;
}

// --- 10. Auditoria e Reversibilidade (Desfazer) ---
export type ActionType =
  | 'CREATE_SALE'
  | 'CREATE_PURCHASE'
  | 'CREATE_TRADE'
  | 'REGISTER_PAYMENT'
  | 'REGISTER_PARTIAL_PAYMENT'
  | 'REGISTER_ADJUSTMENT'
  | 'RENEGOTIATE_DEBT'
  | 'UPDATE_DUE_DATE'
  | 'CANCEL_DEAL'
  | 'ADD_ITEM_COST'
  | 'UNDO';

export interface AuditLogEntry {
  id: UUID;
  userId: UUID;
  entityName: string;
  entityId: UUID;
  actionType: ActionType;
  source: 'VOICE_AI' | 'MANUAL_WEB' | 'SYSTEM_JOB';
  payloadBefore?: Record<string, unknown>;
  payloadAfter?: Record<string, unknown>;
  createdAt: string;
}

// --- 11. Indicadores Principais da Home (Os 4 Pilares) ---
export interface DashboardIndicators {
  naRua: number;              // Total de recebíveis em aberto
  atrasado: number;           // Total de recebíveis com data vencida
  emMercadoria: number;       // Capital imobilizado em estoque (CMV acumulado)
  quantoGanhouMes: number;    // Lucro bruto apurado nas vendas do mês corrente
}
