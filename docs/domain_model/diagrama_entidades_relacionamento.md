# Modelagem do Domínio: Diagrama Entidade-Relacionamento e Dicionário de Dados

## 1. Visão Geral da Arquitetura de Dados

O modelo de dados do SaaS Voice-First é concebido para ser estritamente **multi-tenant**, onde cada entidade de negócio pertence a um único usuário autenticado (`user_id`).

A integridade referencial, constraints e triggers no PostgreSQL garantem que cálculos financeiros, baixas de estoque e conciliação de parcelas sejam consistentes independentemente do canal de entrada (voz via LLM ou formulário manual).

---

## 2. Diagrama Entidade-Relacionamento (ERD)

```mermaid
erDiagram
    PROFILES ||--o{ CUSTOMERS : "possui"
    PROFILES ||--o{ ITEMS : "possui"
    PROFILES ||--o{ DEALS : "registra"
    PROFILES ||--o{ CASH_MOVEMENTS : "opera"
    PROFILES ||--o{ AI_INTERACTIONS : "interage"
    PROFILES ||--o{ AUDIT_LOG : "audita"

    CUSTOMERS ||--o{ DEALS : "participa como contraparte"
    CUSTOMERS ||--o{ RECEIVABLES : "deve"
    CUSTOMERS ||--o{ PAYABLES : "a receber de"

    ITEMS ||--o{ ITEM_COSTS : "acumula custos"
    ITEMS ||--o{ DEAL_ITEMS : "alocado em"

    DEALS ||--o{ DEAL_ITEMS : "contém"
    DEALS ||--o{ CASH_MOVEMENTS : "gera"
    DEALS ||--o{ RECEIVABLES : "origina"
    DEALS ||--o{ PAYABLES : "origina"
    DEALS ||--o{ ADJUSTMENTS : "sofre"

    RECEIVABLES ||--o{ INSTALLMENTS : "dividido em"
    PAYABLES ||--o{ INSTALLMENTS : "dividido em"

    INSTALLMENTS ||--o{ PAYMENTS : "recebe liquidação"
    INSTALLMENTS ||--o{ ADJUSTMENTS : "amortizado por"

    PROFILES {
        uuid id PK
        string full_name
        string phone
        string business_segment
        string subscription_status
        timestamp trial_started_at
        timestamp trial_ends_at
        timestamp created_at
        timestamp updated_at
    }

    CUSTOMERS {
        uuid id PK
        uuid user_id FK
        string name
        string phone
        string document
        string notes
        timestamp created_at
        timestamp updated_at
    }

    ITEMS {
        uuid id PK
        uuid user_id FK
        string name
        string category
        text description
        decimal acquisition_cost
        decimal target_sale_price
        string status
        string photo_url
        timestamp acquired_at
        timestamp created_at
        timestamp updated_at
    }

    ITEM_COSTS {
        uuid id PK
        uuid user_id FK
        uuid item_id FK
        string category
        string description
        decimal amount
        date cost_date
        timestamp created_at
    }

    DEALS {
        uuid id PK
        uuid user_id FK
        uuid customer_id FK
        string deal_type
        decimal total_value
        decimal recognized_profit
        string status
        text notes
        string source
        date deal_date
        timestamp created_at
        timestamp updated_at
    }

    DEAL_ITEMS {
        uuid id PK
        uuid deal_id FK
        uuid item_id FK
        string direction
        decimal evaluated_value
        timestamp created_at
    }

    CASH_MOVEMENTS {
        uuid id PK
        uuid user_id FK
        uuid deal_id FK
        string direction
        decimal amount
        string payment_method
        date movement_date
        text description
        timestamp created_at
    }

    RECEIVABLES {
        uuid id PK
        uuid user_id FK
        uuid deal_id FK
        uuid customer_id FK
        decimal total_amount
        decimal paid_amount
        decimal balance
        string status
        timestamp created_at
        timestamp updated_at
    }

    PAYABLES {
        uuid id PK
        uuid user_id FK
        uuid deal_id FK
        uuid customer_id FK
        decimal total_amount
        decimal paid_amount
        decimal balance
        string status
        timestamp created_at
        timestamp updated_at
    }

    INSTALLMENTS {
        uuid id PK
        uuid user_id FK
        uuid receivable_id FK
        uuid payable_id FK
        int installment_number
        int total_installments
        decimal original_value
        decimal paid_value
        decimal balance
        date due_date
        string status
        boolean is_promissory
        timestamp created_at
        timestamp updated_at
    }

    PAYMENTS {
        uuid id PK
        uuid user_id FK
        uuid installment_id FK
        decimal amount
        string payment_method
        date payment_date
        text notes
        timestamp created_at
    }

    ADJUSTMENTS {
        uuid id PK
        uuid user_id FK
        uuid deal_id FK
        uuid installment_id FK
        uuid counter_item_id FK
        string adjustment_type
        decimal amount
        text reason
        timestamp created_at
    }

    AI_INTERACTIONS {
        uuid id PK
        uuid user_id FK
        uuid target_deal_id FK
        text spoken_text
        string detected_intent
        jsonb extracted_entities
        boolean required_confirmation
        string confirmation_prompt
        string execution_status
        int latency_ms
        timestamp created_at
    }

    AUDIT_LOG {
        uuid id PK
        uuid user_id FK
        string entity_name
        uuid entity_id
        string action_type
        string source
        jsonb payload_before
        jsonb payload_after
        timestamp created_at
    }
```

---

## 3. Máquinas de Estados (State Machines)

### 3.1 Ciclo de Vida da Mercadoria (`items.status`)
```mermaid
stateDiagram-v2
    [*] --> disponivel : Aquisição direta
    [*] --> em_preparacao : Aquisição com reforma/revisão
    em_preparacao --> disponivel : Conclusão de serviços
    disponivel --> reservado : Proposta aceita / Sinal pago
    reservado --> disponivel : Cancelamento de reserva
    reservado --> vendido : Conclusão da venda
    disponivel --> vendido : Venda direta
    vendido --> devolvido : Retomada por inadimplência ou cancelamento
    devolvido --> disponivel : Re-entrada no estoque
```

### 3.2 Ciclo de Vida da Parcela (`installments.status`)
```mermaid
stateDiagram-v2
    [*] --> pending : Criação do parcelamento
    pending --> overdue : Data atual > data de vencimento
    pending --> partially_paid : Pagamento < valor nominal
    overdue --> partially_paid : Pagamento < saldo devedor
    partially_paid --> paid : Quitação do saldo residual
    pending --> paid : Pagamento integral
    overdue --> paid : Pagamento integral com atraso
    pending --> canceled : Renegociação ou perdão
    overdue --> canceled : Renegociação ou perdão
```

### 3.3 Ciclo de Vida da Assinatura (`profiles.subscription_status`)
```mermaid
stateDiagram-v2
    [*] --> trial : Cadastro da conta (7 dias grátis)
    trial --> active : Assinatura contratada (R$ 24,90/mês)
    trial --> expired : Fim dos 7 dias sem checkout
    active --> past_due : Falha no pagamento da renovação
    past_due --> active : Regularização do pagamento
    past_due --> blocked : Inadimplência persistente
    active --> canceled : Cancelamento solicitado
    canceled --> active : Reativação da assinatura
    expired --> active : Pagamento efetuado
```

---

## 4. Dicionário de Constraints e Regras de Integridade

1. **Multi-tenant Obrigatório:** Toda tabela (exceto `profiles` cujo `id` é a chave primária de usuário) possui coluna `user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`.
2. **Direções Estritas:**
   - `deal_items.direction` aceita exclusivamente `'IN'` (mercadoria recebida) ou `'OUT'` (mercadoria entregue).
   - `cash_movements.direction` aceita exclusivamente `'IN'` (entrada de numerário) ou `'OUT'` (saída/desembolso).
3. **Valores Positivos:**
   - `CHECK (amount >= 0)` em todas as tabelas financeiras.
   - `CHECK (total_value >= 0)` em `deals`.
   - `CHECK (balance >= 0)` em `installments`, `receivables` e `payables`.
4. **Equação do Saldo da Parcela:**
   - `balance = original_value - paid_value`. Quando `balance = 0`, `status` obrigatoriamente torna-se `'paid'`.
