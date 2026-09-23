# 05. Renegociações, Cancelamentos, Devoluções e Auditoria

## 1. Renegociação de Dívidas

No dia a dia dos revendedores autônomos, compradores frequentemente atrasam ou solicitam repactuação de prazos.

### 1.1 Alteração de Data de Vencimento
- **Comando do usuário:** *“Joga a parcela do Pedro que vencia hoje pro dia 25.”*
- **Ações do Sistema:**
  - Identifica a parcela pendente de Pedro.
  - Atualiza o campo `due_date` para a nova data.
  - Registra no histórico de auditoria a alteração de vencimento.
  - Se a parcela constava como atrasada (`overdue`), seu status volta para `pending` caso a nova data seja futura.

### 1.2 Consolidação e Re-parcelamento de Saldo
- **Comando do usuário:** *“O Márcio tinha duas parcelas atrasadas de 600. Juntei tudo e parcelei os 1.200 em 4 vezes de 300.”*
- **Ações do Sistema:**
  - Cancela/inativa as 2 parcelas originais de R$ 600 com motivo `renegociado`.
  - Gera 4 novas parcelas de R$ 300 com novas datas de vencimento sequenciais.
  - Vincula o novo plano de parcelamento ao mesmo `Receivable` com registro de evento de renegociação.
  - Saldo total "Na rua" permanece R$ 1.200, mas o indicador de "Atrasados" zera (passa a ser a vencer).

### 1.3 Perdão Parcial ou Acordo de Redução
- **Comando do usuário:** *“Faltavam 800 do Celso. Ele pagou 500 agora e perdoei os outros 300 pra encerrar.”*
- **Ações do Sistema:**
  - Entrada de caixa: R$ 500 (`Cash IN`).
  - Registro de ajuste por perdão/desconto: R$ 300 (`Adjustment - Write-off`).
  - Liquidação total da pendência do cliente Celso.

---

## 2. Cancelamentos e Retomadas de Mercadoria

### 2.1 Cancelamento Imediato de Negociação (Erro ou Desistência)
- Se a negociação for cancelada por engano do usuário ou desistência mútua antes da entrega:
  - O item retorna ao status original (`disponivel`).
  - Movimentações de caixa atreladas à negociação são estornadas.
  - Recebíveis e parcelas geradas são cancelados (`canceled`).
  - O status da negociação passa para `canceled`.

### 2.2 Retomada de Bem por Inadimplência ("Pegar de Volta")
- **Comando do usuário:** *“Tomei a Titan de volta do Thiago porque ele não pagou as 4 parcelas.”*
- **Tratamento:**
  - O item `Titan` retorna ao estoque do usuário (`disponivel` ou `em_preparacao`).
  - As parcelas pendentes não pagas são baixadas por cancelamento/retomada.
  - Se o comprador já havia pago alguma entrada ou parcela, o valor pago é retido como compensação por depreciação/uso, ou tratado conforme o combinado, sem gerar passivo indevido.
  - O novo custo de re-entrada do bem no estoque é calculado determinística e conservadoramente.

---

## 3. Auditoria e Recurso "Desfazer" (*Undo*)

### 3.1 Trilha de Auditoria Obrigatória (`audit_log`)
Cada modificação em clientes, itens, negócios, caixas ou parcelas gera um registro imutável com:
- `user_id`: Usuário responsável pela operação.
- `deal_id` / `entity_id`: Referência do registro afetado.
- `action_type`: Tipo de ação (`CREATE_SALE`, `PARTIAL_PAYMENT`, `RENEGOTIATE`, `ADJUSTMENT`, etc.).
- `source`: Origem da ação (`VOICE_AI`, `MANUAL_WEB`, `SYSTEM_JOB`).
- `raw_transcript`: Texto falado original transcrito (em caso de voz).
- `payload_before`: Estado snapshot anterior (JSON).
- `payload_after`: Estado snapshot posterior (JSON).
- `created_at`: Carimbo de data/hora oficial.

### 3.2 Botão / Comando "Desfazer"
- Após cada resposta do assistente por voz, uma ação rápida de **"Desfazer"** fica disponível por tempo determinado ou até a próxima operação.
- Acionar "Desfazer" restaura o snapshot anterior a partir do `audit_log`, cancelando a transação recém-executada de forma limpa e transparente.
