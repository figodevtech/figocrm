# Relatório — Backend pronto para o front (pré-front production ready)

Data: 23/09/2026 · Branch: `main` · Commits `1492afd..bd433e5` (a partir de `2ca2e0a`) · Deploy Vercel: **Ready** (Production, `bd433e5`)

Base: `relatorio_hardening_backend_final.md` e `plano_implementacao_fases_24_35_figocrm.md`. Nada foi reescrito;
nenhum guardrail foi removido; a arquitetura financeira ganhou estorno e renegociação sem perder a
atomicidade (tudo continua em RPC PostgreSQL com audit log).

## 1. Resumo

| Fase | Estado | Evidência |
| :--- | :--- | :--- |
| 1. LLM real em produção | ✅ confirmado | 6 comandos do usuário real em `ai_telemetry`: `openai` / `gpt-5.4-mini` / `source=llm` (seção 15) |
| 2. Senha vazada + auth | ⚠️ parcial | signup/login/reset testados (3/3). **Leaked password protection exige ação manual no dashboard** (sem token de gerenciamento) |
| 3. RLS initplan + índices de FK | ✅ | advisor `auth_rls_initplan` 56 → 0, `unindexed_foreign_keys` 11 → 0 |
| 4. Assinatura fail-closed | ✅ | regra única no SQL + trigger de escrita em 11 tabelas; 10/10 E2E |
| 5. Ações manuais = voz | ✅ | venda/troca manual passam por `DealCommand → executor → RPC`; E2E compara a estrutura gravada |
| 6. Desfazer real | ✅ | estorno por lançamento negativo ligado ao original, idempotente, por voz e por endpoint |
| 7. Renegociação | ✅ | parcelas antigas `renegotiated` (nunca apagadas), nova grade ligada; pergunta se a conta não fecha |
| 8. Billing neutro | ✅ | `subscriptions`, `billing_events`, trial de 7 dias no servidor, webhook assinado + idempotente. **Nenhum gateway escolhido** |
| 9. Custo de IA por usuário | ✅ | `npm run report:ai-usage` |
| 10. Benchmark 800+ | ✅ | 860 casos (400 núcleo + 460 fala real) |
| 11. Rótulo REC_115 | ✅ | REC_111..REC_139 corrigidos: o certo é perguntar |
| 12. `AssistantResponse` | ✅ | todas as rotas de voz; erro técnico nunca vai ao front |
| 13. Respostas curtas | ✅ | "Pronto. Registrei R$ 500 do Carlos. Ainda faltam R$ 1.500 nessa parcela." |
| 14. Contrato do front | ✅ | `docs/architecture/contrato_api_front.md` |

Além do escopo, dois riscos reais foram achados e fechados:

| Achado | Impacto | Correção |
| :--- | :--- | :--- |
| Parser por regras (fallback quando a LLM cai) executava direto e errava **49,8%** das falas reais do novo dataset de forma insegura | com a OpenAI fora do ar, gravaria valores/direções errados | fallback agora **lê de volta** ("Entendi: … Confirma?") e só grava com "sim" → 0% inseguro |
| `profiles` permitia `UPDATE` em qualquer coluna pelo próprio usuário | usuário poderia se dar assinatura ativa | assinatura saiu de `profiles` para `subscriptions` (sem escrita pelo cliente); `profiles` só aceita `full_name`, `phone`, `business_segment` |

## 2. Commits

| Commit | Descrição |
| :--- | :--- |
| `1492afd` | perf(db): optimize rls auth evaluation and foreign key indexes |
| `8be41f3` | fix(subscription): fail closed when billing state is unavailable |
| `ddf5395` | feat(billing): add provider-neutral subscription core |
| `b5f2ff3` | feat(finance): add reversible settlement operations and installment renegotiation |
| `7f73fd2` | refactor(domain): route manual deals through atomic executor |
| `eb141e9` | test(domain): cover fail-closed billing, undo, renegotiation and manual = voice |
| `6e8fbe5` | feat(ai): read back fallback interpretations and harden grounding |
| `41f1044` | test(ai): expand voice benchmark with 460 real-world variations |
| `bd433e5` | feat(ops): add AI cost report and front-end API contract |

57 arquivos (26 novos, 31 alterados), +11.772 / −675 linhas (inclui os 460 casos gerados).

## 3. Arquivos principais

**Banco:** `supabase/migrations/20260923000009` a `…000013` (seção 4).

**Assinatura e billing:** `src/lib/subscription.ts` (reescrito), `src/lib/billing/{types,registry,service,webhook}.ts`,
`src/app/api/webhooks/payment/route.ts`, `src/app/api/billing/status/route.ts`, `src/lib/supabase/admin.ts`.

**Domínio financeiro:** `src/lib/domain/financial-operations.ts` (`reverseSettlement`, `renegotiateInstallments`,
`planRenegotiation`), `src/lib/domain/financial-target-resolver.ts` (`resolveReversalTarget`),
`src/lib/domain/manual-deal-commands.ts` (novo), `src/lib/domain/command-executor.ts`.

**IA:** `src/lib/ai/orchestrator.ts` (reescrito: contrato, estorno, renegociação, leitura de volta),
`src/lib/ai/readback.ts` (novo), `src/lib/ai/grounding.ts`, `src/lib/ai/interpret.ts`, `src/lib/ai/interpreter.ts`,
`src/lib/ai/prompts.ts`, `src/lib/ai/disambiguation.ts`, `src/lib/ai/schemas/llm-interpretation.schema.ts`,
`src/lib/voice/numbers.ts`.

**API:** `src/lib/api/assistant-response.ts` (novo), `src/app/api/voice/{process,transcribe}/route.ts`,
`src/app/api/operations/reverse/route.ts` (novo), `src/app/actions/{undo,deals}.ts` (reescritos).

**Operação:** `scripts/ai_usage_report.mjs`, `scripts/generate_realworld_cases.mjs`, `scripts/security_audit.mjs`.

**Testes:** `tests/e2e/{finance-ops,subscription,auth}.e2e.ts` (novos), `tests/e2e/{rpc-security,http-smoke,helpers}.ts`,
`tests/unit/domain.test.ts` (novo), `tests/voice-benchmark/*`.

## 4. Migrations (todas aplicadas no banco real)

| Migration | Conteúdo |
| :--- | :--- |
| `000009_perf_rls_initplan_fk_indexes` | 56 policies com `(select auth.uid())`; 11 índices de FK (parciais onde a coluna é opcional) |
| `000010_subscriptions_fail_closed` | `subscriptions`, `billing_events`, `subscription_access()`, trigger `enforce_write_access`, backfill, trial no `handle_new_user`, grant de colunas em `profiles` |
| `000011_reversible_settlements_renegotiation` | `settlements`, `renegotiations`, `reversal_of`/`settlement_id` em pagamentos/abatimentos/caixa, triggers de estorno, `reverse_settlement`, `renegotiate_installments`, `monthly_due_date` |
| `000012_append_only_ledger` | sem UPDATE/DELETE/TRUNCATE em `payments`, `adjustments`, `cash_movements`, `settlements` |
| `000013_reverse_settlement_locking` | estorno trava a dívida (`FOR UPDATE` em receivable/payable) em vez da liquidação, compatível com o ledger só-inclusão |

## 5. Advisors — antes e depois

Replicados localmente por `scripts/security_audit.mjs` (sem token do Supabase para o advisor oficial).
Arquivos: `docs/security/audit_before_20260923000009.json`, `audit_after_20260923000009.json`, `audit_final_pre_front.json`.

| Lint | Antes | Depois |
| :--- | ---: | ---: |
| `auth_rls_initplan` | 56 | **0** |
| `unindexed_foreign_keys` | 11 | **0** |
| `authenticated_security_definer_function_executable` (WARN) | 2 | 2 — intencional |
| `rls_enabled_no_policy` (INFO) | 2 | 3 — intencional |

Os 2 WARN são `consume_voice_rate_limit` e `record_ai_telemetry`: DEFINER de propósito, porque o usuário
não pode ler nem escrever essas tabelas diretamente; as funções só usam `auth.uid()`. Os 3 INFO são tabelas
sem policy de propósito (`ai_telemetry`, `voice_rate_limits`, `billing_events`): só o servidor acessa.

## 6. Índices

Criados: `idx_deals_customer`, `idx_receivables_customer_fk`, `idx_payables_customer`, `idx_cash_movements_deal`,
`idx_adjustments_deal`, `idx_adjustments_counter_item`, `idx_ai_interactions_target_deal` e 4 em
`conversation_context_*`. Os parciais (`WHERE col IS NOT NULL`) cobrem FKs opcionais sem pesar a escrita.

Índices marcados como "unused" pelo advisor **não foram removidos** (banco novo, sem tráfego representativo).

## 7. RLS

- 56 policies reescritas com `(select auth.uid())`: avaliado uma vez por consulta, não por linha.
- Tabelas novas: `subscriptions` (só SELECT do próprio), `settlements` e `renegotiations` (SELECT do próprio;
  escrita só via RPC), `billing_events` (nenhum acesso do cliente).
- Ledger só-inclusão: nem o dono apaga ou altera pagamento, abatimento, caixa ou liquidação.
- E2E de segurança 12/12: isolamento entre usuários, anon sem RPC, estorno/renegociação cruzados bloqueados.

## 8. Assinatura fail-closed

Regra única: `subscription_access()` no SQL. O TypeScript só lê essa função; qualquer erro ou dado
malformado vira **escrita negada** (`billing_unavailable`).

| Estado | Escrita | Observação |
| :--- | :--- | :--- |
| `trialing` | até `trial_ends_at` | 7 dias, criado pelo servidor no cadastro |
| `active` | até `current_period_end` | depois: `renewal_pending` / `renewal_overdue` conforme a carência |
| `past_due` | 3 dias de carência explícita (`past_due_at + 3d`) | depois bloqueia |
| `canceled` | até `current_period_end` | depois bloqueia |
| `expired`, `blocked`, sem assinatura | não | |

- **Leitura nunca é bloqueada**: consultas por voz funcionam com assinatura vencida (testado).
- Defesa em profundidade: trigger `enforce_write_access` (FOR EACH STATEMENT) em 11 tabelas de negócio.
  Mesmo escrevendo direto via REST, o banco recusa com `SUBSCRIPTION_INACTIVE`.
- Mensagem ao usuário é curta e de produto ("Seu teste grátis de 7 dias acabou…"), com
  `code: 'subscription_required'` para o front mostrar o CTA.

## 9. Ações manuais = voz

`createSaleAction` e `createTradeAction` montam o mesmo `DealCommand` da voz (`buildManualSaleCommand`,
`buildManualTradeCommand`) e chamam `executeDealCommand` com `source: 'MANUAL_WEB'`. Validação, balanço,
idempotência, RPC atômica e audit log são os mesmos. O E2E grava a mesma troca por voz e pelo formulário e
compara a estrutura (deal, itens, caixa, dívida, parcelas).

## 10. Desfazer

- Estorno = liquidação nova com valores **negativos**, `reversal_of` apontando para a original. Nada é apagado.
- Idempotente: segundo estorno devolve `already_reversed`; estorno de estorno é recusado; índice único garante 1:1.
- Parcela renegociada não aceita estorno de pagamento antigo (`INSTALLMENT_REPLACED`): o usuário é orientado.
- Por voz: "Desfaz aquele pagamento de 500 do Carlos" → procura liquidações do cliente (valor/tipo, últimos
  30 min primeiro); se houver mais de uma, pergunta com candidatos.
- Por API: `POST /api/operations/reverse { operationId }` com o `operationId` devolvido em `executed`.
- Audit: `REVERSE_SETTLEMENT` com original e estorno.
- Testado: pagamento, abatimento, duplo estorno, estorno cruzado entre usuários (bloqueado).

## 11. Renegociação

"Junta as duas atrasadas e faz quatro de 500 todo dia 10":

- `renegotiate_installments` confere que a soma da nova grade fecha com o saldo; se não fecha, devolve
  `SCHEDULE_MISMATCH` e o assistente pergunta ("As 2 parcelas somam R$ 3.500. 4 de R$ 500 dá R$ 2.000…").
- Parcelas antigas: `status = 'renegotiated'`, `renegotiated_value` guarda o que foi transferido,
  `replaced_by_renegotiation_id`. Nunca apagadas.
- Novas parcelas: `renegotiation_id`, numeração continua da maior existente, vencimentos por `monthly_due_date`.
- Audit `RENEGOTIATE_INSTALLMENTS`. Totais da dívida recalculados por trigger.

## 12. Billing (neutro de gateway)

- `subscriptions`: status, plano `figo_mensal` R$ 24,90, `trial_*`, `provider`, `provider_customer_id`,
  `provider_subscription_id`, `current_period_*`, `cancel_at_period_end`, `canceled_at`, `past_due_at`.
- `billing_events` com `UNIQUE(provider, event_id)`: o mesmo evento aplicado duas vezes é ignorado.
- `BillingProvider` (interface: `verifyWebhook`, `parseEvent`, `createCheckout`) + registro por `BILLING_PROVIDER`.
- `POST /api/webhooks/payment`: 503 sem provider configurado, 401 com assinatura inválida, aplica o evento
  com service role. **Ativação só pelo webhook assinado, nunca pelo redirect do navegador.**
- `GET /api/billing/status` para o front (trial restante, `canWrite`, mensagem, `checkoutAvailable: false`).
- Testado com um provider HMAC de teste (503, 401, aplicado, duplicado).

## 13. Benchmark

| Conjunto | Casos | Intent | Cenário completo | Execução insegura |
| :--- | ---: | ---: | ---: | ---: |
| Regras — núcleo (gate ≥ 90%) | 400 | 100% | 100% | **0%** |
| Regras — fala real, parser puro (informativo) | 460 | — | 17,6% | 49,8% |
| Regras — fala real, fallback de produção (leitura de volta) | 460 | — | — | **0%** |
| LLM — amostra `--sample=100` (núcleo + fala real) | 100 | 100% | 100% | **0%** |
| LLM — fala real completo | 460 | 100% | 100% | **0%** |
| LLM — núcleo completo | 400 | 96,5% | 96,5% | **0%** |

- No núcleo completo, 13 das 14 falhas foram HTTP 429 da OpenAI: a corrida começou logo após a amostra e
  estourou o limite de 200 mil tokens/min da organização. O sistema fez o que deve: sem LLM, perguntou em vez
  de gravar. A única falha real (REC_129) classificou `register_payment` em vez de `partial`, mas perguntou.
- Latência LLM p50 1,8 s · p95 2,7 s. Custo médio ≈ US$ 0,00047 por comando.
- **Ressalva honesta:** os 460 casos de fala real vêm de um gerador próprio (variações de fala informal,
  números regionais, correções). 100% ali é um teto, não a acurácia do mundo real. A medida real virá de
  `ai_telemetry` com uso de clientes.
- Nada foi "decorado": as mudanças de prompt são regras gerais de português ("ele completou" ≠ "completei";
  "conto" = reais; na autocorreção vale o último valor). As proteções novas são checagens determinísticas no
  código (valor pago acima da parcela citada, direção da volta contradizendo a fala, forma curta "por 3 e 1").
- Rótulos corrigidos (Fase 11): REC_111..REC_139 ("pagou 1.300 daquela parcela de mil") esperavam execução; o
  certo é perguntar. O modelo não foi alterado para satisfazer o rótulo antigo.

## 14. E2E e testes

| Suíte | Resultado |
| :--- | :--- |
| `npm run lint` | limpo |
| `npm run test` (unitários) | 26/26 + 9/9 |
| `npm run build` | ok |
| `npm run test:security` | 12/12 |
| Multi-turno no banco real (regras / LLM) | 9/9 / 9/9 |
| Operações financeiras: estorno, renegociação, leitura de volta, manual = voz (regras / LLM) | 10/10 / 10/10 |
| Assinatura fail-closed + webhook | 10/10 |
| Auth (signup, login, reset) | 3/3 |
| Smoke HTTP (`next start`, mesmo commit do deploy) | 8/8 |
| `npm run test:benchmark:rules` | aprovado |
| `npm run test:benchmark:llm -- --sample=100` | aprovado |

O smoke HTTP inclui **áudio real**: frase gerada por TTS → `/api/voice/transcribe` → Whisper → LLM →
resposta, com duração e latência do STT gravadas em `ai_telemetry`. Também cobre 401 sem sessão, diálogo
canônico de 4 turnos (troca → pagamento parcial → abatimento → quitação), rate limit 429 com `Retry-After`
e o contrato `AssistantResponse`.

Todos os usuários descartáveis dos testes (`@figocrm.test`) foram removidos ao final.

## 15. LLM em produção

Telemetria do usuário real (23/09, 16:16–16:20, antes deste deploy):

| Campo | Valor |
| :--- | :--- |
| provider / modelo / fonte | `openai` / `gpt-5.4-mini` / `llm` (0% fallback) |
| latência LLM | 1,7–3,0 s (total 2,3–4,8 s) |
| tokens | ~1.950 entrada, 170–460 saída |
| custo estimado | US$ 0,0004–0,0006 por comando |
| resultado | 4 sucessos, 2 erros de `resolution`: item não estava no estoque (lacuna de produto, seção 19) |

Ainda não há comando **por áudio** em produção; o caminho de áudio foi validado no smoke local.

## 16. Telemetria e custo

`npm run report:ai-usage -- --days=30` (lê `ai_telemetry` pela conexão direta, nunca exposto ao app):
comandos, segundos de áudio, tokens, custo STT/LLM, p50/p95, % fallback, % erro por usuário, custo por
usuário ativo e fatia do plano de R$ 24,90.

Hoje: 1 usuário ativo, 6 comandos, US$ 0,0029 no total. Estimativa: 100 comandos/mês ≈ US$ 0,05 (≈ R$ 0,27),
cerca de 1% do plano. Com áudio, some US$ 0,006 por minuto de Whisper.

## 17. Build

`next build` ok (Next 16, TypeScript sem erros). Rotas: `/api/billing/status`, `/api/operations/reverse`,
`/api/voice/process`, `/api/voice/transcribe`, `/api/webhooks/payment`, `/app`, `/login`, `/cadastro`, proxy.

## 18. Vercel

- Push `2ca2e0a..bd433e5` em `main` → deploy **Production** `bd433e5`, status GitHub `Vercel: success —
  Deployment has completed`.
- O domínio de produção está atrás do **Vercel Deployment Protection** (302 para o SSO da Vercel). Sem o
  segredo de bypass não dá para rodar o smoke nem uma operação de voz diretamente em produção a partir
  daqui. O smoke rodou no mesmo commit em `next start` contra o mesmo Supabase e a mesma OpenAI.
- Para smoke em produção: `SMOKE_BASE_URL=<url> VERCEL_PROTECTION_BYPASS=<segredo> npm run test:smoke`.

## 19. Pendências

**Ações manuais do responsável:**

1. **Rotacionar a chave da OpenAI.** Ela foi colada no chat deste trabalho. Seguir o procedimento: criar
   nova chave → atualizar na Vercel → atualizar `.env.local` → revogar a antiga. (A chave nunca foi commitada
   nem gravada em documentação/logs.)
2. **Ativar "Leaked password protection"** em Supabase → Authentication → Providers/Password.
3. Decidir sobre o **Deployment Protection**: desligar no domínio de produção ao abrir para clientes, ou
   gerar o segredo de bypass para automação.
4. **Escolher o gateway de pagamento.** O núcleo está pronto; falta um adapter `BillingProvider` e
   `POST /api/billing/checkout`.
5. Adicionar o preço do `gpt-5.4-mini` à tabela de `src/lib/observability/telemetry.ts` ou definir
   `LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M` na Vercel (hoje usa o preço padrão como estimativa).

**Produto / backend (não bloqueiam o início do front):**

- Venda por voz de item fora do estoque responde "Não encontrei…". Decidir se cadastra na hora.
- Endpoints marcados "a criar" no contrato: detalhe de cliente, lista de deals, lista de recebíveis,
  ação manual de renegociação, exclusão de conta.
- Desfazer um **negócio inteiro** (venda/troca) não existe; só pagamento, abatimento e vencimento.
- Liquidações anteriores à migration `000011` não têm `settlement` e não podem ser estornadas.
- `installments`/`receivables` ainda aceitam escrita direta via REST pelo próprio dono (bloqueada sem
  assinatura). Próximo passo: restringir às RPCs, como já feito no ledger.
- Limite de 200 mil tokens/min da OpenAI: dá com folga para o uso atual. Rever antes de ~50 comandos
  simultâneos por minuto.
- Modelo de raciocínio não é determinístico: a mesma frase pode variar entre execuções. Por isso as
  proteções críticas estão no código, não só no prompt.
- Conta manual `teste@figocrm.com` (criada em 23/09) continua no banco. Não foi criada pelos testes
  automatizados; remover se não for usada.

**Gate para começar o front:**

- [x] Contrato `AssistantResponse` em todas as rotas de voz
- [x] Fail-closed de assinatura no banco
- [x] Desfazer e renegociação no backend
- [x] Benchmark com 0% de execução insegura (LLM e fallback)
- [x] Deploy Ready com o commit final
- [ ] Chave da OpenAI rotacionada
- [ ] Leaked password protection ligado
- [ ] Decisão sobre Deployment Protection no domínio público
