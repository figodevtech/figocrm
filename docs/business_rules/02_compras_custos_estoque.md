# 02. Compras, Custos Agregados e Gestão de Estoque

## 1. Cadastro e Ciclo de Vida da Mercadoria (`Item`)

Qualquer item comercializável que entre no sistema passa por um ciclo de vida estrito.

### 1.1 Estados da Mercadoria
- `disponivel`: Item apto e pronto para ser vendido ou negociado.
- `em_preparacao`: Item adquirido que está passando por manutenção, reparo, estética ou regularização documental.
- `reservado`: Item vinculado a uma negociação em andamento, aguardando confirmação ou pagamento de sinal.
- `vendido`: Item que foi transferido para um comprador em uma negociação concluída.
- `devolvido`: Item retornado ao fornecedor ou que retornou de uma venda cancelada.

### 1.2 Origem da Mercadoria
1. **Compra Direta:** Aquisição de terceiros mediante pagamento (dinheiro, Pix, a prazo).
2. **Entrada por Troca:** Mercadoria absorvida como parte de pagamento em uma venda (permuta).
3. **Estoque Inicial:** Mercadoria já existente no momento em que o usuário começou a usar o app.

---

## 2. Compras de Mercadorias

### 2.1 Compra à Vista
- **Comando do usuário:** *“Comprei um Gol 2012 por 18 mil no Pix do Marcos.”*
- **Ações do Sistema:**
  - Criação do `Item` com descrição "Gol 2012", status `disponivel`.
  - Custo de aquisição inicial = R$ 18.000.
  - Registro de saída de caixa imediata (`Cash Movement OUT`) = R$ 18.000.
  - Associação com o contato/fornecedor "Marcos".

### 2.2 Compra a Prazo / Financiada
- **Comando do usuário:** *“Peguei um lote de 5 celulares por 5 mil, paguei 2 mil e fiquei devendo 3 mil pro Lucas pro mês que vem.”*
- **Ações do Sistema:**
  - Criação dos 5 itens com custo rateado ou individualizado.
  - Saída imediata de caixa = R$ 2.000.
  - Criação de uma conta a pagar (`Payable`) = R$ 3.000 vinculada a Lucas com vencimento em 30 dias.

---

## 3. Custos Agregados ao Item (`Item Costs`)

Um dos maiores erros do revendedor informal é não computar pequenas despesas associadas a um produto, distorcendo o lucro real da operação.

### 3.1 Categorias de Custos Agregados
1. **Mecânica / Conserto:** Revisão, peças trocadas, troca de bateria, troca de tela.
2. **Estética / Preparação:** Polimento, lavagem detalhada, capa, película, higienização.
3. **Logística / Transporte:** Frete, guincho, combustível de deslocamento para entrega/retirada.
4. **Documentação / Legal:** Despachante, transferência de DUT, laudo cautelar, multas pretéritas quitadas.
5. **Outros:** Taxas diversas ou comissão de intermediador.

### 3.2 Como os Custos Impactam o Custo Total
Cada custo lançado contra um item ativo é somado diretamente ao seu Custo Total de Aquisição (CMV):

$$\text{Custo Total do Item} = \text{Valor de Compra} + \sum \text{Custos Agregados}$$

- **Exemplo de comando de voz:**
  - *“Gastei 250 de bateria no iPhone 12.”*
  - *“Paguei 400 de funilaria na Titan 160 que comprei do Zé.”*
- **Impacto no Sistema:**
  - Saída imediata de caixa de R$ 250 / R$ 400.
  - Atualização do custo histórico do item.
  - Quando o item for vendido, a margem de lucro será calculada contra o Custo Total real.

---

## 4. O Indicador "Em Mercadoria"

O painel inicial do sistema deve exibir com destaque o total de capital imobilizado:

$$\text{"Em Mercadoria"} = \sum_{\text{status} \in \{\text{disponivel, em\_preparacao, reservado}\}} \text{Custo Total do Item}$$

Isso informa imediatamente ao vendedor quanto dinheiro ele tem parado no pátio ou na prateleira.
