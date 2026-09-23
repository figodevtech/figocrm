Você está trabalhando no repositório:

`figodevtech/figocrm`

Branch principal atual:

`main`

Antes de alterar qualquer arquivo, leia o projeto inteiro relevante e entenda o estado atual da implementação.

O FigoCRM é um SaaS voice-first para vendedores, revendedores e negociadores independentes que trabalham com compras, vendas, trocas, promissórias, parcelas, abatimentos e valores “na rua”.

O usuário não deve precisar entender ERP.

A experiência principal será:

> usuário fala → sistema entende → valida → salva corretamente.

O projeto já possui boa parte das Fases 24–35 implementadas, mas uma revisão técnica identificou que algumas fases ainda estão apenas parcialmente concluídas.

Seu trabalho agora é corrigir essas lacunas e transformar a implementação atual em algo realmente confiável para produção.

---

# REGRA PRINCIPAL

Não reescreva o projeto do zero.

Leia e reaproveite o que já existe.

Arquivos importantes já presentes:

```text
src/types/deal-command.ts

src/lib/finance/
  money.ts
  cmv.ts
  installments.ts
  settlements.ts
  deal-balance.ts
  trades.ts
  adjustments.ts
  profit.ts

src/lib/domain/command-executor.ts

src/lib/ai/
  orchestrator.ts
  context_manager.ts
  disambiguation.ts
  schemas/deal-command.schema.ts

src/app/api/voice/transcribe/route.ts

tests/voice-benchmark/
  cases.json
  runner.ts
  scoring.ts

supabase/migrations/
```

Há também:

```text
docs/architecture/plano_implementacao_fases_24_35_figocrm.md
```

Leia esse documento antes de iniciar.

---

# PROBLEMAS ATUAIS IDENTIFICADOS

## 1. Migration existe no Git, mas não está refletida no banco conectado

Existe:

```text
supabase/migrations/20260923000004_db_hardening_security.sql
```

Porém o Supabase conectado ainda apresenta:

- nenhuma migration registrada;
- warnings de `function_search_path_mutable`;
- funções `SECURITY DEFINER` ainda executáveis por roles inadequadas.

Funções atualmente apontadas:

```text
handle_updated_at
handle_new_user
handle_installment_payment_received
get_dashboard_indicators
update_overdue_installments
```

Antes de aplicar qualquer migration:

1. inspecione o banco atual;
2. compare migration com schema real;
3. verifique se aplicar a migration é seguro;
4. ajuste a migration se necessário;
5. aplique corretamente;
6. rode os advisors novamente.

Objetivo:

```text
Git
=
schema real do Supabase
=
migration history
```

Não crie drift adicional.

---

# FASE A — HARDENING REAL DO SUPABASE

Revisar e aplicar o hardening do banco.

## Corrigir

### search_path

Todas as funções relevantes devem possuir `search_path` explícito.

### SECURITY DEFINER

Revisar:

```text
handle_new_user
get_dashboard_indicators
```

Aplicar princípio de menor privilégio.

Funções destinadas apenas a triggers não devem ficar livremente executáveis via API.

### RPCs

Garantir que um usuário autenticado nunca consiga passar:

```text
p_user_id = outro usuário
```

e acessar dados de terceiros.

### RLS

Revalidar todas as tabelas:

```text
profiles
customers
items
item_costs
deals
deal_items
cash_movements
receivables
payables
installments
payments
adjustments
ai_interactions
audit_log
```

Criar ou atualizar testes cross-user.

Usuário A cria registros.

Usuário B tenta:

```text
SELECT
INSERT relacionado
UPDATE
DELETE
RPC
```

Resultado obrigatório:

```text
nenhum vazamento
nenhuma alteração
```

Após alterações:

- executar advisors de segurança;
- corrigir problemas relevantes;
- documentar os warnings que permanecerem intencionalmente.

---

# FASE B — EXECUTOR REALMENTE ATÔMICO

Hoje existe:

```text
src/lib/domain/command-executor.ts
```

Ele já possui:

- autenticação;
- trial/assinatura;
- validação financeira;
- resolução de item;
- criação de negócio;
- recebíveis;
- parcelas;
- audit trail;
- tentativa de rollback.

Porém o rollback atual é feito em TypeScript através de `rollbackStack`.

Isso NÃO é uma transação PostgreSQL real.

Corrigir.

---

## Objetivo

Uma negociação precisa ser salva em uma única transação.

Exemplo:

```text
deal
+
item OUT
+
item IN
+
cash movement
+
receivable
+
installments
+
audit
```

Se qualquer parte falhar:

```text
ROLLBACK COMPLETO
```

Não pode ficar:

- deal sem parcelas;
- item baixado sem recebível;
- recebível sem installments;
- item recebido no estoque sem negócio;
- movimentação de caixa órfã.

---

## Implementação sugerida

Criar uma função/RPC PostgreSQL transacional específica.

Exemplo conceitual:

```text
execute_deal_transaction(...)
```

Não é obrigatório usar exatamente esse nome.

A função deve receber dados já validados pelo backend.

A LLM NÃO chama a RPC diretamente.

Fluxo:

```text
LLM
↓
DealCommand
↓
Zod
↓
validação financeira TypeScript
↓
resolução de IDs
↓
RPC transacional
↓
PostgreSQL
```

Não coloque interpretação de linguagem natural no SQL.

---

## Idempotência

Hoje existe tentativa baseada em:

```text
notes = idempotency:<key>
```

Melhorar isso.

Criar mecanismo explícito de idempotência.

Pode ser:

```text
idempotency_key
```

na própria `deals`

ou tabela separada.

Adicionar UNIQUE apropriado por usuário.

Exemplo:

```text
UNIQUE(user_id, idempotency_key)
```

Retry da mesma operação nunca deve criar dois negócios.

---

# FASE C — TODA OPERAÇÃO DE BANCO PRECISA VALIDAR ERRO

Auditar especialmente:

```text
command-executor.ts
```

Existem inserts/updates onde o retorno de `error` pode não estar sendo verificado.

Nenhuma operação crítica pode fazer:

```ts
await supabase.from(...).insert(...)
```

e simplesmente seguir.

Sempre tratar erro.

Porém, depois de mover a persistência principal para uma RPC transacional, a maior parte disso deve ficar centralizada.

---

# FASE D — LLM REAL COM STRUCTURED OUTPUT

Hoje o orquestrador ainda usa predominantemente:

```text
parseIntentLocallyOrLLM()
```

com regex e heurísticas.

Isso deve mudar.

Regex pode continuar existindo apenas para:

- normalização;
- identificação rápida de comandos destrutivos;
- guardrails;
- fallback de emergência.

Mas o interpretador semântico principal deve ser um LLM real.

---

## Provider

O projeto já trabalha com variáveis como:

```text
OPENAI_API_KEY
GEMINI_API_KEY
```

Implemente uma camada de provider limpa.

Exemplo:

```text
src/lib/ai/provider.ts
```

Não espalhar `fetch()` do provider pelo projeto inteiro.

---

## Structured Output

Usar o schema já existente:

```text
src/lib/ai/schemas/deal-command.schema.ts
```

ou corrigir esse schema se necessário.

Fluxo obrigatório:

```text
fala
↓
LLM
↓
JSON
↓
DealCommandSchema.safeParse()
```

Se `safeParse()` falhar:

```text
NÃO executar
```

Gerar erro interno controlado e pedir nova interpretação quando apropriado.

---

# REGRA ABSOLUTA

A LLM nunca pode inventar:

```text
preço
custo
valor de entrada
quantidade de parcelas
valor da parcela
cliente
item
direção da volta
data de vencimento
```

Se estiver faltando:

```text
missingInformation
```

Se estiver ambíguo:

```text
ambiguities
```

---

# EXEMPLO

Usuário:

> “Vendi a Bros pro João.”

Resultado esperado:

```json
{
  "intent": "create_deal",
  "counterparty": {
    "name": "João"
  },
  "itemsOut": [
    {
      "reference": "Bros",
      "direction": "OUT"
    }
  ],
  "missingInformation": [
    {
      "type": "deal_total",
      "promptQuestion": "Por quanto você vendeu a Bros?"
    }
  ]
}
```

Nunca:

```text
R$ 15.000 presumidos
```

---

# FASE E — CONTEXTO CONVERSACIONAL PERSISTENTE

Hoje:

```text
src/lib/ai/context_manager.ts
```

usa algo equivalente a:

```ts
const contextStore = new Map()
```

Isso não é aceitável na Vercel.

Cold start e múltiplas instâncias quebram o contexto.

---

## Implementar persistência

Preferência inicial:

```text
Supabase
```

Criar tabela como:

```text
conversation_context
```

ou equivalente.

Campos conceituais:

```text
user_id
last_customer_id
last_item_id
last_deal_id
last_receivable_id
pending_question
pending_command
pending_confirmation
expires_at
updated_at
```

Não armazenar dados desnecessários.

RLS obrigatória:

```text
user_id = auth.uid()
```

---

## TTL

Contexto expira após:

```text
30 minutos
```

Renovar TTL a cada interação.

---

## Deve funcionar

Usuário:

> “Quanto Carlos me deve?”

Sistema:

> “R$ 3.500.”

Depois:

> “Ele mandou 500.”

O sistema deve entender:

```text
ele = Carlos
```

Mesmo que a segunda requisição caia em outra instância Vercel.

---

# FASE F — ENTITY RESOLUTION

Não usar simplesmente:

```text
.ilike('%joão%').limit(1)
```

e selecionar o primeiro resultado silenciosamente.

Se houver:

```text
João Silva
João Santos
```

e usuário disser:

> “João pagou 500.”

Responder:

> “João Silva ou João Santos?”

O mesmo vale para mercadorias.

Exemplo:

```text
iPhone 13 Preto
iPhone 13 Azul
```

---

# FASE G — VOZ: AUTENTICAÇÃO E CONTROLE DE CUSTO

Já existe:

```text
POST /api/voice/transcribe
```

A implementação já transcreve áudio real.

Agora endurecer.

---

## Antes de chamar STT

Verificar:

1. usuário autenticado;
2. trial/assinatura válida quando aplicável;
3. rate limit;
4. limite de áudio;
5. limite de requisições.

Não gastar OpenAI/Gemini antes de autenticar.

---

## Observabilidade

Registrar:

```text
user_id
provider
audio_duration_ms
audio_size
transcription_latency_ms
LLM_latency_ms
total_latency_ms
estimated_cost
success/failure
```

Nunca registrar chave de API.

Evitar guardar áudio.

---

# FASE H — REFATORAR O BENCHMARK

Hoje existe:

```text
tests/voice-benchmark/runner.ts
```

Porém ele possui um problema crítico:

O runner usa:

```text
c.category
```

para decidir qual intenção o sistema “previu”.

Isso invalida a medição.

Além disso existe:

```ts
const valueMatch = true;
```

Isso também invalida a métrica.

Corrigir completamente.

---

# O BENCHMARK DEVE TESTAR O MESMO PIPELINE DE PRODUÇÃO

Criar uma função pura/reutilizável como:

```text
interpretVoiceCommand()
```

Ela recebe:

```text
texto
contexto
```

e retorna:

```text
DealCommand / QueryCommand / PaymentCommand...
```

O endpoint real usa essa função.

O benchmark também usa essa função.

---

## O benchmark NÃO pode saber antecipadamente

```text
category
expected intent
expected direction
expected value
```

para gerar a resposta.

Esses campos servem apenas para comparação posterior.

---

# Métricas reais

Calcular de verdade:

### Intent Accuracy

### Customer Accuracy

### Item Accuracy

### Value Accuracy

Comparar:

```text
sale value
cash in
cash out
receivable
payable
adjustment
```

### Direction Accuracy

Comparar:

```text
item IN/OUT
cash IN/OUT
receivable/payable
```

### Installment Accuracy

```text
count
amount
due day
first due date
```

### Ambiguity Detection

### Unsafe Execution Rate

Meta obrigatória:

```text
0%
```

### Full Scenario Accuracy

Só conta como correto quando o cenário inteiro estiver correto.

---

# FASE I — TESTE COMPLETO DE CONVERSAÇÃO

Criar teste automatizado ou integração reproduzível para esta sequência.

## 1. Negociação inicial

Usuário:

> “Passei minha XRE pro Carlos por 26. Peguei a Bros dele por 15, ele mandou três no Pix e os outros oito ficaram em quatro de dois todo dia 15.”

Esperado:

```text
XRE OUT: 26.000
Bros IN: 15.000
Cash IN: 3.000
Receivable: 8.000
Installments: 4 × 2.000
Due day: 15
```

---

## 2. Pagamento parcial

Usuário:

> “Ele mandou 500 daquela primeira.”

Esperado:

```text
Carlos
Primeira parcela
Original: 2.000
Pago: 500
Saldo: 1.500
```

---

## 3. Abatimento

Usuário:

> “Abate mil porque ele ficou com meu som.”

Esperado:

```text
Adjustment:
type = item_offset ou categoria equivalente
amount = 1.000

NÃO registrar como cash payment
```

---

## 4. Quitação

Usuário:

> “Ele quitou o resto.”

Esperado:

```text
saldo correto = 0
```

---

# FASE J — CONSULTAS POR VOZ

Implementar ou validar intenções read-only como:

```text
quanto_fulano_deve
quem_esta_atrasado
quanto_tenho_na_rua
quanto_tenho_em_mercadoria
quanto_ganhei_esse_mes
qual_proxima_parcela
quanto_recebi_hoje
```

Essas consultas devem usar o mesmo contexto conversacional.

Exemplo:

> “Quanto João deve?”

Depois:

> “E qual a próxima dele?”

---

# FASE K — TESTES

Rodar:

```bash
npm run lint
npm run test
npm run build
```

Adicionar testes unitários para:

```text
DealCommand schema
deal balance
money cents
installments
trade direction
payments
partial payments
adjustments
entity resolution
context TTL
idempotency
```

Adicionar integração para:

```text
DealCommand
↓
executor
↓
Supabase
```

---

# SUPABASE

Após aplicar migrations:

1. verificar migrations;
2. rodar advisors;
3. validar RLS;
4. validar funções;
5. executar testes multi-tenant.

Não assumir que criar arquivo SQL no repositório significa que a migration foi aplicada.

---

# VERCEL

Após alterações:

1. build local;
2. commit;
3. push;
4. aguardar deploy;
5. verificar status;
6. verificar runtime errors;
7. testar endpoint de voz;
8. testar autenticação.

Não quebrar o deploy atual.

---

# SEGURANÇA

Nunca:

- enviar `SUPABASE_SERVICE_ROLE_KEY` ao browser;
- expor API keys;
- permitir RPC privilegiada ao usuário sem validação;
- usar `user_id` enviado pelo client como fonte de autorização;
- permitir LLM gerar SQL;
- permitir usuário acessar outro tenant.

Sempre usar:

```text
auth.uid()
```

ou identidade server-side confiável.

---

# COMMITS

Não usar commits como:

```text
att
fix
update
```

Usar mensagens claras:

```text
fix(db): apply security hardening migration
feat(domain): make deal persistence transactional
feat(ai): add structured LLM deal interpreter
feat(context): persist voice conversation context
fix(voice): authenticate before transcription
test(ai): run production interpreter in benchmark
```

---

# DEFINITION OF DONE

Considere este ciclo concluído somente quando:

- [ ] migration de hardening está aplicada no Supabase
- [ ] migration history não está vazia
- [ ] advisors de segurança relevantes foram corrigidos
- [ ] contexto não depende de `Map` em memória
- [ ] executor usa transação PostgreSQL real
- [ ] idempotência possui garantia no banco
- [ ] LLM real interpreta Structured Output
- [ ] Zod valida antes da execução
- [ ] nenhum valor financeiro é inventado
- [ ] STT autentica antes de consumir provider
- [ ] entity resolution detecta homônimos
- [ ] benchmark usa o interpretador real
- [ ] `valueMatch` não é hardcoded
- [ ] benchmark não usa category para prever intent
- [ ] Unsafe Execution Rate = 0%
- [ ] cenário completo XRE/Bros/Carlos funciona
- [ ] `npm run lint` passa
- [ ] `npm run test` passa
- [ ] `npm run build` passa
- [ ] deploy Vercel fica READY
- [ ] sem novos erros críticos de runtime

---

# PRIORIDADE DE EXECUÇÃO

Execute nesta ordem:

```text
1. Inspeção completa
2. Supabase hardening
3. Transação real + idempotência
4. LLM Structured Output
5. Contexto persistente
6. Entity resolution
7. Segurança/custo do STT
8. Benchmark real
9. Conversação multi-turn
10. Testes
11. Build
12. Deploy
13. Validação final
```

Não trabalhe no front-end definitivo ainda.

Não implemente PWA neste ciclo.

Não adicione funcionalidades fora deste escopo.

Ao finalizar, produza um relatório em Markdown contendo:

```text
arquivos alterados
migrations aplicadas
decisões arquiteturais
problemas encontrados
problemas corrigidos
testes executados
resultado do benchmark
resultado dos advisors
resultado do build
resultado do deploy
pendências restantes
```

A prioridade deste ciclo é:

> **transformar o núcleo atual em uma infraestrutura confiável de produção antes de continuar adicionando funcionalidades.**