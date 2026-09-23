# 01. Vendas, Parcelamentos, Promissórias e Fiado

## 1. Tipologia de Vendas

Toda saída de mercadoria classificada como venda deve estar vinculada a um cliente (`Customer`) e conter um ou mais itens (`Item OUT`).

### 1.1 Venda À Vista
- **Definição:** O valor total da venda é liquidado integralmente no momento da negociação.
- **Meios de pagamento aceitos:** Pix, Dinheiro em espécie, Cartão de Débito, Cartão de Crédito (repassado integral), Transferência bancária.
- **Impacto no Sistema:**
  - Baixa do item no estoque (status muda para `vendido`).
  - Registro de entrada de caixa imediata (`Cash Movement IN`).
  - Nenhum recebível pendente gerado.
  - Reconhecimento imediato da receita e lucro bruto.

### 1.2 Venda a Prazo com Entrada (Mista)
- **Definição:** Parte do valor é paga no ato da entrega e o restante é dividido em compromissos futuros.
- **Exemplo típico:** *“Vendi a Titan por 10 mil. 3 mil no Pix e 7 mil em 7 de mil.”*
- **Impacto no Sistema:**
  - Baixa do item (`Item OUT`).
  - Registro de entrada de caixa imediata no valor da entrada (R$ 3.000).
  - Geração de entidade de Recebível (`Receivable`) de R$ 7.000 com 7 parcelas (`Installments`) de R$ 1.000.
  - Incremento no indicador "Na rua" em R$ 7.000.

### 1.3 Venda 100% Parcelada (Sem Entrada)
- **Definição:** A mercadoria é entregue sem desembolso financeiro imediato pelo comprador.
- **Exemplo típico:** *“Passei o celular pro Pedro em 3 vezes de 600 começando dia 15.”*
- **Impacto no Sistema:**
  - Baixa do item (`Item OUT`).
  - Criação do `Receivable` de R$ 1.800 com 3 parcelas de R$ 600.
  - Caixa imediato = R$ 0.

### 1.4 Fiado / Promissória
- **Fiado Puro:** Venda a prazo sem quantidade definida de parcelas ou data estrita estipulada (*“Ficou me devendo 450”*).
  - Criação de parcela única aberta com vencimento estimado em 30 dias por padrão (editável).
- **Promissória:** Parcelamento acompanhado de menção expressa de documento promissório (*“Peguei 5 promissórias de 400”*).
  - O sistema gera as parcelas e anota a tag/flag `is_promissory_note: true` para facilitar impressão de recibos ou cobranças futuras.

---

## 2. Regras de Geração e Vencimento de Parcelas

### 2.1 Intervalos e Datas de Vencimento
1. **Regra Mensal Padrão:** Salvo especificação em contrário, o vencimento da primeira parcela ocorre em **30 dias** após a data da negociação, e as subsequentes em intervalos de 30 dias (ou mesmo dia útil do mês subsequente).
2. **Dia Fixo Informado:** Se o usuário falar *“todo dia 10”*, a primeira parcela vence no primeiro dia 10 após a data atual, repetindo-se mensalmente.
3. **Datas Customizadas / Parcelas Desiguais:** O sistema deve suportar valores e prazos heterogêneos.
   - Exemplo: *“Ele vai me dar 500 no dia 20 e os outros 1.000 só no fim do mês seguinte.”*

### 2.2 Estados da Parcela (`Installment Status`)
- `pending`: Parcela criada, dentro do prazo de vencimento.
- `partially_paid`: Houve pagamento parcial, mas resta saldo devedor.
- `paid`: Integralmente quitada.
- `overdue`: Data atual ultrapassou a data de vencimento e a parcela continua com saldo devedor > 0.
- `canceled`: Negociação foi estornada ou perdoada formalmente.

---

## 3. Tolerância a Centavos e Parcelamentos com Dízima

Quando o valor do saldo a receber não for divisível exatamente pelo número de parcelas (ex: R$ 1.000 em 3x):
- O sistema distribui o arredondamento na **primeira parcela** (ou última):
  - Parcela 1: R$ 333,34
  - Parcela 2: R$ 333,33
  - Parcela 3: R$ 333,33
- A soma das parcelas **sempre deve bater exatamente** com o valor do recebível:
  $$\sum \text{Installments} = \text{Receivable Total}$$
