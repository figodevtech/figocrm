# Benchmark de Linguagem Natural para Operações por Voz

Este módulo contém a suíte de testes de linguagem natural para aferir a capacidade de extração e estruturação semântica do assistente de voz do SaaS.

---

## 1. Estrutura dos Arquivos

- `dataset_benchmark_voz.json`: Dataset canônico contendo mais de 150 casos de teste com variações linguísticas reais de revendedores brasileiros (gírias de valores como *“dois pau”*, *“cinquenta conto”*, *“dei uma volta de dois”*, *“ficou no fiado”*, *“me deu um celular pra abater”*).
- `metricas_e_criterios.md`: Critérios de corte e fórmulas matemáticas das taxas de aprovação mínimas.
- `scripts/validate_dataset.js`: Script de validação de integridade sintática e volumetria do dataset.

---

## 2. Esquema de Cada Cenário de Teste

Cada caso de teste em `dataset_benchmark_voz.json` adota a seguinte estrutura JSON:

```json
{
  "id": "SCEN_VENDA_001",
  "category": "venda_parcelada",
  "spoken_text": "Vendi a Fan 160 pro Marcos por 12 mil. Ele deu 4 mil no Pix e 8 parcelas de mil.",
  "context": {
    "existing_customers": [{ "id": "cust_1", "name": "Marcos" }],
    "existing_items": [{ "id": "item_1", "name": "Fan 160", "cost": 9500, "status": "disponivel" }]
  },
  "expected_intent": "create_sale",
  "expected_entities": {
    "customer_name": "Marcos",
    "item_out": "Fan 160",
    "total_deal_value": 12000,
    "cash_inflow": 4000,
    "payment_method": "pix",
    "receivable": {
      "total_amount": 8000,
      "installments_count": 8,
      "installment_value": 1000
    }
  },
  "requires_confirmation": false,
  "confirmation_prompt": null,
  "expected_financial_outcome": {
    "cash_balance_delta": 4000,
    "receivables_balance_delta": 8000,
    "inventory_cost_delta": -9500,
    "recognized_profit": 2500
  }
}
```

---

## 3. Categorias Contempladas no Dataset

1. `venda_a_vista`: Vendas liquidadas integralmente no ato (Pix, dinheiro, débito).
2. `venda_parcelada`: Vendas com entrada + parcelas ou 100% a prazo.
3. `recebimento_integral`: Quitações completas de parcelas ou saldo.
4. `recebimento_parcial`: Pagamentos fragmentados com atualização de saldo devedor.
5. `troca_seca`: Permuta item por item sem compensação financeira.
6. `troca_com_volta_recebida`: Permuta com recebimento de complemento (à vista ou parcelado).
7. `troca_com_volta_paga`: Permuta com desembolso do usuário (à vista ou a prazo).
8. `abatimento_mercadoria`: Liquidação de dívida com entrega de produto menor.
9. `abatimento_servico_ou_desconto`: Liquidação por serviço prestado ou concessão de desconto.
10. `renegociacao_e_prazos`: Mudança de datas, junção de parcelas ou divisão de saldo.
11. `compra_e_custos_adicionais`: Entrada de novos itens e despesas com peças/reparos.
12. `ambiguidade_e_seguranca`: Entradas ambíguas, números incompletos ou dados divergentes que exigem confirmação obrigatória.
