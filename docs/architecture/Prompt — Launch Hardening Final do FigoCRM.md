Você está trabalhando no repositório:

`figodevtech/figocrm`

Branch atual:

`main`

O FigoCRM já possui o V1 funcional e o fluxo de cobrança real com Asaas em produção.

O objetivo deste ciclo NÃO é criar novos módulos.

O objetivo é:

> **eliminar riscos de lançamento, fechar segurança/CI/observabilidade/legal e preparar o sistema para usuários reais.**

O produto já possui:

- autenticação;
- clientes;
- estoque;
- vendas;
- trocas;
- pagamentos;
- empréstimos;
- juros;
- contratos/PDF;
- voz/IA;
- registros avulsos;
- CMV/lucro calculado pelo banco;
- Supabase com RLS;
- PWA;
- Free;
- Pro;
- Pro Mais;
- Asaas checkout;
- webhooks;
- cancelamento;
- reativação;
- troca de plano;
- pagamento real validado;
- deploy Vercel funcional.

Não reescrever essas áreas sem necessidade objetiva.

---

# ESTADO COMERCIAL ATUAL

Planos atuais:

```text
Free
R$ 0
10 clientes
20 comandos de voz/mês
```

```text
Pro
R$ 39,90/mês
clientes ilimitados
300 comandos de voz/mês
```

```text
Pro Mais
R$ 89,90/mês
clientes ilimitados
1.000 comandos de voz/mês
```

O Supabase deve continuar sendo a fonte da verdade para entitlements.

---

# OBJETIVO DO CICLO

Fechar, nesta ordem:

```text
1. Sessão/auth resiliente
2. Webhooks órfãos e reconciliação
3. CI obrigatório
4. Proteção da main
5. Segurança do Supabase
6. Termos e Privacidade
7. Exportação/exclusão de conta
8. Suporte e feedback
9. Observabilidade operacional
10. Smoke tests de produção
11. Checklist de lançamento
12. Freeze de features
```

---

# FASE 1 — CORRIGIR REFRESH TOKEN INVÁLIDO

Foi observado em produção:

```text
Invalid Refresh Token: Refresh Token Not Found
```

em requisições para:

```text
/app
```

originadas no middleware Supabase.

Revisar:

```text
src/lib/supabase/middleware.ts
```

---

# PROBLEMA

Hoje o middleware tenta:

```ts
supabase.auth.getUser()
```

e, em erro de sessão, apenas trata o usuário como não autenticado.

Isso pode deixar cookies inválidos no navegador.

---

# OBJETIVO

Quando detectar erros como:

```text
refresh_token_not_found
invalid_refresh_token
refresh_token_already_used
session_not_found
```

deve:

```text
detectar sessão inválida
↓
remover cookies Supabase inválidos
↓
não tentar novo refresh em loop
↓
redirecionar para /login
```

---

# IMPORTANTE

Não limpar sessão por qualquer erro genérico de rede.

Diferenciar:

```text
sessão definitivamente inválida
```

de:

```text
Supabase temporariamente indisponível
```

---

# TESTES

Adicionar:

```text
cookie válido
cookie expirado com refresh válido
refresh inexistente
refresh revogado
sem cookie
rota pública
rota protegida
logout seguido de /app
reset de senha seguido de sessão antiga
```

Critério:

nenhuma exceção deve aparecer como runtime error esperado no middleware.

---

# FASE 2 — WEBHOOKS ÓRFÃOS

Existem eventos históricos como:

```text
checkout.paid
subscription_not_found
processed_at = null
```

de contas descartáveis que já não existem.

Não simplesmente apagá-los.

---

# OBJETIVO

Criar uma estratégia formal de reconciliação.

Estados conceituais:

```text
received
processing
processed
retryable_error
terminal_ignored
dead_letter
```

Não é obrigatório alterar a tabela para todos esses estados se o modelo atual puder representar isso claramente.

---

# EVENTO NÃO CORRELACIONADO

Se chegar um evento financeiro sem:

```text
checkout conhecido
subscription conhecida
usuário existente
```

não decidir imediatamente que é terminal.

Primeiro verificar:

```text
providerCheckoutId
providerSubscriptionId
providerCustomerId
externalReference
```

---

# RETRY

Falha potencialmente temporária:

```text
subscription_not_found
```

pode continuar retornando erro por uma pequena janela para permitir nova entrega.

Depois de um período definido, por exemplo:

```text
24 horas
```

reconciliar novamente.

Se:

```text
checkout não existe
usuário não existe
assinatura não existe
```

marcar como:

```text
terminal_ignored
```

ou equivalente.

Nesse caso:

```text
processed_at = agora
```

para impedir retry infinito.

---

# NUNCA IGNORAR AUTOMATICAMENTE

```text
payment_plan_mismatch
assinatura existe mas usuário diverge
valor pago diverge
checkout existe para outro usuário
provider_subscription_id conflitante
```

Esses casos são alertas reais.

Devem permanecer visíveis.

---

# FASE 3 — OBSERVABILIDADE DO BILLING

Criar uma visão operacional simples.

Precisa responder:

```text
Há webhook falhando agora?
```

```text
Algum pagamento confirmado não ativou assinatura?
```

```text
Há checkout pago sem subscription?
```

```text
Há payment_plan_mismatch?
```

---

# MÉTRICAS

Criar consultas/admin interno para:

```text
webhooks últimas 24h
processados
duplicados
falhas
terminal ignored
payment_plan_mismatch
subscription_not_found
checkout pago sem ativação
cancelamentos
ativações
renovações
```

---

# ALERTAS

Definir alerta para:

```text
payment_plan_mismatch > 0
```

```text
webhook 5xx consecutivo
```

```text
checkout pago sem ativação > alguns minutos
```

```text
billing_unavailable recorrente
```

Pode começar simples:

```text
e-mail
Slack
log estruturado
```

Não precisa adicionar plataforma cara.

---

# FASE 4 — CI NO GITHUB

Atualmente não confiar apenas em:

```text
Vercel build = success
```

Criar:

```text
.github/workflows/ci.yml
```

---

# CI BÁSICO OBRIGATÓRIO

Para:

```text
pull_request
push em main
```

executar:

```bash
npm ci
npm run lint
npm run test:unit
npm run build
```

Se existir typecheck separado:

```bash
npm run typecheck
```

---

# CI DE SEGURANÇA

Criar job separado para:

```bash
npm run test:security
```

Quando depender de secrets:

usar environment de CI próprio.

Nunca colocar:

```text
SUPABASE_SERVICE_ROLE_KEY
ASAAS_API_KEY
OPENAI_API_KEY
```

no código.

---

# E2E

Rodar E2E em condição controlada.

Preferencialmente:

```text
PR → unit/lint/build
main → unit/lint/build/security
manual/nightly → E2E completo
```

Evitar criar/cancelar cobranças reais em todo PR.

---

# BENCHMARK

Executar:

```bash
npm run test:benchmark:rules
```

no CI.

Benchmark LLM real pode permanecer:

```text
manual
nightly
pre-release
```

para controlar custo.

---

# FASE 5 — PROTEGER A MAIN

Após CI funcionando:

proteger:

```text
main
```

Regras desejadas:

```text
PR obrigatório
status checks obrigatórios
não permitir merge com CI vermelho
impedir force push
impedir delete
```

Se o fluxo atual exigir push direto temporariamente:

documentar a exceção e migrar para PR antes do lançamento público.

---

# FASE 6 — SUPABASE SECURITY

Executar novamente:

```text
Security Advisor
Performance Advisor
```

---

# LEAKED PASSWORD PROTECTION

Ativar no painel Supabase.

Também revisar:

```text
minimum password length
```

Usar no mínimo:

```text
8 caracteres
```

Evitar requisitos excessivamente hostis.

---

# SECURITY DEFINER

Revisar individualmente:

```text
consume_voice_rate_limit
issue_loan_document
merge_provisional_customer
record_ai_telemetry
```

Cada função deve ter:

```text
SET search_path
auth.uid() quando aplicável
ownership check
REVOKE PUBLIC
REVOKE anon
grant mínimo
```

Se alguma puder virar:

```text
SECURITY INVOKER
```

sem quebrar o fluxo, preferir.

Não alterar só para eliminar warning do Advisor.

---

# SERVER-ONLY TABLES

Confirmar que:

```text
ai_telemetry
billing_events
```

não estão acessíveis diretamente pelo usuário.

Se RLS sem policy é intencional:

documentar explicitamente.

---

# FASE 7 — TERMOS DE USO

Criar rota pública:

```text
/termos
```

Texto deve cobrir pelo menos:

```text
descrição do serviço
planos
pagamentos
renovação
cancelamento
disponibilidade
responsabilidade do usuário pelos dados cadastrados
uso de IA
limitação de responsabilidade
contato
alterações dos termos
```

Não apresentar como aconselhamento jurídico definitivo.

Estruturar para posterior revisão jurídica.

---

# FASE 8 — POLÍTICA DE PRIVACIDADE

Criar:

```text
/privacidade
```

Explicar de forma simples:

```text
quais dados coletamos
por que coletamos
onde usamos
serviços terceiros
Supabase
Vercel
OpenAI
Asaas
retenção
segurança
direitos do titular
contato
```

---

# CADASTRO

No cadastro:

```text
Ao criar sua conta, você concorda com os Termos de Uso e reconhece a Política de Privacidade.
```

Links clicáveis.

Não usar checkbox obrigatório de marketing.

---

# FASE 9 — EXPORTAÇÃO DE DADOS

Na tela:

```text
/app/conta
```

adicionar:

```text
Exportar meus dados
```

---

# EXPORTAÇÃO

Gerar arquivo com os dados do próprio usuário.

Pode inicialmente ser:

```text
JSON
```

ou ZIP com JSONs.

Incluir:

```text
perfil
clientes
itens
negócios
empréstimos
recebíveis
parcelas
pagamentos
ajustes
```

Não incluir:

```text
tokens
secrets
dados internos de outros usuários
telemetria desnecessária
```

---

# FASE 10 — EXCLUSÃO / ENCERRAMENTO DE CONTA

Criar fluxo:

```text
Encerrar minha conta
```

Não apagar instantaneamente sem confirmação.

---

# PASSOS

```text
clicar Encerrar conta
↓
explicar consequências
↓
digitar senha ou confirmação forte
↓
cancelar assinatura/renovação
↓
registrar solicitação
```

---

# DADOS FINANCEIROS / RETENÇÃO

Não assumir que tudo deve ser apagado imediatamente.

Criar processo explícito:

```text
requested_at
status
scheduled_for
completed_at
```

Pode existir período de retenção conforme necessidade legal/operacional.

Documentar.

---

# FASE 11 — SUPORTE

Adicionar em:

```text
/app/conta
```

atalho:

```text
Preciso de ajuda
```

Pode abrir:

```text
/support
```

ou canal definido.

Mostrar pelo menos:

```text
e-mail
WhatsApp
```

se houver canal oficial.

---

# FASE 12 — FEEDBACK

Adicionar:

```text
Encontrou um problema?
```

Formulário simples:

```text
categoria
descrição
tela atual
```

Opcionalmente registrar:

```text
user_id
route
app_version/commit
```

Nunca registrar:

```text
senha
token
cartão
chave de API
```

---

# FASE 13 — VERSÃO DO APP

Adicionar identificação de versão baseada no commit.

Exemplo:

```text
FigoCRM
v1.0.0
c8e28f9
```

Pode aparecer discretamente em:

```text
Conta
```

Isso ajuda suporte.

---

# FASE 14 — STATUS DO SISTEMA

Criar endpoint de health:

```text
/api/health
```

Não expor secrets.

Pode retornar:

```json
{
  "status": "ok",
  "version": "...",
  "database": "ok",
  "billing": "configured"
}
```

NÃO fazer chamadas externas caras em toda requisição.

---

# FASE 15 — ASAAS EM PRODUÇÃO

O pagamento real já foi validado.

Não recriar integração.

Revisar somente:

```text
checkout
webhook
ativação
renovação
cancelamento
reativação
troca de plano
```

---

# TESTE FINAL DE BILLING

Realizar com uma conta controlada:

```text
Free/trial
↓
comprar Pro
↓
Asaas confirma pagamento
↓
webhook ativa
↓
Pro aparece no app
↓
cancelar renovação
↓
continua Pro até current_period_end
```

Se possível também:

```text
Pro
↓
Pro Mais
```

com validação de valor.

Evitar cobrar várias vezes apenas para testar.

---

# RECONCILIAÇÃO

Criar rotina segura para comparar:

```text
subscriptions no FigoCRM
vs
subscriptions no Asaas
```

Não precisa rodar em tempo real.

Pode ser script administrativo.

Detectar:

```text
Asaas ACTIVE / Figo canceled
Asaas INACTIVE / Figo active
preço divergente
subscription ID divergente
```

Somente relatar inicialmente.

Não corrigir automaticamente sem regra clara.

---

# FASE 16 — PWA

PWA já existe.

Apenas validar:

```text
instalação Android
instalação desktop
ícones
standalone
offline page
safe areas
```

Não adicionar offline financeiro.

---

# FASE 17 — VOZ

Não reformar IA agora.

Somente executar smoke de produção.

Testar:

```text
nova venda
recebimento
cliente avulso
item sem estoque
empréstimo
consulta
```

Confirmar telemetria:

```text
llm_provider
llm_model
interpretation_source
success
```

---

# FASE 18 — UX DE ERRO

Revisar erros visíveis.

Nunca mostrar:

```text
PGRST116
AuthApiError
23505
HTTP 500
subscription_not_found
```

ao usuário.

Mapear para:

```text
Não consegui concluir agora.
Tente novamente.
```

ou mensagem específica.

---

# FASE 19 — 404 / ERRO GLOBAL

Criar:

```text
not-found
error boundary
```

com UX compatível.

Exemplo:

```text
Algo deu errado.

[ Tentar novamente ]
[ Voltar ao início ]
```

---

# FASE 20 — RATE LIMIT DE ROTAS SENSÍVEIS

Revisar:

```text
login
cadastro
reset password
billing checkout
billing cancel
billing reactivate
webhook
voice
```

Webhook não deve usar rate limit que impeça o Asaas de entregar eventos legítimos.

---

# FASE 21 — DEPENDÊNCIAS

Executar:

```bash
npm audit
npm outdated
```

Não atualizar major version apenas porque existe versão nova.

Corrigir vulnerabilidade relevante quando seguro.

Revisar os avisos atuais de install scripts:

```text
esbuild
unrs-resolver
```

Não aprovar automaticamente.

Confirmar origem e necessidade.

---

# FASE 22 — PERFORMANCE REAL

Medir:

```text
/app
/clientes
/estoque
/negocios
/emprestimos
```

Verificar:

```text
TTFB
consultas duplicadas
queries lentas
N+1
```

Não fazer otimização teórica sem evidência.

---

# FASE 23 — LISTAGENS

Hoje algumas listagens possuem limite alto fixo.

Implementar paginação ou infinite loading onde necessário.

Prioridade:

```text
clientes
negócios
estoque
histórico
```

Não precisa sofisticar.

---

# FASE 24 — BACKUP / RECOVERY

Documentar:

```text
como restaurar banco
como fazer rollback de deploy
como reverter migration
como identificar última versão estável
```

Não esperar uma falha real para decidir isso.

---

# FASE 25 — RUNBOOK DE INCIDENTE

Criar:

```text
docs/operations/runbook.md
```

Exemplos:

```text
Asaas não entregou webhook
OpenAI fora
Supabase indisponível
Vercel com 500
assinatura paga não ativou
usuário não consegue entrar
venda duplicada
```

Para cada:

```text
como identificar
onde olhar
como mitigar
o que não fazer
```

---

# FASE 26 — FREEZE DE FEATURES

Após concluir este prompt:

NÃO adicionar novos módulos antes do beta.

Aceitar apenas:

```text
bug fix
segurança
billing
UX crítica
performance comprovada
```

---

# TESTES OBRIGATÓRIOS

Rodar:

```bash
npm run lint
npm run test:unit
npm run test:security
npm run test:e2e
npm run test:benchmark:rules
npm run test:ui
npm run build
```

Benchmark LLM:

```bash
npm run test:benchmark:llm -- --sample=100
```

se ambiente/cota permitirem.

---

# TESTES NOVOS

Adicionar cobertura para:

```text
refresh_token_not_found
cookies inválidos
webhook órfão
dead letter
payment_plan_mismatch
reconciliação Asaas
exportação de dados
encerramento de conta
health endpoint
error boundary
```

---

# CHECKLIST MANUAL DE PRODUÇÃO

Executar:

```text
Criar conta
Login
Logout
Reset senha
Cadastrar cliente
Cadastrar item
Venda
Troca
Recebimento
Empréstimo
Gerar contrato PDF
Voz
PWA
Checkout Pro
Plano ativo
Cancelamento
Suporte
Privacidade
Termos
```

---

# GITHUB

Ao final:

```text
CI verde
main protegida
nenhum commit direto não validado
```

---

# SUPABASE

Ao final:

```text
Security Advisor revisado
Leaked Password Protection ativado
RLS revisado
migrations alinhadas
sem novo warning crítico
```

---

# VERCEL

Ao final:

```text
deployment READY
domínio oficial funcionando
0 erro recorrente novo
health ok
```

---

# ASAAS

Ao final:

```text
checkout real ok
webhook real ok
ativação ok
cancelamento ok
plano correto
preço correto
```

---

# DEFINITION OF DONE

Este ciclo termina quando:

- [ ] sessão inválida não gera erro de runtime recorrente
- [ ] cookies inválidos são limpos corretamente
- [ ] webhooks órfãos têm política terminal
- [ ] payment_plan_mismatch gera alerta
- [ ] CI existe
- [ ] main está protegida
- [ ] leaked password protection está ativa
- [ ] Termos publicados
- [ ] Privacidade publicada
- [ ] usuário pode exportar dados
- [ ] fluxo de encerramento de conta existe
- [ ] suporte está visível
- [ ] feedback está disponível
- [ ] health endpoint existe
- [ ] billing possui reconciliação
- [ ] testes passam
- [ ] build passa
- [ ] deployment estável
- [ ] smoke real passa
- [ ] nenhum novo módulo foi adicionado

---

# RELATÓRIO FINAL

Criar:

```text
docs/architecture/relatorio_launch_ready_figocrm.md
```

Incluir:

```text
HEAD
commits
CI
branch protection
Supabase
Security Advisor
Performance Advisor
auth/session
billing
Asaas
webhooks órfãos
observabilidade
Termos
Privacidade
exportação
encerramento de conta
suporte
PWA
testes
build
deploy
smoke
bloqueios
pendências pós-lançamento
```

---

# CLASSIFICAÇÃO FINAL

Ao terminar o trabalho, classificar cada item como:

```text
BLOCKER
IMPORTANTE
PÓS-LANÇAMENTO
```

Só considerar o FigoCRM pronto para beta público quando:

```text
BLOCKER = 0
```

---

# PRINCÍPIO FINAL

A prioridade agora não é aumentar o número de funcionalidades.

A prioridade é:

```text
não perder dinheiro
não cobrar errado
não perder dados
não deixar usuário preso
não publicar regressão
conseguir descobrir rapidamente quando algo quebrar
```

Se uma alteração não reduz risco de lançamento ou melhora diretamente a experiência crítica do usuário, não é prioridade neste ciclo.