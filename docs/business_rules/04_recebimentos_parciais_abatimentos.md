# 04. Recebimentos, Pagamentos Parciais e Abatimentos

## 1. Liquidação e Recebimentos Financeiros

Quando um cliente realiza um pagamento, há uma entrada efetiva de recursos financeiros (`Cash IN`).

### 1.1 Recebimento Integral de Parcela
- **Comando do usuário:** *“Carlos me pagou a parcela de 500 da moto.”*
- **Ações do Sistema:**
  - Localiza o cliente `Carlos` e a negociação referente à `moto`.
  - Identifica a parcela pendente mais antiga ou a parcela exata correspondente ao valor.
  - Atualiza o status da parcela de `pending` para `paid`.
  - Registra a entrada de caixa (`Cash Movement IN`) de R$ 500.
  - Reduz o indicador "Na rua" em R$ 500.

### 1.2 Pagamento Parcial de Parcela
- **Comando do usuário:** *“Lucas me pagou 200 daquela parcela de 500.”*
- **Regra Fundamental:** **Não marcar a parcela como quitada!**
- **Ações do Sistema:**
  - Registra pagamento vinculado à parcela no valor de R$ 200.
  - Saldo devedor da parcela é recalculado para R$ 300:
    $$\text{Saldo Restante} = \text{Valor Original} - \sum \text{Pagamentos Efetuados}$$
  - O status da parcela muda para `partially_paid`.
  - Registra entrada de caixa de R$ 200.
  - Reduz "Na rua" em R$ 200.

### 1.3 Pagamento sem Menção Explícita à Negociação
- **Comando do usuário:** *“O João me mandou 800 no Pix.”*
- **Regras de Resolução:**
  1. Se João tiver apenas uma negociação em aberto com saldo devedor $\ge 800$, o sistema aloca o valor amortizando automaticamente na ordem: **parcelas vencidas (mais antigas primeiro) $\rightarrow$ parcelas a vencer**.
  2. Se o valor quitar a parcela 1 (R$ 500) e sobrar saldo (R$ 300), o sistema quita a parcela 1 e amortiza parcialmente a parcela 2.
  3. Se João possuir múltiplas negociações distintas e houver dúvida de destinação, o sistema solicita confirmação do usuário (desambiguação).

---

## 2. Abatimentos (*Adjustments*)

> **Regra Crítica:** Abatimento NÃO é recebimento em dinheiro. Não deve transitar no fluxo de caixa líquido diário.

O abatimento é uma redução do saldo devedor através de dação em pagamento (entrega de um bem menor), prestação de serviço, desconto concedido por acordo ou perdão negociado.

### 2.1 Mercadoria como Abatimento
- **Comando do usuário:** *“Rafael me deu uma caixa de som de 400 reais para abater da dívida da moto.”*
- **Ações do Sistema:**
  - Novo item cadastrado no estoque: "Caixa de som" com custo de aquisição = R$ 400, status `disponivel`.
  - Registro de `Adjustment` de crédito de R$ 400 na dívida de Rafael.
  - Amortização de R$ 400 no saldo "Na rua".
  - **Movimento de Caixa (`Cash Movement`) = R$ 0** (nenhum centavo em moeda transitou).

### 2.2 Serviço / Trabalho como Abatimento
- **Comando do usuário:** *“Abati 300 reais do Marcos porque ele poliu os três carros da loja.”*
- **Ações do Sistema:**
  - Registro de despesa operacional ou custo agregado aos carros de R$ 300.
  - Registro de `Adjustment` no saldo de Marcos no valor de R$ 300.
  - Redução de "Na rua" em R$ 300.
  - Saldo de caixa físico inalterado.

### 2.3 Desconto Concedido para Quitação
- **Comando do usuário:** *“O Bruno me devia 1.200. Ele pagou 1.000 no Pix e dei 200 de desconto pra fechar a conta.”*
- **Ações do Sistema:**
  - Entrada de caixa (`Cash IN`): R$ 1.000.
  - Abatimento/Desconto concedido (`Adjustment - Discount`): R$ 200.
  - Quitação total da negociação (saldo restante zerado).
  - Redução de "Na rua" em R$ 1.200.
