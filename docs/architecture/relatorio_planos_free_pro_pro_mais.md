# Planos Free, Pro e Pro Mais — implementação

## Regras vigentes

| Plano | Mensalidade para novos contratos | Clientes | Comandos de voz por mês |
| --- | ---: | ---: | ---: |
| Free | R$ 0 | 10 | 20 |
| Pro | R$ 39,90 | Ilimitados | 300 |
| Pro Mais | R$ 89,90 | Ilimitados | 1.000 |

O teste gratuito dura sete dias, dá acesso temporário aos benefícios Pro e usa o limite mensal de 300 comandos. Ao acabar sem pagamento, a conta passa ao Free. Clientes já cadastrados continuam legíveis mesmo acima de dez; apenas novos cadastros são bloqueados. A cota de voz usa o mês do calendário e é consumida no banco antes de STT ou LLM. Os recursos manuais permanecem disponíveis depois de esgotar a voz.

## Fonte de verdade e configuração

- `supabase/migrations/20260925122310_three_plans_billing.sql` adiciona Pro Mais, corrige preços e cotas, mantém os limites em `account_entitlements()` e registra o plano do checkout e a mudança pendente. O contador de voz já era atômico na RPC `consume_voice_rate_limit`; ela continua lendo `account_entitlements()`.
- `src/lib/billing/types.ts` é o catálogo de preços do checkout. Para mudar um preço futuro, atualizar esse catálogo e criar outra migration que atualize `plan_entitlements`; contratos já vinculados ao Asaas requerem escolha explícita do titular.
- `public.plan_entitlements` é a fonte das cotas. Para alterá-las, criar outra migration. Não editar migrations aplicadas.
- `src/lib/observability/telemetry.ts` contém a tabela de referência de custos de modelos. `LLM_PRICE_INPUT_PER_1M` e `LLM_PRICE_OUTPUT_PER_1M` substituem o preço interno quando ambos são positivos. O relatório `npm run report:ai-usage` agrupa custo e receita estimada por plano; `USD_BRL` ajusta a estimativa cambial.

## Cobrança e segurança

O checkout exige `POST /api/billing/checkout` com `{ "plan": "pro" }` ou `{ "plan": "pro_plus" }`. Qualquer campo de preço extra é rejeitado. O servidor define nome e valor enviados ao Asaas e grava o código e o preço na sessão de checkout. Retornar do navegador ou receber `CHECKOUT_PAID` não libera o plano. O webhook autenticado correlaciona a cobrança ao checkout ou à assinatura vinculada, compara o valor efetivamente pago e só então altera `subscriptions`. Eventos repetidos usam `billing_events` para idempotência. RLS mantém as tabelas de assinatura somente para leitura do usuário.

O upgrade Pro → Pro Mais e o downgrade Pro Mais → Pro usam a **mesma assinatura** no Asaas. Ambos são agendados para cobranças futuras; `updatePendingPayments: false` preserva cobranças já geradas. O plano atual e sua franquia permanecem até o pagamento da primeira cobrança com o novo valor, confirmado pelo webhook. Se o Asaas já gerou a cobrança do ciclo seguinte, a mudança pode ocorrer apenas no ciclo posterior. Não há pró-rata nem uma segunda assinatura. Essa regra segue a [documentação de atualização de assinatura do Asaas](https://docs.asaas.com/reference/update-existing-subscription).

Assinaturas existentes com `provider_subscription_id` e R$ 24,50 permanecem com esse preço no banco e no Asaas. Recebem os benefícios e o novo limite mensal do Pro, mas a troca de tarifa é bloqueada na interface e no endpoint de mudança de plano; deve ser tratada explicitamente com suporte. A migration atualiza para R$ 39,90 apenas registros de trial sem assinatura no gateway. O relatório usa o preço contratado para estimar receita, inclusive no legado.

## Validação

- TypeScript, lint, build, `npm test` e a suíte completa `npm run test:e2e` passam.
- E2E `tests/e2e/subscription.e2e.ts`: trial, Free, limite de clientes, cotas 20/300/1.000, proteção de tabelas de cobrança, webhook e ativação Pro Mais. `tests/e2e/rpc-security.e2e.ts` confirmou o isolamento RLS entre usuários.
- `npm run report:ai-usage -- --days=30` executado contra o Supabase.

Não foi feito um pagamento real nos preços novos. A primeira compra real deve confirmar a cobrança no Asaas, a associação ao plano comprado e a data da próxima renovação.
