# 03. Trocas, Permutas e Voltas Financeiras

## 1. Complexidade Real das Trocas

No comércio informal e revenda de veículos/eletrônicos, uma fração massiva das transações envolve trocas. O sistema trata a troca como uma negociação única contendo múltiplos fluxos simultâneos.

---

## 2. Modalidades de Permuta

### 2.1 Troca Seca (Item por Item)
- **Definição:** Um item sai do estoque e outro item entra sem nenhuma movimentação financeira de dinheiro ou parcelas.
- **Comando de voz típico:** *“Troquei pau a pau meu iPhone 13 pelo Galaxy S23 do Felipe.”*
- **Ações do Sistema:**
  - Item de Saída: `iPhone 13` marcado como `vendido` (ou `trocado`). Custo histórico: R$ 2.400.
  - Item de Entrada: `Galaxy S23` cadastrado como `disponivel`.
  - **Custo contábil atribuído ao novo item:** Igual ao custo contábil do item entregue (R$ 2.400) ou valor de mercado de referência atribuído.
  - Movimentação de Caixa: R$ 0.

---

### 2.2 Troca com Volta Recebida À Vista
- **Definição:** O item entregue pelo usuário vale mais que o item recebido do cliente. O cliente paga a diferença em dinheiro ou Pix.
- **Comando de voz típico:** *“Passei minha XRE por 20 mil pro Renan. Peguei a Fan dele por 12 mil e ele me voltou 8 mil no Pix.”*
- **Matemática do Negócio:**
  - Valor de Venda da XRE: R$ 20.000
  - Custo da XRE (exemplo): R$ 16.000
  - Item Recebido: `Fan` cadastrada no estoque com Custo de Entrada de R$ 12.000.
  - Caixa Imediato: `+ R$ 8.000` (Pix).
  - Lucro apurado na venda da XRE: $\text{R\$ 20.000} - \text{R\$ 16.000} = \text{R\$ 4.000}$.

---

### 2.3 Troca com Volta Recebida Parcelada
- **Definição:** O cliente entrega um item inferior e parcela a diferença restante.
- **Comando de voz típico:** *“Vendi o Civic por 50 mil pro Diego. Peguei o Celta dele por 20 mil, 10 mil no Pix e o resto em 10 parcelas de 2 mil.”*
- **Ações do Sistema:**
  - Item Saída: `Civic` (status: `vendido`).
  - Item Entrada: `Celta` (status: `disponivel`, custo: R$ 20.000).
  - Caixa Imediato: `+ R$ 10.000` (Pix).
  - Recebível ("Na rua"): `+ R$ 20.000` distribuído em 10 parcelas mensais de R$ 2.000 vinculadas a Diego.

---

### 2.4 Troca com Volta Paga pelo Usuário
- **Definição:** O usuário adquire um item superior entregando um item inferior de seu estoque mais uma complementação financeira.
- **Comando de voz típico:** *“Peguei uma Hilux de 120 mil do Beto. Dei meu Corolla avaliado em 80 mil e paguei 40 mil de volta no Pix.”*
- **Ações do Sistema:**
  - Item Saída: `Corolla` (marcado como entregue em permuta/vendido).
  - Item Entrada: `Hilux` (cadastrado com custo de entrada = R$ 80.000 + R$ 40.000 = R$ 120.000).
  - Caixa Imediato: `- R$ 40.000` (`Cash OUT`).

---

### 2.5 Troca com Volta Paga Parcelada (Obrigação Futura)
- **Definição:** O usuário entrega seu produto e assume compromisso futuro para pagar a diferença.
- **Comando de voz típico:** *“Peguei a BMW por 90 mil. Dei meu Golf por 60 mil e vou pagar 6 parcelas de 5 mil pro Rodrigo.”*
- **Ações do Sistema:**
  - Item Saída: `Golf` (baixado do estoque).
  - Item Entrada: `BMW` (cadastrado com custo de aquisição = R$ 90.000).
  - Contas a Pagar (`Payable`): `R$ 30.000` em 6 parcelas de R$ 5.000 vinculadas a Rodrigo.

---

## 3. Matriz de Combinações Suportadas

O motor determinístico suporta qualquer combinação das equações:

| Item Saída (`OUT`) | Item Entrada (`IN`) | Complemento Líquido | Resultado no Caixa / "Na rua" |
| :--- | :--- | :--- | :--- |
| Mercadoria A | Mercadoria B | Nulo | R$ 0 |
| Mercadoria A | Mercadoria B | Volta Recebida à Vista | Caixa `IN` |
| Mercadoria A | Mercadoria B | Volta Recebida a Prazo | Recebível `IN` ("Na rua") |
| Mercadoria A | Mercadoria B | Volta Recebida Mista (Entrada + Prazo) | Caixa `IN` + Recebível `IN` |
| Mercadoria A | Mercadoria B | Volta Paga à Vista | Caixa `OUT` |
| Mercadoria A | Mercadoria B | Volta Paga a Prazo | Contas a Pagar `OUT` |

Toda troca gera uma transação atômica no banco de dados.
