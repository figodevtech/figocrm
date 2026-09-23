# Relatório — Último ciclo de hardening do backend (voz → banco)

Data: 23/09/2026 · Branch: `main` · Commits: `60ea6f8` → `3810f20`

## 1. Resumo

O pipeline de produção agora é:

```text
áudio → STT → guardrails determinísticos → LLM (Structured Output) → JSON.parse → Zod estrito
→ 1 reparo se inválido → grounding + completude → desambiguação → entity resolution
→ resolução de alvo financeiro → regras financeiras (builder + balanço) → executor seguro
→ RPC PostgreSQL atômica → audit log → contexto persistente (IDs reais) → resposta curta
```

A LLM interpreta, o backend valida, o banco executa. O parser por regras virou guardrail e fallback.

Além do escopo pedido, a revisão encontrou e corrigiu defeitos que impediam o fluxo de funcionar ou
que gravariam dados errados:

| Defeito encontrado | Impacto | Correção |
| :--- | :--- | :--- |
| `get_dashboard_indicators` era DEFINER e aceitava qualquer `p_user_id` quando `auth.uid()` era NULL | **anon lia indicadores de qualquer usuário** | INVOKER + `auth.uid() = p_user_id` obrigatório (000006) |
| `execute_deal_transaction` gravava `deals.source='ia_voz'`, `audit_log.source='ia_voz'`, coluna `adjustments.type` e `payables.supplier_id` | toda negociação por voz falharia no banco | colunas/valores corrigidos, RPC testada de ponta a ponta (000007) |
| Abatimento baixava o saldo "na mão"; o trigger de pagamento recalculava `original − pago` | o próximo pagamento **apagava o abatimento** | `installments.adjusted_value` + triggers (000007) |
| Pagamento acima do saldo era absorvido pelo trigger (`balance = 0`) | valor excedente sumia | trigger rejeita o excesso |
| `/api/voice/process` aceitava chamadas anônimas | processamento sem autenticação | guarda comum: auth → assinatura → rate limit |
| Cache de contexto em memória por instância | na Vercel, instância podia servir contexto velho | contexto só no banco |
| "todo dia 15" numa venda em 23/09 gerava 1ª parcela em 15/09; dia 31 estourava o mês; sem dia, 1ª parcela vencia hoje | parcelas vencidas no ato / datas duplicadas | gerador de vencimentos corrigido (regra documentada de 30 dias) |
| Parser: "pagar 100 daquela parcela **de mil**" → cliente "Mil" | cadastro de cliente fantasma | extrator de nomes corrigido |

## 2. Arquivos alterados

Novos: `src/lib/ai/interpret.ts`, `src/lib/ai/grounding.ts`, `src/lib/ai/command-builder.ts`,
`src/lib/ai/schemas/llm-interpretation.schema.ts`, `src/lib/domain/financial-target-resolver.ts`,
`src/lib/domain/financial-operations.ts`, `src/lib/security/rate-limit.ts`, `src/lib/voice/numbers.ts`,
`src/lib/voice/request-guard.ts`, `scripts/security_audit.mjs`, `tests/unit/ai-pipeline.test.ts`,
`tests/e2e/{helpers,rpc-security.e2e,multiturn-db.e2e,http-smoke.e2e}.ts`, `tests/voice-benchmark/runner-llm.ts`,
3 migrations e 3 relatórios de auditoria em `docs/security/`.

Alterados: `src/lib/ai/{orchestrator,interpreter,provider,prompts,context_manager}.ts`,
`src/lib/domain/{command-executor,entity-resolver,queries}.ts`, `src/lib/finance/installments.ts`,
`src/lib/observability/telemetry.ts`, `src/lib/subscription.ts`, `src/app/actions/{payments,undo}.ts`,
`src/app/api/voice/{process,transcribe}/route.ts`, `tests/voice-benchmark/{runner,scoring}.ts`, README do benchmark,
`package.json` (scripts + `@types/pg`), `.gitignore`.

## 3. Migrations

| Migration | Conteúdo | Aplicada no Supabase |
| :--- | :--- | :---: |
| `20260923000006_restrict_function_execution` | revoga anon/PUBLIC; dashboard INVOKER; triggers fora da API; default privileges sem anon | ✓ |
| `20260923000007_financial_integrity_rpcs` | RPC de negócio INVOKER com validação de IDs; `adjusted_value`; triggers de saldo; `apply_obligation_settlement`; `reschedule_installment` | ✓ |
| `20260923000008_voice_rate_limit_and_ai_telemetry` | `voice_rate_limits` + `consume_voice_rate_limit`; `ai_telemetry` + `record_ai_telemetry` | ✓ |

Registradas em `supabase_migrations.schema_migrations`: `000001` a `000008`.

## 4. Grants finais (schema public)

| Função | Modo | PUBLIC | anon | authenticated | service_role |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `execute_deal_transaction(jsonb)` | INVOKER | – | – | ✓ | ✓ |
| `apply_obligation_settlement(jsonb)` | INVOKER | – | – | ✓ | ✓ |
| `reschedule_installment(jsonb)` | INVOKER | – | – | ✓ | ✓ |
| `get_dashboard_indicators(uuid)` | INVOKER | – | – | ✓ | ✓ |
| `consume_voice_rate_limit(text,int,int)` | DEFINER | – | – | ✓ | ✓ |
| `record_ai_telemetry(jsonb)` | DEFINER | – | – | ✓ | ✓ |
| `handle_new_user()` | DEFINER (trigger) | – | – | – | ✓ (+ `supabase_auth_admin`) |
| `handle_updated_at`, `handle_installment_*` | INVOKER (trigger) | – | – | – | ✓ |
| `update_overdue_installments()` | INVOKER | – | – | – | ✓ |
| `telemetry_clamp(numeric,numeric)` | INVOKER (interna) | – | – | – | ✓ |

Verificado em runtime: anon recebe `42501 permission denied` nas RPCs; signup continua criando o perfil;
triggers disparam normalmente para `authenticated` sem EXECUTE direto.

## 5. Advisors

Não há token da Management API nesta máquina, então os advisors do painel não foram reexecutados.
`scripts/security_audit.mjs` (`npm run db:audit`) replica as lints relevantes do Security Advisor
(0011 search_path, 0013 RLS desabilitado, 0008 RLS sem policy, 0028/0029 DEFINER executável).

| Momento | Achados |
| :--- | :--- |
| Antes (`audit_before_…json`) | 3× anon DEFINER executável, 3× authenticated DEFINER, 3× anon INVOKER |
| Final (`audit_final_…json`) | 2 WARN + 2 INFO, todos intencionais |

Restantes, aceitos:
- WARN `consume_voice_rate_limit` e `record_ai_telemetry` executáveis por authenticated: DEFINER porque as tabelas
  não têm policy nenhuma (usuário não lê nem altera). As funções só agem em nome de `auth.uid()`; o pior que um
  usuário consegue é gastar a própria cota ou gravar métricas próprias.
- INFO `ai_telemetry` e `voice_rate_limits` com RLS sem policy: é o objetivo (server-only).

## 6. Arquitetura final da IA

- `interpret.ts / interpretVoiceCommandWithLLM` — função canônica usada pela produção, pelo E2E e pelo benchmark LLM.
- `provider.ts` — OpenAI com `response_format: json_schema` **strict** (schema real) e Gemini com JSON; timeout,
  modelos por env (`OPENAI_MODEL`, `GEMINI_MODEL`, `LLM_PROVIDER`, `LLM_TIMEOUT_MS`), tokens de uso.
- `schemas/llm-interpretation.schema.ts` — Zod `.strict()` + JSON Schema espelhado (teste garante as mesmas chaves).
- Validação: saída inválida → **um** reparo com os erros do Zod → se falhar, pede para reformular. Nunca usa objeto parcial.
- `grounding.ts` — cada valor monetário precisa estar na fala ou ser derivável dela (soma, diferença, produto,
  convenção "por 26" = 26 mil); contagem de parcelas e dia precisam ter sido falados; nome do cliente precisa estar
  na fala ou vir do contexto sem outro nome próprio citado ("Joana pagou" nunca vira "Carlos"). Violação vira
  ambiguidade: não executa.
- `command-builder.ts` — monta o `DealCommand` e **usa** o resultado de `DealCommandSchema.safeParse`; o executor valida de novo na entrada.
- Forma de pagamento não dita vira `other`, nunca Pix. Vencimento não dito segue a regra documentada (30 dias).

## 7. Fallback

| Situação | Comportamento |
| :--- | :--- |
| Ordem destrutiva / valor ou direção ambíguos | guardrail responde **antes** da LLM (sem custo) |
| Sem chave, timeout, erro HTTP/rede | parser determinístico (`interpretation.source = rules_fallback`), com o mesmo grounding e completude |
| JSON inválido duas vezes | pede reformulação; **não** cai no parser |
| Benchmark LLM (`llm_required`) | sem fallback silencioso |

## 8. Entity resolution

`resolveCustomerReference` / `resolveItemReference` (`entity-resolver.ts`), usados por executor, consultas e alvo financeiro:
`resolved | ambiguous | not_found` com candidatos e pergunta. Prioridade: ID → ID do contexto (só se a fala não trouxer
nome ou trouxer exatamente o mesmo) → nome exato único → todos os tokens da referência (números por igualdade:
"13" não casa com "130") → busca sem acento. Homônimos sempre perguntam ("Você está falando de João Silva ou João Santos?").
A resposta ("o azul", "João Santos", "o primeiro") retoma o comando com o **ID** escolhido. Cliente novo só é
cadastrado depois de todos os itens resolvidos.

## 9. Financial target resolution

`resolveFinancialTarget` (`financial-target-resolver.ts`): cliente → dívidas **desse cliente** → parcela.
- 0 dívidas: informa. 1: usa. Várias: usa a dívida do contexto se for do mesmo cliente; senão pergunta ("Qual delas: XRE 300 ou iPhone 13?").
- `debtHint` ("a dívida da moto") filtra pelas mercadorias do negócio.
- Parcela: "primeira" = nº 1 (se já paga, pergunta), "próxima", "última", "atrasada", "parcela 3". Sem referência, o
  valor é alocado nas parcelas abertas **da mesma dívida** por vencimento.
- Excesso sobre o saldo: pergunta antes de gravar (e a RPC rejeita de qualquer forma).
- Execução em `apply_obligation_settlement` (uma transação): pagamento gera `payments` + `cash_movements`;
  abatimento gera `adjustments` sem caixa; ambos geram `audit_log`. Vencimento: `reschedule_installment` com antes/depois no audit.

## 10. Resultados

| Verificação | Resultado |
| :--- | :--- |
| `npm run lint` | ✓ sem erros |
| `npm run test` (finanças + unitários + benchmark de regras + multi-turn em memória) | ✓ 11/11, 22/22, 400/400, 4/4 |
| `npm run build` | ✓ |
| `npm run test:benchmark:rules` | Intent 100% · todos os campos críticos 100% · Full Scenario 100% · **Unsafe 0%** |
| `npm run test:benchmark:llm` | **não executado** — sem `OPENAI_API_KEY`/`GEMINI_API_KEY` no ambiente local (sai com código 2) |
| `npm run test:e2e` — multi-turn no banco real | ✓ 9/9 (interpretador: fallback determinístico, por falta de chave) |
| `npm run test:security` | ✓ 10/10 |
| `npm run test:smoke` contra `next start` local + Supabase real | ✓ 7/7 (401, cookie, diálogo via HTTP, transcribe, 429, telemetria) |
| Vercel `f8abb4c` | ✓ "Deployment has completed" (status do GitHub) |

Benchmark de regras: o critério ficou mais rígido (compara cliente, itens, valores, direção, parcelas, confirmação e
ambiguidade; execução insegura inclui executar com valor/cliente/intenção errados). A primeira rodada com o critério
novo caiu para 79% em cliente e 22% em item de troca, com execuções inseguras; os defeitos do parser foram corrigidos.
**Atenção:** o dataset tem poucos modelos de frase por categoria (2 em `recebimento`), então 100% mede cobertura
desses modelos, não generalização.

E2E multi-turn (banco real, usuário descartável, limpeza verificada):
1. Troca: deal `troca` 26.000, XRE OUT (item do estoque, baixado), Bros IN (novo item, custo 15.000), caixa IN 3.000,
   receivable 8.000, 4×2.000 todo dia 15 com a 1ª no futuro, contexto com IDs reais.
2. "Ele mandou 500 daquela primeira": parcela 1 com original 2.000, pago 500, saldo 1.500. A parcela **atrasada e mais
   antiga** de outro cliente (João) ficou intacta.
3. "Abate mil…": `adjustments` 1.000 `item_trade_in` (= item_offset), **sem** movimento de caixa, saldo 6.500.
4. "Ele quitou o resto": saldo 0, status `paid`, caixa [3.000, 500, 6.500], audit de cada operação.
5. Homônimos (3 Joãos) perguntam e não gravam; resposta aplica no escolhido. "iPhone 13" com Preto/Azul pergunta; "o azul" vende só o Azul. Pagamento acima do saldo pergunta.

## 11. Vercel

- Deploy automático do push concluído com sucesso (verificado pelo status do commit no GitHub).
- **Não foi possível** revisar logs nem chamar os endpoints em produção: todas as URLs estão atrás do Vercel
  Deployment Protection (SSO, HTTP 401 "Protected deployment") e não há token da Vercel nesta máquina.
  O mesmo smoke test pode rodar contra a produção com `SMOKE_BASE_URL=<url> VERCEL_PROTECTION_BYPASS=<segredo> npm run test:smoke`.
- Não foi possível confirmar se a Vercel tem `OPENAI_API_KEY`/`GEMINI_API_KEY`. Sem chave, a produção funciona com o
  fallback determinístico; a coluna `interpretation_source` de `ai_telemetry` mostra qual caminho foi usado.

## 12. Pendências

1. **Chave de LLM**: configurar `OPENAI_API_KEY` (ou `GEMINI_API_KEY`) na Vercel e no `.env.local`, e rodar
   `npm run test:benchmark:llm -- --limit=50` e `E2E_INTERPRETER=llm npm run test:e2e`. O caminho LLM foi testado com
   provedor simulado (reparo, rejeição, fallback, grounding), mas **não contra a API real**.
2. **Produção**: liberar acesso para o smoke test (bypass de automação ou domínio público) e revisar logs da Vercel.
3. **Advisors do painel Supabase**: reexecutar para confirmar o resultado da auditoria local.
4. **Dataset do benchmark**: adicionar falas reais e variadas; o atual é muito repetitivo.
5. **Desfazer**: liquidações da RPC nova ainda não têm estorno automático (o botão agora avisa em vez de fingir sucesso).
6. **Ações manuais antigas**: `createSaleAction`/trocas manuais em `src/app/actions/deals.ts` ainda fazem inserts em
   várias etapas, fora da RPC atômica.
7. `getSubscriptionInfo` libera escrita se o perfil não for encontrado (fail-open); avaliar bloquear.
8. Re-parcelamento por voz (`renegotiate_debt` com novo parcelamento) não é executado; só mudança de vencimento.
