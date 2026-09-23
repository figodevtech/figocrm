# Arquitetura das Ações do Sistema e Camada de Serviços (FASE 7)

## 1. Princípio da Ação Unificada

Tanto a **interface visual** (botões, formulários, modais) quanto o **assistente de voz** (IA via LLM) executam exatamente as mesmas funções de backend (*Command Pattern*).

```text
[Interface Visual Web/PWA] ───┐
                              ▼
                      ┌───────────────┐
                      │ Action Engine │ ──► [Validações] ──► [PostgreSQL + RLS]
                      └───────────────┘                          │
                              ▲                                  ▼
[Voz / LLM Structured Output] ┘                             [Audit Log]
```

### 1.1 Checklist de Toda Ação
1. **Autenticação:** Validar `auth.uid()` via sessão Supabase.
2. **Assinatura:** Verificar se `subscription_status` permite operações de escrita (trial ativo ou assinatura paga).
3. **Validação de Schema:** Validar tipos e regras de domínio (ex: valores positivos, IDs válidos).
4. **Validação Financeira:** Conferir equações de balanço (entradas = saídas).
5. **Transação Atômica:** Executar todas as mutações no banco dentro de um bloco transacional (`BEGIN ... COMMIT`).
6. **Auditoria:** Gravar snapshot `payload_before` e `payload_after` em `audit_log` para viabilizar o comando **Desfazer**.
7. **Resposta Determinística:** Retornar resumo padronizado com texto amigável e deltas de caixa e recebíveis.

---

## 2. Catálogo Canônico de Comandos

### 2.1 `create_customer`
- **Entrada:** `{ name: string, phone?: string, document?: string, notes?: string }`
- **Ação:** Cadastra cliente vinculado ao `user_id`. Se telefone já existir para o mesmo usuário, retorna o cliente existente.

### 2.2 `create_item`
- **Entrada:** `{ name: string, category?: string, acquisitionCost: number, targetSalePrice?: number, status?: ItemStatus }`
- **Ação:** Cria registro de estoque com status inicial `disponivel` ou `em_preparacao`.

### 2.3 `register_purchase`
- **Entrada:** `{ supplierName: string, itemName: string, cost: number, paymentMethod: PaymentMethod, isCredit?: boolean, dueDate?: string }`
- **Ação:**
  - Cadastra ou busca fornecedor como `Customer`.
  - Cadastra o item com `acquisition_cost = cost`.
  - Se pago no ato: registra `cash_movements` (OUT).
  - Se a prazo: registra `payables` com vencimento futuro.

### 2.4 `create_sale`
- **Entrada:**
  ```typescript
  {
    customerId: string;
    itemId: string;
    totalValue: number;
    upfrontPayments?: Array<{ amount: number; paymentMethod: PaymentMethod }>;
    receivable?: {
      totalAmount: number;
      installmentsCount: number;
      installmentValue: number;
      firstDueDate?: string;
      intervalDays?: number;
      dueDayOfMonth?: number;
      isPromissory?: boolean;
    };
  }
  ```
- **Ação:**
  - Atualiza item para status `vendido`.
  - Apura CMV do item e calcula `recognized_profit = totalValue - CMV`.
  - Cria `deal` (tipo: `'venda'`).
  - Cria movimentações imediatas de caixa (`cash_movements` IN).
  - Cria `receivables` e gera `installments` com o motor financeiro determinístico.

### 2.5 `create_trade` (Permuta com ou sem volta)
- **Entrada:**
  ```typescript
  {
    customerId: string;
    itemOutId: string;
    itemIn: { name: string; evaluatedValue: number; category?: string };
    tradeBalance: number; // Diferença em dinheiro
    direction: 'received' | 'paid' | 'even';
    immediateCash?: { amount: number; paymentMethod: PaymentMethod };
    installments?: { count: number; value: number; dueDay?: number };
  }
  ```
- **Ação:**
  - Baixa `itemOut` como vendido/permutado.
  - Cadastra `itemIn` no estoque com custo de entrada igual ao seu valor avaliado.
  - Reconhece lucro sobre a saída do `itemOut`.
  - Processa a volta (caixa ou recebível/conta a pagar).

### 2.6 `register_payment` e `register_partial_payment`
- **Entrada:** `{ installmentId: string; amount: number; paymentMethod: PaymentMethod; notes?: string }`
- **Ação:**
  - Registra linha em `payments`.
  - Trigger automático recalcula saldo da parcela e do receivable, atualizando status.
  - Registra entrada de caixa (`cash_movements` IN).

### 2.7 `register_adjustment` (Abatimento não-monetário)
- **Entrada:**
  ```typescript
  {
    customerId: string;
    dealId?: string;
    installmentId?: string;
    adjustmentType: 'item_trade_in' | 'service_labor' | 'discount' | 'write_off';
    amount: number;
    reason: string;
    counterItem?: { name: string; evaluatedValue: number };
  }
  ```
- **Ação:**
  - Se `counterItem`: cadastra o novo bem no estoque.
  - Registra em `adjustments`.
  - Amortiza o saldo devedor do cliente/parcela **sem transitar caixa físico**.

### 2.8 `renegotiate_debt`
- **Entrada:** `{ dealId: string; consolidatedAmount: number; newInstallmentsCount: number; newDueDates: string[] }`
- **Ação:**
  - Inativa parcelas antigas com status `renegotiated`.
  - Emite novo cronograma de parcelas vinculado ao mesmo negócio.

### 2.9 `undo_operation` (Desfazer)
- **Entrada:** `{ auditLogId: string }`
- **Ação:**
  - Lê `payload_before` da operação em `audit_log`.
  - Restaura o estado anterior e desfaz os registros criados (idempotência reversa).
