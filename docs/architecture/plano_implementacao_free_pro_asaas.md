# Plano de Implementação — FigoCRM Free + Pro + Asaas

**Projeto:** `figodevtech/figocrm`  
**Data do plano:** 24/09/2026  
**Status:** pronto para implementação  
**Escopo:** evolução do modelo comercial atual (trial + bloqueio) para **Free permanente + Pro mensal**, preservando a arquitetura de segurança, RLS, billing e voice-first já existente.

---

## 1. Decisões de produto aprovadas

### Plano Free

- **R$ 0 para sempre**.
- 1 usuário por conta.
- Até **10 clientes cadastrados**.
- Continua usando os módulos operacionais existentes:
  - clientes;
  - estoque;
  - vendas;
  - trocas;
  - empréstimos;
  - recebimentos;
  - dashboard;
  - consultas e edição dos dados já existentes.
- IA/voz com cota mensal reduzida.
- Ao alcançar 10 clientes:
  - não bloquear login;
  - não bloquear leitura;
  - não bloquear vendas/recebimentos para clientes existentes;
  - não apagar nem ocultar dados;
  - bloquear somente a criação do **11º cliente**;
  - exibir CTA para upgrade.

### Plano Pro

- **R$ 24,50/mês**.
- Clientes sem limite comercial.
- IA/voz com cota ampliada.
- Demais recursos premium futuros devem usar a mesma camada de entitlements.
- Gateway escolhido: **Asaas**.

### Trial

- Todo novo cadastro continua recebendo **7 dias de Pro grátis**.
- Não exigir cartão para criar a conta.
- Durante o trial, o usuário possui os entitlements do Pro.
- Se o trial terminar sem pagamento:
  - o usuário **não perde o CRM**;
  - passa automaticamente para o plano Free;
  - seus dados permanecem;
  - se já possuir mais de 10 clientes, continua vendo e operando esses clientes, mas não pode criar novos até assinar o Pro ou reduzir a quantidade abaixo do limite.

### Fluxo comercial alvo

```text
Criar conta
    ↓
7 dias de Pro grátis
    ↓
┌───────────────────────┬──────────────────────────┐
│ Assinou Pro           │ Não assinou             │
│ R$ 24,50/mês          │                          │
│                       │                          │
│ PRO                   │ FREE permanente          │
│ clientes ilimitados   │ até 10 clientes          │
│ IA ampliada           │ IA limitada              │
└───────────────────────┴──────────────────────────┘
```

---

# 2. Diagnóstico do projeto atual

O projeto já possui uma fundação forte para essa mudança. A implementação **não deve criar um segundo sistema de assinatura em paralelo**.

## 2.1 Stack encontrada

- Next.js 16.3.6
- React 19.2.8
- TypeScript
- Supabase Auth/Postgres/RLS
- PostgreSQL/RPCs para operações críticas
- testes unitários, E2E, segurança e benchmark de voz

Antes de alterar código Next.js, seguir obrigatoriamente `AGENTS.md` e consultar a documentação correspondente em `node_modules/next/dist/docs/`.

---

## 2.2 Billing já existe como abstração neutra

Arquivos:

```text
src/lib/billing/types.ts
src/lib/billing/registry.ts
src/lib/billing/service.ts
src/lib/billing/webhook.ts
src/app/api/billing/status/route.ts
src/app/api/webhooks/payment/route.ts
```

Já existe:

- interface `BillingProvider`;
- registro de provider via `BILLING_PROVIDER`;
- normalização de eventos;
- persistência de `provider_customer_id`;
- persistência de `provider_subscription_id`;
- tabela `billing_events`;
- idempotência por `(provider, event_id)`;
- webhook único;
- uso de `service_role` somente no servidor.

### Conclusão

**Não substituir essa arquitetura.**

Implementar o Asaas como uma implementação concreta de `BillingProvider`.

---

## 2.3 Assinatura atual é fail-closed

Arquivos principais:

```text
src/lib/subscription.ts
supabase/migrations/20260923000010_subscriptions_fail_closed.sql
tests/e2e/subscription.e2e.ts
```

Hoje a regra é:

```text
trialing → pode escrever durante 7 dias
active → pode escrever
past_due → carência de 3 dias
canceled → escreve até o fim do período pago
expired → bloqueia escrita
blocked → bloqueia escrita
sem subscription → bloqueia escrita
```

Há um trigger de banco que protege as tabelas de negócio e impede escrita quando `subscription_access().can_write = false`.

Isso é bom do ponto de vista de segurança, mas precisa mudar conceitualmente:

> `expired` não deve mais significar "CRM travado".  
> Deve significar "billing pago não está ativo", fazendo a conta cair para o **Free**.

---

## 2.4 Divergência de preço encontrada

O projeto atual ainda usa:

```text
R$ 24,90/mês
2490 centavos
```

em:

```text
src/lib/subscription.ts
src/lib/billing/types.ts
supabase/migrations/20260923000010_subscriptions_fail_closed.sql
plano_fases_saas_voice_first.md
```

Valor aprovado agora:

```text
R$ 24,50/mês
2450 centavos
```

### Regra de migration

**Não editar migrations antigas que já podem ter sido aplicadas.**

Criar nova migration alterando defaults, dados existentes aplicáveis e funções.

---

# 3. Princípio arquitetural da mudança

Separar três conceitos:

```text
1. billing_status
2. effective_plan
3. entitlements
```

## 3.1 Billing status

Continuar usando estados semelhantes aos atuais:

```ts
type BillingStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'blocked'
```

Esses estados dizem respeito ao relacionamento comercial/cobrança.

Eles **não devem, sozinhos, decidir quais funcionalidades o usuário pode usar**.

---

## 3.2 Plano efetivo

Adicionar conceito calculado:

```ts
type EffectivePlan = 'free' | 'pro'
```

Regra:

| Billing | Condição | Plano efetivo |
|---|---|---|
| `trialing` | trial ainda válido | `pro` |
| `trialing` | trial terminou | `free` |
| `active` | período válido | `pro` |
| `active` | renovação dentro da carência | `pro` |
| `active` | renovação vencida além da carência | `free` |
| `past_due` | dentro da carência | `pro` |
| `past_due` | carência terminou | `free` |
| `canceled` | período pago ainda válido | `pro` |
| `canceled` | período acabou | `free` |
| `expired` | — | `free` |
| `blocked` | — | conta administrativamente bloqueada |

### Segurança

Casos anormais continuam **fail-closed**:

```text
subscription ausente
usuário não autenticado
falha inesperada ao calcular entitlement
dados inconsistentes
```

Não transformar falha de infraestrutura em Free automaticamente.

---

# 4. Entitlements

Criar uma camada única para responder:

```text
qual plano este usuário possui?
pode escrever?
pode criar outro cliente?
quantos clientes tem?
qual é o limite?
pode usar IA agora?
quantos comandos de IA restam no mês?
```

## 4.1 Estrutura recomendada

Criar uma tabela controlada pelo sistema:

```sql
plan_entitlements
```

Sugestão:

```text
plan_code
display_name
customer_limit
voice_monthly_limit
is_paid
created_at
updated_at
```

Seed inicial:

| plan_code | clientes | voz/IA por mês | pago |
|---|---:|---:|---|
| `free` | 10 | 20 | não |
| `pro` | NULL | 1000 | sim |

### Observações

- `NULL` em `customer_limit` = sem limite comercial.
- A cota `20` do Free é valor inicial, centralizado e fácil de alterar.
- `1000` no Pro é um **guardrail operacional**, não precisa ser anunciado como limite comercial.
- Manter também os rate limits já existentes por minuto/hora contra abuso.
- Não espalhar `10`, `20`, `1000` ou `2450` pelo código.

---

# 5. Migration 1 — Free/Pro e novo cálculo de acesso

Criar:

```text
supabase/migrations/20260924000001_free_pro_entitlements.sql
```

## 5.1 Atualizar preço comercial

Atualizar novos registros para:

```text
price_cents = 2450
```

Migrar registros ainda no modelo antigo quando seguro:

```sql
UPDATE subscriptions
SET price_cents = 2450
WHERE price_cents = 2490
  AND plan_code = 'figo_mensal';
```

Preferencialmente renomear o código comercial para algo explícito:

```text
figo_pro_mensal
```

Se o rename aumentar demais o risco de compatibilidade nesta fase, manter `figo_mensal` internamente e tratar o nome comercial como Pro.

---

## 5.2 Criar `plan_entitlements`

Requisitos:

- RLS habilitado.
- usuários autenticados podem no máximo ler os valores públicos do catálogo;
- somente migration/service role altera;
- constraints impedem valores negativos;
- seed idempotente.

---

## 5.3 Evoluir `subscription_access()`

Não destruir a função atual se puder ser evoluída de modo compatível.

Retorno desejado:

```text
status
effective_status
effective_plan
can_read
can_write
reason
trial_ends_at
current_period_end
grace_until
cancel_at_period_end
customer_limit
voice_monthly_limit
```

Exemplo conceitual:

```sql
CASE
  WHEN billing válido de Pro THEN 'pro'
  WHEN status = 'blocked' THEN 'blocked'
  ELSE 'free'
END
```

### `can_write`

Passa a significar:

```text
Free → true
Pro → true
Blocked → false
Missing/inconsistente → false
```

Consequentemente, o trigger global `enforce_write_access` continua protegendo o banco, mas deixa de transformar trial vencido em bloqueio geral.

---

# 6. Limite de 10 clientes — enforcement obrigatório no banco

Esta regra é crítica porque o FigoCRM cria clientes por múltiplos caminhos:

- formulário;
- server actions;
- voice-first;
- cliente provisório/avulso;
- RPCs e fluxos de negociação.

Bloquear apenas o botão da interface seria facilmente contornável.

## 6.1 Regra oficial

Plano Free:

```text
customers existentes < 10  → pode inserir
customers existentes >= 10 → não pode inserir
```

Plano Pro:

```text
sem limite comercial
```

### Contagem

Contar **todos os registros persistidos em `customers`**, inclusive:

```text
is_provisional = true
```

Motivo: excluir clientes provisórios da contagem permitiria criar registros ilimitados pela voz e furar o Free.

Ao vincular um provisório a um cliente existente, a quantidade naturalmente diminui.

---

## 6.2 Trigger dedicado

Criar função:

```text
enforce_customer_plan_limit()
```

e trigger:

```text
BEFORE INSERT ON public.customers
```

### Concorrência

Não implementar somente:

```sql
SELECT count(*)
```

sem serialização.

Duas requisições simultâneas poderiam enxergar `9` e ambas inserir, chegando a `11`.

Antes de contar, serializar a operação do usuário, por exemplo bloqueando a linha de `subscriptions`:

```sql
SELECT user_id
FROM subscriptions
WHERE user_id = auth.uid()
FOR UPDATE;
```

Depois contar e validar.

### Erro estruturado

Ao atingir o limite:

```text
SQLSTATE: 42501 ou código controlado do projeto
HINT: FREE_CUSTOMER_LIMIT
```

Mensagem de produto:

> Você chegou aos 10 clientes do plano grátis. Assine o Pro por R$ 24,50/mês para cadastrar novos clientes. Seus dados continuam disponíveis.

---

## 6.3 O que NÃO bloquear

Ao chegar a 10 clientes, continuar permitindo:

- editar cliente;
- excluir cliente, se a regra de negócio permitir;
- vincular cliente provisório;
- registrar venda para cliente existente;
- registrar recebimento;
- parcelamento;
- renegociação;
- troca;
- empréstimo;
- editar mercadoria;
- consultar dashboard;
- consultar histórico;
- receber pagamentos.

O limite deve existir **somente na criação de uma nova linha em `customers`**.

---

# 7. Camada TypeScript de plano

Evoluir:

```text
src/lib/subscription.ts
```

e, preferencialmente, adicionar:

```text
src/lib/plans.ts
```

## 7.1 Modelo esperado

Exemplo:

```ts
type EffectivePlan = 'free' | 'pro';

interface AccountEntitlements {
  effectivePlan: EffectivePlan;
  billingStatus: BillingStatus;
  canRead: boolean;
  canWrite: boolean;

  customerCount: number;
  customerLimit: number | null;
  canCreateCustomer: boolean;

  voiceMonthlyLimit: number;
  voiceUsedThisMonth: number;
  voiceRemainingThisMonth: number;

  trialEndsAt?: string;
  currentPeriodEnd?: string;
  graceUntil?: string;
}
```

Manter helpers de compatibilidade enquanto houver chamadas antigas:

```text
getSubscriptionAccess()
assertWritePermission()
writeDeniedMessage()
```

mas internamente orientar o projeto a trabalhar com entitlements.

---

# 8. Pré-validação amigável no cadastro de cliente

Modificar:

```text
src/app/actions/customers.ts
src/lib/domain/customers.ts
src/lib/domain/command-executor.ts
```

## 8.1 Formulário

Antes do INSERT, consultar:

```text
canCreateCustomer
```

para devolver uma mensagem amigável sem depender do erro SQL.

Porém:

> a pré-validação da aplicação é UX; o trigger do banco continua sendo a segurança real.

---

## 8.2 Voice-first

`command-executor.ts` hoje cria cliente provisório diretamente quando a fala cita alguém inexistente.

Quando o banco devolver:

```text
FREE_CUSTOMER_LIMIT
```

converter para erro de produto, não para:

> “Não consegui cadastrar o cliente.”

Resposta desejada:

> Você já está com 10 clientes no plano grátis. Posso continuar registrando negócios para os clientes que já existem, ou você pode liberar clientes ilimitados com o Pro.

Adicionar código estruturado, por exemplo:

```text
plan_customer_limit
```

Isso permite que a UI abra o CTA de upgrade.

---

# 9. Cota mensal de IA/voz

O projeto já possui:

```text
voice_rate_limits
consume_voice_rate_limit()
VOICE_RATE_LIMIT_PER_MINUTE
VOICE_RATE_LIMIT_PER_HOUR
ai_telemetry
```

Não criar controle paralelo em memória.

## 9.1 Migration 2

Criar:

```text
supabase/migrations/20260924000002_voice_plan_quota.sql
```

Opções aceitáveis:

### Preferida

Evoluir `voice_rate_limits.window_kind`:

```text
minute
hour
month
```

e fazer a RPC consultar o plano efetivo do usuário para obter o limite mensal.

### Alternativa

Criar contador mensal dedicado.

Em ambos os casos:

- atualização atômica;
- chave por `user_id + mês`;
- consumo antes de chamar STT/LLM;
- sem depender do browser;
- reset natural no início do mês;
- rate limit por minuto/hora continua existindo.

---

## 9.2 Limites iniciais

```text
Free: 20 comandos de IA/voz por mês
Pro: 1000 comandos por mês como guardrail operacional
```

Valores precisam vir da camada de entitlements.

---

## 9.3 Onde bloquear

Modificar:

```text
src/lib/voice/request-guard.ts
src/lib/security/rate-limit.ts
```

Ordem desejada:

```text
autenticação
    ↓
entitlement/cota mensal
    ↓
rate limit minuto/hora
    ↓
STT
    ↓
LLM
```

Assim o sistema não gasta com STT/LLM antes de descobrir que a conta Free já esgotou a cota.

Mensagem:

> Você usou os comandos de voz deste mês no plano grátis. Pode continuar usando o CRM manualmente ou liberar mais voz com o Pro.

Não bloquear o restante do CRM.

---

# 10. Integração Asaas

A abstração de billing atual deve ser preservada.

Adicionar:

```text
src/lib/billing/asaas/client.ts
src/lib/billing/asaas/provider.ts
src/lib/billing/asaas/types.ts
```

Registrar o provider no boot/registry sem executar código sensível no client bundle.

---

## 10.1 Estratégia de checkout

Para o MVP, usar **Asaas Checkout hospedado com assinatura recorrente por cartão**.

Motivos:

- evita o FigoCRM manipular dados brutos de cartão;
- reduz escopo de segurança;
- o Asaas possui checkout recorrente;
- encaixa diretamente na interface `createCheckout()` já existente.

Configuração principal:

```text
billingTypes = ["CREDIT_CARD"]
chargeTypes = ["RECURRENT"]
subscription.cycle = "MONTHLY"
valor = R$ 24,50
```

Não considerar criação de Checkout como pagamento confirmado.

Acesso Pro pago deve depender de webhook financeiro válido.

---

## 10.2 Primeira cobrança

### Usuário ainda no trial e decide assinar

Definir:

```text
nextDueDate = trial_ends_at
```

Assim:

- ele cadastra o cartão durante o trial;
- mantém o Pro pelo trial;
- primeira cobrança ocorre quando o trial terminar.

### Usuário já está no Free

Definir:

```text
nextDueDate = hoje
```

para cobrar imediatamente.

### Regra de segurança

Mesmo que o navegador volte para `/sucesso`:

```text
NÃO definir status active pelo redirect
```

O redirect serve somente para UX.

---

## 10.3 Criar checkout somente quando necessário

Não criar cliente Asaas no cadastro do FigoCRM.

Fluxo:

```text
usuário Free/Trial
    ↓
clica "Assinar Pro"
    ↓
POST /api/billing/checkout
    ↓
cria/reutiliza dados necessários no Asaas
    ↓
retorna URL do checkout
    ↓
redireciona
```

Isso evita criar milhares de clientes no Asaas para usuários que permanecerão no Free.

---

## 10.4 Nova rota

Criar:

```text
src/app/api/billing/checkout/route.ts
```

Responsabilidades:

1. exigir autenticação;
2. carregar perfil + entitlement;
3. impedir checkout duplicado desnecessário;
4. determinar `nextDueDate`;
5. criar checkout Asaas;
6. salvar referência interna;
7. retornar somente URL/ID necessário para o front.

Usar `externalReference` para correlacionar o checkout com a conta interna.

Nunca colocar segredo Asaas no browser.

---

# 11. Persistência dos checkouts

Adicionar tabela recomendada:

```text
billing_checkout_sessions
```

Campos:

```text
id
user_id
provider
provider_checkout_id
status
external_reference
created_at
updated_at
expires_at
```

Status:

```text
pending
paid
canceled
expired
```

Regras:

- `provider_checkout_id` único;
- RLS;
- usuário pode no máximo ler as próprias tentativas;
- gravações do provider feitas somente no servidor/service role;
- não usar essa tabela como fonte única do acesso Pro.

Fonte de acesso continua sendo:

```text
subscriptions + eventos financeiros verificados
```

---

# 12. Autenticação da API Asaas

Adicionar em `.env.example`:

```dotenv
BILLING_PROVIDER=asaas

ASAAS_API_KEY=
ASAAS_API_BASE_URL=https://api-sandbox.asaas.com/v3
ASAAS_WEBHOOK_TOKEN=

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Produção:

```text
https://api.asaas.com/v3
```

O cliente HTTP deve enviar:

```text
access_token: <ASAAS_API_KEY>
Content-Type: application/json
User-Agent: FigoCRM/<versão>
```

Não usar:

```text
Authorization: Bearer
```

Não logar API key nem token de webhook.

---

# 13. Webhook Asaas

Manter endpoint existente:

```text
src/app/api/webhooks/payment/route.ts
```

e usar a abstração atual:

```text
handleBillingWebhook()
BillingProvider.verifyWebhook()
applyBillingEvent()
```

## 13.1 Ajustar nomenclatura interna

Hoje os comentários falam em “assinatura criptográfica”.

No Asaas, a origem deve ser validada pelo token enviado em:

```text
asaas-access-token
```

Atualizar comentários/interfaces para termo neutro:

```text
verificar autenticidade do webhook
```

Implementar comparação segura do token.

---

## 13.2 Idempotência

O projeto já está correto:

```text
UNIQUE(provider, event_id)
```

Manter exatamente essa estratégia.

Asaas pode reenviar o mesmo webhook mais de uma vez.

Nunca processar novamente o mesmo `event.id`.

---

## 13.3 Mapeamento inicial de eventos

O provider Asaas deve traduzir eventos externos para eventos internos.

Exemplo:

```text
PAYMENT_CONFIRMED / PAYMENT_RECEIVED
    → assinatura ativa/renovada

PAYMENT_OVERDUE
    → past_due

cancelamento da recorrência
    → canceled

fim definitivo da recorrência
    → expired

CHECKOUT_CANCELED
    → checkout canceled, não mexe no plano pago atual

CHECKOUT_EXPIRED
    → checkout expired, não mexe no plano pago atual
```

### Importante

Eventos de criação de subscription/checkout podem salvar IDs do Asaas, mas **não devem liberar Pro pago sem confirmação financeira**, exceto enquanto o usuário ainda estiver coberto pelo trial.

Quando necessário, após um webhook financeiro consultar a assinatura no Asaas para obter período/estado autoritativo.

---

# 14. Reconciliar trial, pagamento e período

Caso:

```text
trial termina em 01/10
usuário cadastrou cartão em 28/09
```

Até 01/10:

```text
billing_status = trialing
effective_plan = pro
```

Quando pagamento for confirmado:

```text
billing_status = active
effective_plan = pro
current_period_start = ...
current_period_end = ...
```

Se a cobrança falhar:

```text
past_due durante carência
    ↓
pro
```

Passada a carência:

```text
effective_plan = free
```

Nada é apagado.

---

# 15. Cancelamento

A interface atual de `BillingProvider` possui:

```ts
cancelSubscription({
  providerSubscriptionId,
  atPeriodEnd
})
```

Antes de implementar essa parte, confirmar a semântica atual de cancelamento do Asaas.

Se o Asaas não possuir um `cancel_at_period_end` nativo equivalente:

1. impedir novas cobranças futuras de forma segura;
2. manter localmente o entitlement Pro até `current_period_end`;
3. após a data, `effective_plan` passa para Free.

Não cobrar novamente depois do cancelamento.

---

# 16. UI — Conta e upgrade

Modificar:

```text
src/app/app/conta/page.tsx
src/app/api/billing/status/route.ts
```

A tela deve deixar de apresentar somente “Ativo/Vencido”.

## 16.1 Trial

Exibir:

```text
Plano atual: Pro — teste grátis
5 dias restantes
Depois do teste você continua no Free se não assinar.
[Assinar Pro — R$ 24,50/mês]
```

---

## 16.2 Free

Exibir:

```text
Plano atual: Free

Clientes: 7 / 10
Voz/IA neste mês: 8 / 20

[Assinar Pro — R$ 24,50/mês]
```

---

## 16.3 Pro

Exibir:

```text
Plano atual: Pro
R$ 24,50/mês

Clientes: ilimitados
Próxima renovação: ...
Status do pagamento: ...
```

---

## 16.4 Free no limite

Exibir aviso contextual, não modal em toda navegação:

> Seu negócio está crescendo 🎉  
> Você chegou aos 10 clientes do plano grátis.  
> Continue usando seus clientes atuais ou libere cadastros ilimitados com o Pro.

Botão:

```text
Assinar Pro — R$ 24,50/mês
```

---

# 17. UI — Clientes

Modificar conforme necessário:

```text
src/app/app/clientes/page.tsx
src/app/app/clientes/novo/page.tsx
src/components/app/customer-form.tsx
```

Adicionar indicador discreto:

```text
Free · 8/10 clientes
```

Com:

```text
8/10 → normal
9/10 → aviso leve
10/10 → botão de novo cliente leva ao upgrade/explicação
```

Mesmo em `10/10`, o backend continua fazendo a validação definitiva.

---

# 18. Landing page e cadastro

Modificar:

```text
src/app/page.tsx
src/app/cadastro/page.tsx
src/components/auth/auth-forms.tsx
plano_fases_saas_voice_first.md
```

Remover comunicação antiga:

```text
7 dias e depois precisa pagar para continuar
R$ 24,90
sem múltiplos planos
```

Nova comunicação:

```text
Comece grátis
7 dias de Pro
Depois continue no Free para sempre
Pro por R$ 24,50/mês
Sem cartão para criar a conta
```

Não adicionar etapa de pagamento ao cadastro.

---

# 19. Analytics de conversão

Aproveitar a camada existente em:

```text
src/lib/analytics/events.ts
```

Eventos recomendados:

```text
trial_started
trial_expired_to_free
free_customer_limit_warning
free_customer_limit_reached
voice_monthly_limit_reached
checkout_started
checkout_completed
checkout_canceled
checkout_expired
subscription_activated
payment_failed
downgraded_to_free
subscription_canceled
```

Não registrar:

- dados de cartão;
- transcrição completa;
- CPF/CNPJ em analytics;
- API keys;
- tokens.

Objetivo: medir se `10 clientes` é o limite certo sem precisar alterar código em muitos lugares.

---

# 20. Testes obrigatórios

Atualizar:

```text
tests/e2e/subscription.e2e.ts
```

e adicionar testes unitários da nova camada de plano.

## 20.1 Trial

Testar:

- cadastro inicia em 7 dias de Pro;
- `effective_plan = pro`;
- nenhum customer Asaas é criado no signup;
- trial vencido vira Free;
- trial vencido não bloqueia escrita geral.

---

## 20.2 Limite Free

Testar:

```text
1º ao 10º cliente → sucesso
11º cliente → FREE_CUSTOMER_LIMIT
```

Também:

- editar cliente no limite → sucesso;
- venda para cliente existente → sucesso;
- recebimento no limite → sucesso;
- excluir/mesclar cliente e ficar com 9 → pode criar outro;
- provisional conta para o limite;
- criação provisional pela voz no 11º cliente → bloqueada com mensagem amigável.

---

## 20.3 Concorrência

Com 9 clientes:

```text
executar 2 INSERTs simultâneos
```

Resultado obrigatório:

```text
quantidade final <= 10
```

Esse teste valida o lock da regra de limite.

---

## 20.4 Pro

Testar:

- Pro pode criar cliente 11, 12, 100...;
- cliente que possuía >10 no Pro e cai para Free mantém todos;
- esse usuário não cria outro cliente enquanto estiver acima do limite;
- voltar ao Pro libera imediatamente o cadastro.

---

## 20.5 Pagamento vencido/cancelado

Testar:

```text
past_due dentro da carência → Pro
past_due fora da carência → Free
canceled antes do fim do período → Pro
canceled depois do período → Free
expired → Free
blocked → sem escrita
subscription missing → fail-closed
```

---

## 20.6 Voz

Testar Free:

```text
20 comandos → permitidos
21º → bloqueado antes de STT/LLM
```

Testar Pro com cota ampliada.

Também manter os testes de rate limit minuto/hora.

---

## 20.7 Asaas

Criar testes do provider:

- API key nunca vai ao browser;
- header `access_token` enviado corretamente;
- Sandbox e Produção usam base URL correta;
- token de webhook inválido → 401;
- token válido → evento processado;
- evento repetido → processado uma vez;
- redirect de checkout não ativa Pro;
- `CHECKOUT_CREATED` não ativa Pro;
- `PAYMENT_CONFIRMED`/evento financeiro equivalente ativa Pro;
- pagamento atrasado atualiza `past_due`;
- checkout expirado não remove assinatura paga já válida;
- `externalReference` resolve a conta correta;
- evento de outro usuário nunca altera assinatura indevida.

---

# 21. Atualização dos testes existentes

O teste atual contém expectativas que deixam de ser verdade.

Exemplo atual:

```text
trial vencido → escrita negada
```

Nova expectativa:

```text
trial vencido → effective_plan free
trial vencido → escrita geral permitida
trial vencido → limite de clientes aplicado
```

Não simplesmente apagar os testes antigos.

Reescrevê-los para preservar:

- isolamento;
- fail-closed real;
- impossibilidade de auto-upgrade;
- segurança da tabela `subscriptions`;
- idempotência de webhook;
- período de carência;
- dados sempre legíveis.

---

# 22. Backfill e compatibilidade

## Usuários existentes em trial

Continuam normalmente.

Ao terminar:

```text
Free
```

---

## Usuários existentes com status expired

Passam a:

```text
effective_plan = free
```

sem alterar os dados.

---

## Usuário existente com mais de 10 clientes

Não apagar nem arquivar ninguém.

Regra:

```text
pode usar todos
não pode criar novos
```

até:

```text
assinar Pro
```

ou ficar abaixo de 10 por uma ação legítima do próprio usuário.

---

## Usuários ativos pagos

Se já existirem assinaturas comerciais reais antes da migration de preço:

- não alterar contrato/cobrança silenciosamente;
- reconciliar manualmente preço legado.

No estágio atual do FigoCRM, se ainda não há assinaturas reais processadas, migrar todos os registros internos de `2490` para `2450`.

---

# 23. Arquivos previstos

## Adicionar

```text
src/lib/plans.ts

src/lib/billing/asaas/client.ts
src/lib/billing/asaas/provider.ts
src/lib/billing/asaas/types.ts

src/app/api/billing/checkout/route.ts

supabase/migrations/20260924000001_free_pro_entitlements.sql
supabase/migrations/20260924000002_voice_plan_quota.sql
supabase/migrations/20260924000003_asaas_billing_support.sql

tests/unit/plans.test.ts
tests/unit/asaas-provider.test.ts
```

A migration `...asaas_billing_support.sql` pode ser dispensada caso `billing_checkout_sessions` seja criada na migration 1.

---

## Modificar

```text
.env.example

src/lib/subscription.ts

src/lib/billing/types.ts
src/lib/billing/registry.ts
src/lib/billing/service.ts
src/lib/billing/webhook.ts

src/app/api/billing/status/route.ts

src/app/actions/customers.ts
src/lib/domain/customers.ts
src/lib/domain/command-executor.ts

src/lib/voice/request-guard.ts
src/lib/security/rate-limit.ts

src/app/app/conta/page.tsx
src/app/app/clientes/page.tsx
src/app/app/clientes/novo/page.tsx
src/components/app/customer-form.tsx

src/app/page.tsx
src/app/cadastro/page.tsx
src/components/auth/auth-forms.tsx

src/lib/analytics/events.ts

tests/e2e/subscription.e2e.ts
tests/e2e/http-smoke.e2e.ts

package.json
plano_fases_saas_voice_first.md
```

Alterar somente arquivos realmente necessários depois de inspecionar cada fluxo.

---

# 24. Ordem de implementação

## Fase A — Baseline

Antes de modificar:

```bash
npm test
npm run test:e2e
npm run db:audit
npm run build
```

Registrar qualquer falha preexistente.

---

## Fase B — Banco e entitlements

Implementar:

- `plan_entitlements`;
- preço 2450;
- `effective_plan`;
- Free fallback;
- novo `subscription_access`;
- limite concorrente de 10 clientes;
- testes SQL/E2E.

Não integrar Asaas ainda.

### Critério de conclusão

Um trial vencido vira Free e o 11º cliente é impossível inclusive via REST/voz/RPC.

---

## Fase C — Aplicação

Implementar:

- `AccountEntitlements`;
- mensagens;
- customer preflight;
- mapeamento de `FREE_CUSTOMER_LIMIT`;
- status API;
- Conta;
- Clientes.

### Critério de conclusão

Usuário entende claramente:

```text
qual plano possui
quantos clientes usa
qual é o limite
como fazer upgrade
```

---

## Fase D — IA/voz

Implementar:

- cota mensal;
- Free 20;
- Pro 1000 guardrail;
- bloqueio antes do custo externo;
- feedback de upgrade;
- testes.

---

## Fase E — Asaas Sandbox

Implementar:

- client;
- provider;
- checkout recorrente;
- checkout session;
- webhook token;
- normalização;
- idempotência;
- eventos financeiros;
- reconciliação.

Usar exclusivamente Sandbox nesta fase.

---

## Fase F — UX comercial

Implementar:

- CTA Pro;
- redirecionamento ao checkout;
- sucesso/cancelamento/expiração;
- landing page;
- cópia do cadastro;
- plano na Conta.

---

## Fase G — Hardening

Executar:

```bash
npm test
npm run test:e2e
npm run db:audit
npm run build
```

Além de:

- teste de concorrência do limite;
- tentativa de burlar limite pelo Supabase REST;
- tentativa pela voz;
- tentativa por RPC;
- webhook duplicado;
- webhook inválido;
- checkout duplicado;
- downgrade Pro → Free;
- upgrade Free → Pro.

---

## Fase H — Produção

Somente depois do Sandbox completo:

```text
ASAAS_API_BASE_URL=https://api.asaas.com/v3
ASAAS_API_KEY=<produção>
ASAAS_WEBHOOK_TOKEN=<produção>
BILLING_PROVIDER=asaas
```

Checklist:

- webhook HTTPS público;
- token exclusivo;
- segredo na Vercel;
- nenhum segredo `NEXT_PUBLIC_*`;
- endpoint responde corretamente;
- primeiro pagamento real de baixo risco testado;
- cancelamento testado;
- renovação testada;
- falha de cobrança testada.

---

# 25. Regras para o Codex durante a implementação

1. Ler `AGENTS.md` antes de qualquer alteração.
2. Para Next.js 16, consultar a documentação local indicada por `AGENTS.md`.
3. Não editar migrations antigas aplicadas; criar migrations novas.
4. Não remover RLS para facilitar implementação.
5. Não mover `SUPABASE_SERVICE_ROLE_KEY` para client.
6. Não expor `ASAAS_API_KEY`.
7. Não expor `ASAAS_WEBHOOK_TOKEN`.
8. Não confiar no redirect do Checkout para conceder Pro.
9. Não confiar somente em validação React/server action para o limite de clientes.
10. Limite Free precisa existir no banco.
11. Preservar idempotência de webhooks.
12. Preservar o princípio de leitura dos dados mesmo após downgrade.
13. Não deletar clientes ao fazer downgrade.
14. Não bloquear vendas/recebimentos de clientes existentes quando Free estiver em 10/10.
15. Cliente provisório conta no limite.
16. Toda nova regra crítica precisa de teste E2E.
17. Erros técnicos de plano devem ser mapeados para mensagens simples ao usuário.
18. Não adicionar SDK desnecessário do Asaas se `fetch` resolver a integração com tipagem e timeouts adequados.
19. Nunca registrar payload contendo dados sensíveis de cartão.
20. Fazer mudanças pequenas e verificáveis por fase.

---

# 26. Critérios de aceite

A implementação somente está concluída quando todos os itens abaixo forem verdadeiros.

- [ ] Novo usuário inicia com 7 dias de Pro.
- [ ] Cadastro não pede cartão.
- [ ] Trial vencido cai automaticamente para Free.
- [ ] Free pode continuar usando o CRM.
- [ ] Free pode ter no máximo 10 clientes.
- [ ] 10º cliente funciona.
- [ ] 11º cliente é bloqueado no banco.
- [ ] Duas criações concorrentes não ultrapassam 10.
- [ ] Cliente provisional conta no limite.
- [ ] Usuário Free em 10/10 pode vender para cliente existente.
- [ ] Usuário Free em 10/10 pode receber pagamento.
- [ ] Usuário Free em 10/10 pode editar clientes.
- [ ] Usuário vindo do Pro com >10 clientes não perde dados.
- [ ] Upgrade para Pro libera imediatamente o limite.
- [ ] Pro custa R$ 24,50/mês em código, UI e gateway.
- [ ] Free possui cota mensal de voz/IA.
- [ ] Cota é checada antes de STT/LLM.
- [ ] Pro possui cota ampliada/guardrail.
- [ ] Asaas não é chamado no cadastro Free.
- [ ] Checkout Asaas usa recorrência mensal.
- [ ] Redirect não ativa assinatura.
- [ ] Webhook autenticado ativa/renova.
- [ ] Webhook repetido não duplica processamento.
- [ ] Falha de pagamento respeita carência e depois cai para Free.
- [ ] Cancelamento mantém Pro até o final do período pago e depois cai para Free.
- [ ] `blocked` continua realmente bloqueado.
- [ ] subscription ausente continua fail-closed.
- [ ] RLS continua passando auditoria.
- [ ] `npm test` passa.
- [ ] `npm run test:e2e` passa.
- [ ] `npm run db:audit` passa.
- [ ] `npm run build` passa.

---

# 27. Fora de escopo desta fase

Não incluir agora:

- plano anual;
- times/múltiplos usuários;
- múltiplas faixas pagas;
- cobrança por uso;
- add-ons;
- split de pagamento;
- implementação de Pix Automático;
- bloqueio premium de módulos que ainda não existem;
- sistema complexo de cupons.

A arquitetura de `effective_plan + entitlements` deve permitir adicionar esses recursos depois sem reescrever billing.

---

# 28. Referências oficiais Asaas para implementação

Validar novamente no momento de codificar caso a API tenha mudado:

- Autenticação: `https://docs.asaas.com/docs/authentication`
- Asaas Checkout: `https://docs.asaas.com/docs/checkout-asaas`
- Checkout com assinatura recorrente: `https://docs.asaas.com/docs/checkout-com-assinatura-recorrente`
- Criar checkout: `https://docs.asaas.com/reference/criar-novo-checkout`
- Assinaturas: `https://docs.asaas.com/docs/criando-uma-assinatura`
- Webhooks: `https://docs.asaas.com/docs/sobre-os-webhooks`
- Idempotência de webhooks: `https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks`

---

# 29. Resultado esperado

Depois desta fase, a monetização do FigoCRM deixa de ser:

```text
trial → pagar ou ficar bloqueado
```

e passa a ser:

```text
trial Pro
    ↓
Free permanente
    ↓
usuário cresce / usa mais IA
    ↓
upgrade Pro R$ 24,50
    ↓
Asaas recorrente
```

O ganho principal é que o produto passa a ter um funil de aquisição compatível com um SaaS low-ticket sem enfraquecer a segurança já construída no backend.
