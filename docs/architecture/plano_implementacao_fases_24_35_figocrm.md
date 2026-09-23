# Plano de Implementação — Fases 24 a 35 do FigoCRM

## Objetivo deste ciclo

Transformar o FigoCRM de um protótipo funcional em um núcleo confiável de SaaS **voice-first**.

O foco desta etapa NÃO é front-end definitivo.

O objetivo é garantir que o sistema consiga interpretar, validar e executar com segurança:

- vendas;
- compras;
- parcelamentos;
- promissórias;
- pagamentos parciais;
- abatimentos;
- trocas;
- trocas com volta;
- trocas com volta parcelada;
- múltiplas formas de pagamento;
- valores a receber;
- valores a pagar;
- renegociações;
- quitações;
- custos adicionais;
- CMV;
- lucro;
- contexto conversacional;
- ambiguidades.

Este documento cobre:

- Fase 24 — Hardening do banco
- Fase 25 — Contrato universal de negociação
- Fase 26 — Motor financeiro V2
- Fase 27 — Remoção de inferências financeiras perigosas
- Fase 28 — Voz real / Speech-to-Text
- Fase 29 — LLM real com Structured Output
- Fase 30 — Resolução de contexto
- Fase 31 — Desambiguação inteligente
- Fase 32 — Executor seguro de comandos
- Fase 33 — Negociações avançadas
- Fase 34 — Recebimentos e cobrança
- Fase 35 — Benchmark oficial da IA

---

# 1. Estado atual do projeto

O projeto já possui uma base inicial com:

- Next.js
- React
- TypeScript
- Supabase
- autenticação
- RLS
- tabelas do domínio
- clientes
- mercadorias
- negócios
- pagamentos
- undo
- motor financeiro inicial
- lógica de trial de 7 dias
- estrutura inicial de assinatura
- endpoint de voz baseado em texto
- orquestrador inicial de IA
- normalização textual
- contexto inicial
- observabilidade básica
- auditoria

Arquivos atuais relevantes:

```text
src/app/actions/customers.ts
src/app/actions/dashboard.ts
src/app/actions/deals.ts
src/app/actions/items.ts
src/app/actions/payments.ts
src/app/actions/undo.ts

src/app/api/voice/process/route.ts
src/app/api/webhooks/payment/route.ts

src/lib/ai/context_manager.ts
src/lib/ai/orchestrator.ts
src/lib/ai/prompts.ts

src/lib/financial_engine.ts
src/lib/subscription.ts
src/lib/voice/normalizer.ts
```

O objetivo deste ciclo é evoluir estes componentes sem criar lógica duplicada.

---

# 2. Regras de arquitetura obrigatórias

## 2.1 A LLM nunca grava diretamente no banco

Fluxo obrigatório:

```text
áudio
↓
transcrição
↓
LLM
↓
JSON estruturado
↓
schema validation
↓
domain validation
↓
executor
↓
transação
↓
banco
```

Nunca:

```text
LLM
↓
SQL
```

## 2.2 A LLM interpreta, o domínio decide

A IA pode identificar:

- intenção;
- cliente;
- mercadoria;
- valores mencionados;
- formas de pagamento;
- parcelas;
- datas;
- direção da troca;
- ambiguidades.

A IA NÃO decide:

- se os valores fecham;
- se a operação é financeiramente válida;
- qual saldo deve ser alterado;
- qual parcela deve ser quitada;
- qual CMV deve ser usado;
- se um abatimento pode exceder o saldo;
- se uma operação deve ser persistida.

Essas decisões pertencem ao backend.

## 2.3 Informação financeira ausente nunca deve ser inventada

Proibido usar valores padrão como:

```text
R$ 500
R$ 2.000
R$ 3.000
70% do valor de venda
```

quando o usuário não informou.

Valor ausente deve gerar:

```text
missing_information
```

ou:

```text
requires_confirmation
```

## 2.4 Toda operação precisa ser reversível e auditável

Toda ação deve registrar:

- user_id;
- origem;
- texto transcrito;
- interpretação;
- comando executado;
- estado anterior relevante;
- estado posterior;
- timestamp;
- vínculo com `ai_interactions`;
- vínculo com `audit_log`.

Quando possível, suportar:

```text
undo_operation
```

---

# FASE 24 — Hardening do banco

## Objetivo

Transformar o banco atual em uma base segura, versionada e reproduzível.

## 24.1 Criar baseline do schema atual

Gerar migrations que representem o estado atual do Supabase.

O repositório deve conseguir recriar o banco em um projeto Supabase novo sem configuração manual.

Estrutura esperada:

```text
supabase/
  migrations/
    <migration>_initial_schema.sql
```

Usar o fluxo oficial da Supabase CLI.

## 24.2 Validar RLS

Revisar:

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

Todas devem possuir:

- RLS enabled;
- policies específicas;
- ownership claro;
- UPDATE com USING + WITH CHECK;
- INSERT validando ownership;
- DELETE limitado ao proprietário.

## 24.3 Revisar SECURITY DEFINER

Revisar especialmente:

```text
get_dashboard_indicators
handle_new_user
```

Garantir:

- nenhum EXECUTE público desnecessário;
- validação de `auth.uid()` quando necessário;
- `search_path` explícito;
- grants mínimos.

## 24.4 Corrigir search_path mutável

Definir `search_path` explicitamente nas funções apontadas pelos advisors.

## 24.5 Testes multi-tenant

Usuário A cria dados.

Usuário B tenta:

- SELECT;
- UPDATE;
- DELETE;
- RPC;
- lookup indireto.

Resultado esperado:

```text
0 registros acessíveis
0 registros alterados
0 dados vazados
```

## Critério de aceite

- [ ] migrations reproduzem o schema
- [ ] projeto novo pode ser inicializado sem SQL manual
- [ ] RLS validada
- [ ] advisors críticos corrigidos
- [ ] SECURITY DEFINER revisado
- [ ] nenhum acesso cross-user
- [ ] audit_log funcional

---

# FASE 25 — Contrato universal de negociação

## Objetivo

Criar um formato único capaz de representar qualquer negócio relevante.

Criar:

```text
src/types/deal-command.ts
```

## Estrutura conceitual

```ts
export interface DealCommand {
  intent: 'create_deal'

  counterparty?: CounterpartyReference

  itemsIn: ItemMovement[]
  itemsOut: ItemMovement[]

  cashIn: CashMovementCommand[]
  cashOut: CashMovementCommand[]

  receivables: ReceivableCommand[]
  payables: PayableCommand[]

  adjustments: AdjustmentCommand[]

  notes?: string

  missingInformation: MissingInformation[]
  ambiguities: Ambiguity[]
}
```

## ItemMovement

```ts
interface ItemMovement {
  reference?: string
  itemId?: string
  description?: string
  negotiatedValue?: number
  acquisitionValue?: number
  direction: 'IN' | 'OUT'
}
```

## CashMovementCommand

```ts
interface CashMovementCommand {
  direction: 'IN' | 'OUT'
  amount: number
  method?: 'pix' | 'cash' | 'bank_transfer' | 'card' | 'other'
}
```

## ReceivableCommand / PayableCommand

Devem suportar:

- valor total;
- parcelamento;
- data inicial;
- dia fixo;
- promissória;
- parcelas manuais.

## AdjustmentCommand

```ts
interface AdjustmentCommand {
  type:
    | 'discount'
    | 'debt_offset'
    | 'service_offset'
    | 'item_offset'
    | 'manual_adjustment'

  amount: number
  reason?: string
}
```

## Validar balanço da negociação

Exemplo correto:

```text
Venda: R$ 8.000
Pix: R$ 2.000
Item recebido: R$ 2.000
A receber: R$ 4.000
```

Exemplo incorreto:

```text
Venda: R$ 8.000
Pix: R$ 2.000
Item: R$ 2.000
A receber: R$ 3.000
```

Falta R$ 1.000.

Não salvar.

Perguntar:

> “A conta ficou com R$ 1.000 sem forma de pagamento. Como ficou esse restante?”

## Critério de aceite

O contrato representa:

- [ ] venda à vista
- [ ] venda parcelada
- [ ] entrada + parcelas
- [ ] troca seca
- [ ] troca com volta
- [ ] volta recebida
- [ ] volta paga
- [ ] volta parcelada
- [ ] mercadoria + dinheiro
- [ ] mercadoria + parcelas
- [ ] dinheiro + mercadoria + parcelas
- [ ] abatimento

---

# FASE 26 — Motor financeiro V2

## Objetivo

Criar uma camada determinística completa.

Pode dividir:

```text
src/lib/finance/
  money.ts
  cmv.ts
  installments.ts
  settlements.ts
  deal-balance.ts
  trades.ts
  adjustments.ts
  profit.ts
```

## 26.1 Valores monetários

Preferir cálculos internos em centavos.

```text
R$ 19,90
→
1990
```

## 26.2 CMV

```text
CMV =
aquisição
+ reparos
+ transporte
+ documentos
+ peças
+ taxas
+ outros custos atribuíveis
```

Nenhum valor deve ser estimado.

## 26.3 Lucro

Separar:

```text
lucro projetado
lucro realizado
```

## 26.4 Parcelamento

Suportar:

- parcelas iguais;
- primeira diferente;
- última ajustada;
- dia fixo;
- intervalo;
- datas manuais;
- promissória.

## 26.5 Excesso de pagamento

Saldo:

```text
R$ 500
```

Pagamento:

```text
R$ 600
```

Resultado:

```text
effectivePaid = 500
excess = 100
```

Não aplicar excedente silenciosamente.

## 26.6 Pagamento distribuído

Priorizar parcelas mais antigas quando a regra automática estiver habilitada.

## Critério de aceite

- [ ] nenhum cálculo depende da LLM
- [ ] cálculos idempotentes
- [ ] parcelas fecham exatamente
- [ ] pagamentos parciais corretos
- [ ] abatimentos corretos
- [ ] CMV correto
- [ ] lucro correto
- [ ] trocas fecham matematicamente
- [ ] excesso tratado

---

# FASE 27 — Remoção de inferências perigosas

## Objetivo

Eliminar defaults financeiros artificiais do protótipo.

Auditar:

```text
src/lib/ai/orchestrator.ts
```

Pesquisar por:

```text
|| 500
|| 1000
|| 2000
|| 3000
* 0.7
* 0.5
```

## Proibir criação de custo estimado

Se o item não existe, não criar custo com base percentual.

Perguntar.

## MissingInformation

Criar algo equivalente:

```ts
type MissingInformation =
  | 'deal_total'
  | 'item_reference'
  | 'customer_reference'
  | 'acquisition_cost'
  | 'payment_breakdown'
  | 'installments_count'
  | 'installment_due_date'
  | 'trade_balance_direction'
```

## Critério de aceite

- [ ] zero valor monetário inventado
- [ ] zero item financeiro criado por suposição
- [ ] toda ausência relevante vira pergunta
- [ ] testes impedem regressão

---

# FASE 28 — Voz real / Speech-to-Text

## Objetivo

Receber áudio real no backend.

Criar endpoint como:

```text
POST /api/voice/transcribe
```

Entrada:

```text
multipart/form-data
audio=<blob>
```

## Formatos

Suportar pelo menos:

- webm
- m4a/mp4
- wav
- ogg

## Limites

Para o MVP:

```text
60–90 segundos por gravação
```

Adicionar:

- tamanho máximo;
- MIME permitido;
- timeout;
- rate limit.

## Pipeline

```text
MediaRecorder
↓
audio blob
↓
/api/voice/transcribe
↓
Speech-to-Text
↓
normalizer
↓
LLM
```

## Áudio

Por padrão:

```text
recebe
↓
transcreve
↓
processa
↓
descarta
```

Não armazenar indefinidamente.

## Critério de aceite

- [ ] gravação real no navegador
- [ ] endpoint recebe áudio
- [ ] transcrição pt-BR
- [ ] limites configurados
- [ ] erros tratados
- [ ] áudio temporário

---

# FASE 29 — LLM real com Structured Output

## Objetivo

Substituir regex como interpretador principal.

Criar schema validável:

```text
src/lib/ai/schemas/deal-command.schema.ts
```

Preferir:

- Zod;
- JSON Schema;
- Structured Output do provider.

## Exemplo

```json
{
  "intent": "create_deal",
  "counterparty": {
    "name": "Carlos"
  },
  "itemsOut": [
    {
      "reference": "XRE",
      "negotiatedValue": 26000
    }
  ],
  "itemsIn": [
    {
      "description": "Bros",
      "negotiatedValue": 15000
    }
  ],
  "cashIn": [
    {
      "amount": 3000,
      "method": "pix"
    }
  ],
  "receivables": [
    {
      "totalAmount": 8000,
      "installments": {
        "count": 4,
        "installmentAmount": 2000,
        "dueDayOfMonth": 15
      }
    }
  ],
  "missingInformation": [],
  "ambiguities": []
}
```

## Prompt obrigatório

Instruir o modelo a:

- não inventar valores;
- não corrigir números silenciosamente;
- não assumir direção da volta;
- marcar ausência;
- marcar ambiguidade;
- preservar valores ditos.

## Contexto enviado à LLM

Somente o necessário:

- clientes relevantes;
- itens relevantes;
- negociações recentes;
- dívidas abertas relacionadas;
- contexto conversacional atual.

## Critério de aceite

- [ ] saída validada por schema
- [ ] JSON inválido nunca executa ação
- [ ] nenhum fallback monetário
- [ ] missing_information funciona
- [ ] ambiguities funciona
- [ ] parser local deixa de ser o cérebro principal

---

# FASE 30 — Resolução de contexto

## Objetivo

Permitir conversa natural.

Exemplo:

```text
Usuário:
“Quanto Carlos me deve?”

Sistema:
“R$ 3.500.”

Usuário:
“Ele mandou 500.”
```

O sistema precisa saber:

```text
“ele” = Carlos
```

## Contexto persistente

Não guardar contexto importante apenas em memória do processo.

Criar algo equivalente:

```ts
interface ConversationContext {
  userId: string
  lastCustomer?: EntityReference
  lastItem?: EntityReference
  lastDeal?: EntityReference
  lastReceivable?: EntityReference
  pendingQuestion?: PendingQuestion
  expiresAt: string
}
```

## TTL

Exemplo:

```text
30 minutos
```

## Entity resolution

Se houver:

```text
João Silva
João Santos
```

e o usuário disser apenas:

> “João pagou.”

perguntar qual João.

## Critério de aceite

- [ ] “ele” funciona
- [ ] “aquele carro” funciona
- [ ] “a parcela dele” funciona
- [ ] cold start não destrói contexto crítico
- [ ] contexto expira
- [ ] isolamento por usuário

---

# FASE 31 — Desambiguação inteligente

## Objetivo

Perguntar apenas quando necessário.

## Tipos

### Valor

> “Ele me deu dois.”

### Cliente

> “João pagou.”

### Mercadoria

> “Vendi o iPhone.”

### Direção

> “Ficaram cinco de volta.”

### Parcela

> “Ele pagou aquela.”

## Confidence

Criar classificação:

```text
high
medium
low
```

Nunca executar ação financeira `low confidence`.

## Confirmação obrigatória

Quando houver:

- valor ambíguo;
- cliente ambíguo;
- item ambíguo;
- direção ambígua;
- operação destrutiva;
- conta que não fecha;
- alteração retroativa sensível.

## Critério de aceite

- [ ] perguntas curtas
- [ ] não repete informação desnecessária
- [ ] ambiguidade detectada antes da execução
- [ ] confirmação destrutiva obrigatória
- [ ] ação low-confidence nunca é gravada

---

# FASE 32 — Executor seguro de comandos

## Objetivo

Criar uma camada única entre IA e banco.

Sugestão:

```text
src/lib/domain/command-executor.ts
```

## Responsabilidades

```text
validateAuthentication
validateSubscription
validateCommandSchema
resolveEntities
validateFinancialBalance
validateBusinessRules
executeTransaction
createAuditLog
returnStructuredResult
```

## Transação

Uma negociação deve ser atômica.

Exemplo:

```text
deal
+ item OUT
+ item IN
+ Pix
+ receivable
+ 4 parcelas
```

Se qualquer etapa falhar:

```text
ROLLBACK
```

## Idempotência

Adicionar:

```text
idempotencyKey
```

Importante para:

- voz;
- retries;
- PWA futura;
- webhooks.

## Critério de aceite

- [ ] comando atômico
- [ ] rollback automático
- [ ] idempotência
- [ ] audit_log
- [ ] ai_interaction vinculada
- [ ] LLM nunca escreve diretamente no Supabase

---

# FASE 33 — Negociações avançadas

## Cenário A — Venda parcelada

> “Vendi o iPhone pro João por 3 mil. Ele deu mil no Pix e ficou quatro de 500.”

```text
OUT iPhone
cashIn 1000
receivable 2000
4 × 500
```

## Cenário B — Troca seca

> “Troquei meu iPhone no S23 dele, pau a pau.”

```text
OUT iPhone
IN S23
cash 0
```

## Cenário C — Volta recebida

> “Passei minha Bros de 18 na Titan dele de 14 e ele me voltou quatro.”

```text
OUT Bros 18000
IN Titan 14000
cashIn 4000
```

## Cenário D — Volta paga

> “Peguei a XRE por 20, dei minha Bros de 16 e completei quatro.”

```text
IN XRE 20000
OUT Bros 16000
cashOut 4000
```

## Cenário E — Volta parcelada recebida

> “Passei a XRE por 26, peguei a Bros dele por 15, três no Pix e os outros oito ficaram em quatro de dois.”

```text
OUT XRE 26000
IN Bros 15000
cashIn 3000
receivable 8000
4 × 2000
```

## Cenário F — Volta parcelada paga

> “Peguei o carro dele por 40, passei o meu por 30 e os outros dez vou pagar em cinco vezes.”

```text
IN 40000
OUT 30000
payable 10000
5 × 2000
```

## Cenário G — Abatimento com mercadoria

Dívida:

```text
4000
```

Fala:

> “Rafael me deu um iPhone de 2.500 pra abater.”

Resultado:

```text
adjustment 2500
remaining 1500
itemIn iPhone
acquisitionValue 2500
```

## Cenário H — Serviço como abatimento

> “Tira 300 porque ele fez a manutenção da minha moto.”

Registrar:

```text
service_offset = 300
```

Não como pagamento em dinheiro.

## Critério de aceite

Todos devem:

- [ ] fechar matematicamente
- [ ] gerar movimentos corretos
- [ ] atualizar estoque
- [ ] atualizar recebíveis/pagáveis
- [ ] gerar parcelas
- [ ] auditar tudo

---

# FASE 34 — Recebimentos e cobrança

## Pagamento simples

> “Carlos pagou 500.”

Resolver cliente + dívida.

## Pagamento parcial

Parcela:

```text
2000
```

Pagamento:

```text
500
```

Resultado:

```text
paid 500
balance 1500
status partially_paid
```

## Quitação

> “Carlos quitou.”

Se houver uma única dívida clara, quitar.

Se houver várias, perguntar.

## Antecipação

> “João adiantou duas parcelas.”

Quitar as duas próximas elegíveis.

## Pagamento genérico

> “João mandou 1.500.”

Se houver múltiplas parcelas, aplicar a regra configurada ou pedir confirmação.

## Renegociação

> “Junta as duas atrasadas e faz uma de 800 pro dia 20.”

Não apagar histórico.

Criar substituição auditável.

## Alteração de vencimento

> “Joga a parcela de sexta pro dia 15.”

Registrar:

```text
old_due_date
new_due_date
source
reason
```

## Consultas

Suportar:

```text
quanto_fulano_deve
quem_esta_atrasado
quanto_tenho_na_rua
qual_proxima_parcela
quanto_recebi_hoje
```

## Critério de aceite

- [ ] pagamento parcial
- [ ] quitação
- [ ] antecipação
- [ ] alocação automática
- [ ] renegociação
- [ ] mudança de vencimento
- [ ] consulta por cliente
- [ ] consulta geral
- [ ] histórico preservado

---

# FASE 35 — Benchmark oficial da IA

## Objetivo

Avaliar a IA objetivamente.

Criar:

```text
tests/voice-benchmark/
  cases.json
  runner.ts
  scoring.ts
  README.md
```

## Quantidade

Mínimo:

```text
300 casos
```

Meta:

```text
500+
```

## Distribuição sugerida

```text
40 vendas à vista
50 vendas parceladas
50 recebimentos
50 trocas
50 trocas com volta
40 abatimentos
40 renegociações
40 ambiguidades
40 consultas
```

## Estrutura

```json
{
  "id": "trade_return_installment_001",
  "input": "Passei a XRE por 26, peguei a Bros dele por 15, três no Pix e os outros oito ficaram em quatro de dois",
  "context": {},
  "expected": {
    "intent": "create_deal",
    "itemsOut": [
      {
        "reference": "XRE",
        "negotiatedValue": 26000
      }
    ],
    "itemsIn": [
      {
        "description": "Bros",
        "negotiatedValue": 15000
      }
    ],
    "cashIn": [
      {
        "amount": 3000,
        "method": "pix"
      }
    ],
    "receivables": [
      {
        "totalAmount": 8000,
        "installments": {
          "count": 4,
          "installmentAmount": 2000
        }
      }
    ]
  }
}
```

## Métricas

- Intent Accuracy
- Entity Accuracy
- Value Accuracy
- Direction Accuracy
- Installment Accuracy
- Date Accuracy
- Ambiguity Detection
- Unsafe Execution Rate
- Full Scenario Accuracy

Principal métrica:

```text
Full Scenario Accuracy
```

## Casos adversariais

Adicionar:

> “Ele me deu dois.”

> “Ficou cinco.”

> “João pagou aquela.”

> “Troquei e ele voltou três.”

> “Vendi por vinte e ficou dez.”

> “Apaga tudo.”

> “Marca tudo como pago.”

## Linguagem real do público

Adicionar:

```text
me voltou
dei de volta
ficou pra depois
ficou me devendo
botei por
passei por
peguei por
entrou na troca
ficou de promissória
mandou no Pix
acertou comigo
deu uma entrada
abate aí
tira da conta
joga pro mês que vem
```

## Critério de aceite

Antes do beta:

```text
Unsafe Execution Rate = 0%
```

Metas iniciais:

```text
Intent Accuracy >= 97%
Value Accuracy >= 99%
Direction Accuracy >= 99%
Ambiguity Detection >= 95%
Full Scenario Accuracy >= 90%
```

---

# 3. Ordem obrigatória de implementação

Executar nesta ordem:

```text
FASE 24
Banco seguro e reproduzível
↓
FASE 25
Contrato universal
↓
FASE 26
Motor financeiro V2
↓
FASE 27
Remover defaults perigosos
↓
FASE 32
Executor seguro
↓
FASE 33
Negociações avançadas
↓
FASE 34
Recebimentos
↓
FASE 28
Speech-to-Text
↓
FASE 29
LLM estruturada
↓
FASE 30
Contexto
↓
FASE 31
Desambiguação
↓
FASE 35
Benchmark
```

A Fase 32 deve vir antes de conectar LLM real ao banco.

---

# 4. Estratégia de branches

Sugestão:

```text
main
develop
feature/domain-v2
feature/voice-ai-v2
feature/benchmark
```

Fluxo:

```text
feature
↓
develop
↓
validação
↓
main
```

Evitar desenvolvimento direto no `main`.

---

# 5. Estratégia de commits

Preferir:

```text
feat(domain): add universal DealCommand schema
feat(finance): validate deal financial balance
fix(ai): remove monetary fallback values
feat(voice): add audio transcription endpoint
feat(ai): add structured deal extraction
feat(context): persist conversation context
test(ai): add installment voice benchmark
```

Evitar:

```text
att
update
fix
ajustes
```

---

# 6. Testes obrigatórios

## Unitários

```text
financial_engine
deal_balance
installments
payments
adjustments
entity_resolution
schema_validation
```

## Integração

```text
command
↓
executor
↓
Supabase
```

## E2E backend

```text
speech text
↓
LLM
↓
command
↓
executor
↓
database
```

## Segurança

```text
user A
≠
user B
```

---

# 7. Definition of Done deste ciclo

O ciclo só termina quando o sistema processar corretamente esta sequência:

## Operação inicial

Usuário:

> “Passei minha XRE pro Carlos por 26. Peguei a Bros dele por 15, ele mandou três no Pix e os outros oito ficaram em quatro de dois todo dia 15.”

Sistema:

> “Pronto. A XRE saiu por R$ 26 mil, a Bros entrou por R$ 15 mil, você recebeu R$ 3 mil no Pix e ficaram R$ 8 mil em quatro parcelas de R$ 2 mil.”

Banco:

```text
deal
item OUT XRE
item IN Bros
cash IN 3000
receivable 8000
4 installments
audit
AI interaction
```

## Pagamento parcial

Usuário:

> “Carlos mandou 500 daquela primeira.”

Sistema:

> “Pronto. Registrei R$ 500 na primeira parcela. Ainda faltam R$ 1.500 nela.”

## Abatimento

Usuário:

> “Abate mais mil porque ele ficou com meu som.”

Sistema:

> “Certo. Abati R$ 1.000 da dívida. Esse valor ficou registrado como abatimento, não como pagamento.”

## Quitação

Usuário:

> “Ele quitou o resto.”

Sistema:

> “Pronto. A dívida dessa negociação ficou quitada.”

---

# 8. O que NÃO fazer neste ciclo

Não priorizar agora:

- front-end sofisticado;
- animações;
- PWA completa;
- push notification;
- dashboard avançado;
- gráficos;
- marketplace;
- múltiplos planos;
- múltiplos usuários por conta;
- emissão fiscal;
- integrações não essenciais.

O front-end deve permanecer apenas funcional.

---

# 9. Resultado esperado

Ao concluir as fases 24–35:

- banco versionado;
- RLS validada;
- contrato universal;
- motor financeiro determinístico;
- voz real;
- Speech-to-Text;
- LLM com Structured Output;
- contexto conversacional;
- desambiguação;
- executor seguro;
- negociações complexas;
- pagamentos parciais;
- abatimentos;
- trocas;
- voltas;
- parcelamentos;
- recebíveis;
- pagáveis;
- auditoria;
- undo;
- benchmark automatizado.

Próximo ciclo:

```text
assinatura real
↓
front-end definitivo
↓
PWA
↓
onboarding
↓
beta
↓
lançamento
```

---

# 10. Regra final para a IA de desenvolvimento

Ao executar este plano:

1. Ler o código existente antes de alterar estruturas.
2. Reaproveitar regras já corretas.
3. Não duplicar domínio.
4. Não inventar valores financeiros.
5. Não permitir acesso cross-user.
6. Não conectar a LLM diretamente ao banco.
7. Criar testes para cada regra financeira.
8. Versionar mudanças no banco.
9. Rodar advisors do Supabase.
10. Validar build antes do commit.
11. Manter deploy da Vercel funcional.
12. Documentar decisões arquiteturais relevantes.

Prioridade:

> **confiabilidade financeira antes de conveniência.**

O diferencial é a voz.

Mas a voz só terá valor se tudo que ela registrar estiver correto.
