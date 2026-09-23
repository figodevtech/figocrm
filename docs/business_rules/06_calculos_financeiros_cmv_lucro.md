# 06. Engenharia Financeira: CMV, Lucro, "Na Rua" e Estoque

## 1. Princípio da Separação entre IA e Motor Financeiro

> **Regra de Ouro:** A LLM nunca calcula matemática financeira. A IA atua unicamente como extratora e estruturadora de intenções e entidades. O motor do backend aplica as fórmulas com precisão decimal exata.

---

## 2. Fórmulas Determinísticas

### 2.1 CMV (Custo das Mercadorias Vendidas)
O CMV de um item individual $i$ é a somatória exata do seu desembolso de compra com todas as despesas incorridas até o momento da venda:

$$\text{CMV}_i = \text{Custo de Aquisição}_i + \sum \text{Custos Agregados}_i$$

Onde $\text{Custos Agregados}$ inclui:
- Peças e manutenção mecânica/eletrônica;
- Serviços de estética, pintura e polimento;
- Despesas com transporte, frete ou guincho;
- Regularização de documentos, laudos cautelares e taxas de despachante.

### 2.2 Lucro Bruto da Negociação
Para uma venda envolvendo um item $i$:

$$\text{Lucro Bruto} = \text{Valor Negociado da Venda} - \text{CMV}_i$$

Se a venda envolver múltiplos itens:

$$\text{Lucro Bruto} = \text{Valor Negociado Total} - \sum_{i \in \text{Itens OUT}} \text{CMV}_i$$

### 2.3 Margem Bruta Percentual
$$\text{Margem Bruta (\%)} = \left( \frac{\text{Lucro Bruto}}{\text{Valor Negociado Total}} \right) \times 100$$

---

## 3. Gestão de Recebíveis e Indicadores do Painel

O sistema traduz grandezas contábeis para a linguagem natural do revendedor:

### 3.1 "Na Rua" (Total de Recebíveis em Aberto)
Corresponde ao capital líquido que está pendente de recebimento de todos os clientes:

$$\text{"Na Rua"} = \sum_{\text{parcela } p} \left( \text{Valor Original}_p - \text{Total Pago}_p - \text{Abatimentos}_p \right) \quad \forall p \in \{\text{pending, partially\_paid, overdue}\}$$

### 3.2 "Atrasado" (Inadimplência Real)
Parcelas que expiraram a data de vencimento estipulada e continuam com saldo em aberto:

$$\text{"Atrasado"} = \sum_{\substack{p \in \text{parcelas em aberto} \\ \text{due\_date}_p < \text{hoje}}} \text{Saldo Devedor}_p$$

### 3.3 "Em Mercadoria" (Patrimônio em Estoque)
Capital empatado em produtos prontos ou em preparação:

$$\text{"Em Mercadoria"} = \sum_{i \in \text{itens em estoque}} \text{CMV}_i$$

### 3.4 "Quanto Você Ganhou" (Lucro Realizado no Período)
Soma do lucro bruto de todas as negociações com status `concluida` cuja data pertença ao intervalo selecionado (ex: mês corrente):

$$\text{"Quanto Ganhou (Mês)"} = \sum_{\text{deal } d \in \text{Mês Atual}} \text{Lucro Bruto}_d$$

---

## 4. Tratamento de Lucro em Vendas a Prazo e Permutas

### 4.1 Venda a Prazo (Regra de Competência vs. Caixa)
- O sistema registra o **Lucro da Negociação** no fechamento do negócio (visão econômica: você vendeu por 10 e custou 7, logo seu resultado projetado é 3).
- Concomitantemente, exibe o **Fluxo de Caixa Realizado**: quanto desse lucro já caiu no bolso via entradas e quanto ainda está pendente "Na rua".

### 4.2 Apuração em Trocas com Volta
Exemplo:
- Usuário entrega Moto A: Custo total de aquisição $\text{CMV} = \text{R\$ 10.000}$.
- Valor de venda acertado da Moto A: $\text{R\$ 14.000}$.
- Recebe Moto B (avaliada em R\$ 8.000) + R\$ 6.000 em dinheiro de volta.
- **Resultado:**
  - Lucro Bruto reconhecido na saída da Moto A: $\text{R\$ 14.000} - \text{R\$ 10.000} = \text{R\$ 4.000}$.
  - Moto B entra no estoque com custo contábil inicial de $\text{R\$ 8.000}$.
  - Entrada de caixa imediata: $\text{+ R\$ 6.000}$.
  - Balanço do caixa: $+ \text{R\$ 6.000}$, Estoque: $- \text{R\$ 10.000} + \text{R\$ 8.000} = - \text{R\$ 2.000}$. Patrimônio líquido aumentou em $\text{R\$ 4.000}$ (o lucro da operação).
