> **Decisão comercial posterior (24/09/2026):** usar Asaas, Free permanente e Pro por R$ 24,50/mês, com 7 dias de teste Pro. O Free permite 10 clientes (incluindo avulsos) e 20 comandos de voz/mês; o Pro permite clientes ilimitados e tem guarda de 1.000 comandos de voz/mês. Esta decisão substitui as menções a plano único de R$ 24,90 abaixo. O estado de implementação e os bloqueios de implantação estão em `relatorio_figocrm_v1_beta_ready.md`.

Você está trabalhando no repositório:

`figodevtech/figocrm`

Branch atual:

`main`

O FigoCRM já possui o núcleo funcional do V1:

- autenticação;
- trial;
- clientes;
- estoque;
- fotos;
- vendas;
- trocas;
- recebimentos;
- empréstimos;
- juros;
- parcelas;
- renegociação;
- estorno;
- voz contextual;
- registros avulsos;
- LLM real;
- Structured Output;
- Supabase com RLS;
- RPCs financeiras atômicas;
- telemetria;
- benchmark;
- navegação sem sidebar;
- Home com atalhos;
- layout mobile-first;
- deploy funcional na Vercel.

O objetivo deste ciclo NÃO é reescrever esses módulos.

O objetivo é:

> **fechar as últimas lacunas entre “sistema funcional” e “produto pronto para beta com clientes reais”.**

Antes de alterar qualquer coisa, leia:

```text
docs/architecture/relatorio_modulos_app_v1.md
docs/architecture/relatorio_pre_front_production_ready.md
docs/architecture/contrato_api_front.md
docs/architecture/relatorio_hardening_backend_final.md
```

Revise especialmente:

```text
src/lib/domain/
src/lib/finance/
src/lib/billing/
src/lib/subscription.ts

src/app/app/
src/app/actions/
src/app/api/

supabase/migrations/
```

---

# OBJETIVOS DESTE CICLO

Executar, nesta ordem:

```text
1. Blindar cálculo de lucro/CMV no banco
2. Consolidar pendências de registros avulsos
3. Finalizar módulo documental de empréstimos/contratos
4. Implementar billing real do SaaS
5. Finalizar assinatura/trial/checkout
6. Melhorar onboarding
7. Preparar PWA
8. Fazer polimento de produto
9. Executar auditoria completa
10. Preparar beta
```

---

# FASE 1 — NÃO CONFIAR EM `recognized_profit` DO PAYLOAD

Hoje `execute_deal_transaction` ainda recebe algo equivalente a:

```text
recognized_profit
```

no payload.

Isso não deve ser tratado como fonte de verdade.

O lucro é valor derivado.

A regra correta deve ser:

```text
Preço negociado
-
CMV real
=
Lucro reconhecido
```

O banco deve conseguir validar ou calcular isso.

---

# OBJETIVO

Um usuário autenticado NÃO deve conseguir chamar a RPC diretamente e gravar:

```text
Venda:
R$ 3.000

CMV:
R$ 2.000

recognized_profit enviado:
R$ 50.000
```

O banco deve rejeitar ou ignorar o valor informado.

---

# IMPLEMENTAÇÃO

Preferencialmente:

```text
payload
↓
itens reais
↓
custos reais
↓
PostgreSQL calcula CMV
↓
PostgreSQL calcula lucro
```

Para cada item OUT:

```text
CMV =
acquisition_cost
+
SUM(item_costs)
```

Depois:

```text
recognized_profit =
total_value
-
CMV
```

Considerar corretamente negócios com múltiplos itens.

---

# COST_PENDING

Se qualquer item de saída possuir:

```text
cost_pending = true
```

então:

```text
profit_pending = true
recognized_profit = 0
```

Nunca estimar.

Quando o custo for informado:

```text
resolve_item_cost
↓
recalcula CMV
↓
recalcula lucro
↓
profit_pending = false
```

---

# DEFESA EM PROFUNDIDADE

Mesmo que o TypeScript já calcule corretamente:

o PostgreSQL deve ser a última autoridade.

Adicionar testes:

```text
payload com lucro adulterado
payload com custo adulterado
item sem custo
item com custos adicionais
múltiplos itens
item avulso depois resolvido
```

---

# FASE 2 — REGISTROS AVULSOS

O fluxo atual permite:

```text
cliente provisório
item provisório
custo pendente
```

Isso é desejado.

Agora precisamos tornar esse fluxo muito claro no produto.

---

# HOME

Manter seção:

```text
Para completar depois
```

Mas transformar isso num fluxo operacional.

Exemplo:

```text
3 pendências

1 cliente sem cadastro completo
1 venda sem custo
1 mercadoria para vincular
```

---

# PÁGINA DE PENDÊNCIAS

Criar, se fizer sentido:

```text
/app/pendencias
```

ou reaproveitar filtros existentes.

Mostrar:

```text
Venda do iPhone 13
Falta informar quanto custou

Carlos
Cliente criado pela voz
Falta completar cadastro

Moto CG 160
Mercadoria avulsa
Vincular ao estoque?
```

---

# NÃO BLOQUEAR OPERAÇÃO

Pendências nunca devem impedir:

```text
outras vendas
outros recebimentos
consulta
```

Mas devem permanecer visíveis até serem resolvidas.

---

# CLIENTE AVULSO

Permitir:

```text
Completar cadastro
```

ou:

```text
Vincular a cliente existente
```

Antes de vincular, mostrar resumo:

```text
Este cliente avulso possui:

3 negócios
R$ 2.500 a receber
1 empréstimo
```

Confirmar antes da fusão.

---

# ITEM AVULSO

Permitir:

```text
Informar custo
Vincular ao estoque
Confirmar como item independente
```

Nunca perder:

```text
deal_items
audit log
histórico
lucro
```

---

# FASE 3 — CONTRATOS DE EMPRÉSTIMO COMO DOCUMENTO

Hoje o sistema possui o contrato FINANCEIRO.

Agora implementar também o instrumento contratual visual/documental.

---

# OBJETIVO

Dentro de:

```text
/app/emprestimos/[id]
```

adicionar:

```text
[ Ver contrato ]
[ Imprimir ]
[ Gerar PDF ]
```

---

# DOCUMENTO

O contrato deve conter:

```text
Número do contrato
Data

CREDOR
Nome
CPF/CNPJ
Endereço

DEVEDOR
Nome
CPF/CNPJ
Endereço

VALOR PRINCIPAL
R$ X

JUROS
Tipo
Taxa
Valor

TOTAL
R$ Y

FORMA DE PAGAMENTO
Quantidade
Valor das parcelas
Vencimentos

TERMOS
Observações
```

---

# DADOS DO CREDOR

Usar os dados do perfil/negócio do usuário.

Se necessário, ampliar profile para:

```text
document
address
business_name
phone
```

Não exigir dados que não sejam usados.

---

# DADOS DO DEVEDOR

Usar o cadastro do cliente.

Se CPF/endereço não existirem:

não inventar.

Mostrar no app:

```text
Faltam dados para completar o contrato
```

---

# SNAPSHOT DO CONTRATO

Muito importante:

o documento não deve mudar retroativamente quando o cliente editar seu nome/endereço no futuro.

Ao emitir o contrato, guardar snapshot:

```text
creditor_snapshot
debtor_snapshot
financial_snapshot
terms_snapshot
```

Pode ser JSONB ou estrutura equivalente.

---

# VERSIONAMENTO

Se contrato ainda não foi emitido:

pode usar dados atuais.

Após emissão:

```text
version = 1
issued_at
```

Se for reemitido após uma alteração relevante:

```text
version = 2
```

Preservar histórico.

---

# PDF

Gerar PDF server-side.

Requisitos:

```text
A4
boa impressão
número do contrato
data
paginação se necessário
sem elementos da UI
```

Não depender de print do navegador como única solução.

---

# ASSINATURA

NÃO implementar assinatura eletrônica juridicamente avançada neste ciclo sem provider definido.

Preparar estrutura futura:

```text
signature_status
signed_at
signature_provider
external_document_id
```

Mas nesta versão pode existir:

```text
Espaço para assinatura do credor
Espaço para assinatura do devedor
```

---

# OBSERVAÇÃO LEGAL

Não prometer validade jurídica absoluta.

Gerar documento operacional com termos configurados.

Preparar para integração futura com provider de assinatura.

---

# FASE 4 — BILLING REAL DO FIGOCRM

Hoje existe abstração:

```text
BillingProvider
```

Agora precisamos escolher e implementar um provider real.

Antes de alterar:

verificar qual provider foi definido pelo responsável do projeto.

Se já houver provider decidido:

implementar.

Se não houver:

deixar estrutura preparada e indicar claramente o bloqueio no relatório.

NÃO escolher arbitrariamente sem orientação.

---

# MODELO COMERCIAL

O produto possui:

```text
7 dias grátis
1 plano
R$ 24,90/mês
```

---

# FLUXO

Cadastro:

```text
trialing
↓
7 dias
↓
checkout
↓
active
```

---

# CHECKOUT

Criar rota:

```text
POST /api/billing/checkout
```

Retornar URL do provider.

Front:

```text
Assinar por R$ 24,90/mês
```

---

# WEBHOOK

Continuar usando:

```text
assinatura criptográfica
event_id
idempotência
```

Nunca ativar assinatura por:

```text
?success=true
```

ou redirect do navegador.

---

# EVENTOS MÍNIMOS

Suportar:

```text
subscription_created
subscription_active
payment_succeeded
payment_failed
subscription_past_due
subscription_canceled
subscription_reactivated
```

Mapear para:

```text
trialing
active
past_due
canceled
expired
blocked
```

---

# CANCELAMENTO

Tela Conta:

```text
Cancelar assinatura
```

Se o provider permitir cancelamento no fim do período:

preferir:

```text
cancel_at_period_end = true
```

Usuário mantém acesso até:

```text
current_period_end
```

---

# REATIVAÇÃO

Permitir:

```text
Reativar assinatura
```

quando possível.

---

# FASE 5 — TELA DE CONTA / ASSINATURA

Finalizar:

```text
/app/conta
```

Mostrar:

```text
Plano FigoCRM
R$ 24,90/mês

Status
Teste grátis / Ativo / Pagamento pendente / Cancelado

Próxima cobrança
XX/XX/XXXX

[ Assinar ]
[ Gerenciar assinatura ]
```

---

# TRIAL

Durante o teste:

```text
Seu teste grátis termina em 5 dias
```

CTA:

```text
Assinar agora
```

Não esperar expirar para mostrar cobrança.

---

# FASE 6 — ONBOARDING

Hoje o usuário entra no sistema e já vê a Home.

Criar onboarding curto.

Não criar wizard de 10 passos.

---

# PRIMEIRO ACESSO

Mostrar no máximo 3 etapas:

```text
1. Cadastre sua primeira mercadoria
2. Cadastre um cliente
3. Faça sua primeira venda ou fale com o FIGO
```

Mas permitir:

```text
Pular
```

---

# ONBOARDING POR USO

Preferir contextual.

Exemplo:

Estoque vazio:

```text
Você ainda não tem mercadorias.

[ Cadastrar mercadoria ]
[ 🎙 Dizer o que comprou ]
```

Clientes vazios:

```text
Nenhum cliente ainda.

[ Novo cliente ]
[ 🎙 Falar ]
```

---

# NÃO CRIAR TOUR COMPLICADO

Evitar:

```text
tooltip 1/12
tooltip 2/12
...
```

---

# FASE 7 — VOZ + AVULSOS

A voz deve continuar aceitando operações rápidas.

Exemplo:

> “Vendi um iPhone pro João por três mil.”

Se nenhum existe:

```text
cliente provisório
item provisório
```

Resposta:

> “Pronto. Registrei a venda por R$ 3.000. Deixei João e o iPhone para você completar depois.”

---

# CUSTO

Se custo for necessário:

> “Quanto você pagou nesse iPhone?”

A resposta:

> “Dois mil.”

deve preencher exatamente aquele item pendente.

Não iniciar uma nova venda.

---

# FASE 8 — HOME FINAL DO V1

Manter o conceito atual.

Prioridade visual:

```text
Falar

Nova venda
Receber pagamento
Novo cliente
Nova mercadoria
Emprestar dinheiro
Nova troca
```

Depois:

```text
Resumo financeiro
Pendências
Consultas
```

---

# NÃO AUMENTAR A HOME DEMAIS

Não adicionar:

```text
gráficos
funil
kanban
relatórios complexos
```

---

# FASE 9 — PWA

Agora sim preparar PWA.

Implementar:

```text
manifest
ícones
theme-color
installability
standalone
safe-area
```

---

# NÃO PROMETER OFFLINE COMPLETO

O FigoCRM depende de:

```text
Supabase
STT
LLM
```

Portanto offline completo não é objetivo.

---

# OFFLINE UX

Quando sem internet:

mostrar:

```text
Você está sem conexão.

Algumas ações precisam de internet para serem registradas.
```

Não permitir que usuário pense que uma venda foi salva se não foi.

---

# SERVICE WORKER

Pode cachear:

```text
shell
assets
ícones
fontes
```

Não cachear respostas financeiras de forma insegura.

---

# FASE 10 — POLIMENTO DE UX

Revisar toda interface.

Perguntas:

```text
O usuário entende o que fazer em menos de 5 segundos?
O principal botão está visível?
Há texto técnico?
Alguma ação importante exige 5 cliques?
```

---

# MICROCOPY

Preferir:

```text
Receber pagamento
```

em vez de:

```text
Liquidar recebível
```

Preferir:

```text
Quanto ele pagou?
```

em vez de:

```text
Valor da liquidação
```

---

# SUCESSO

Após ação:

```text
Pronto.
```

com resumo.

Exemplo:

```text
Pronto. Registrei R$ 500 do Carlos.

Ainda faltam R$ 1.500.
```

---

# FASE 11 — EXCLUSÕES / CANCELAMENTOS

Revisar todas as telas.

Nunca permitir apagar movimentação financeira histórica diretamente.

Para:

```text
pagamento
abatimento
```

usar:

```text
estorno
```

Para contrato:

avaliar:

```text
cancelamento
```

com audit log.

Nunca apagar contrato com movimentos associados.

---

# FASE 12 — HARDENING DE EMPRÉSTIMOS

Adicionar testes específicos:

```text
juros fixos
percentual total
percentual mensal
0% juros
centavos
parcela final diferente por arredondamento
primeira data
dia 31
fevereiro
```

---

# VALIDAÇÃO DE EMPRÉSTIMO

Banco deve garantir:

```text
principal >= 0
interest >= 0
total = principal + juros
soma parcelas = total
```

Nunca confiar somente no preview React.

---

# FASE 13 — CPF / DOCUMENTOS

Se adicionar CPF/CNPJ:

validar formato.

Não bloquear operação caso ausente, exceto geração final de contrato se definido como obrigatório.

Nunca usar CPF para autenticação.

---

# FASE 14 — LOGS E TELEMETRIA

Continuar registrando:

```text
LLM
STT
erros
latência
custo
```

Adicionar eventos de produto apenas se realmente úteis:

```text
signup_completed
first_customer
first_item
first_sale
first_voice_command
trial_checkout_opened
subscription_activated
```

Não registrar dados financeiros sensíveis desnecessariamente em analytics.

---

# FASE 15 — TESTES E2E DE PRODUTO

Criar fluxo completo.

---

## FLUXO A — USUÁRIO NOVO

```text
cadastro
↓
trial
↓
home
↓
novo cliente
↓
novo item
↓
nova venda
```

---

## FLUXO B — VOZ SEM CADASTRO

```text
“Vendi um iPhone pro João por três mil”
↓
avulso
↓
informa custo
↓
lucro recalculado
↓
vincula João
```

---

## FLUXO C — EMPRÉSTIMO

```text
cliente
↓
emprestar R$ 2.000
↓
juros R$ 500
↓
5×500
↓
gerar contrato
↓
receber 500
↓
estornar
↓
receber novamente
```

---

## FLUXO D — BILLING

```text
trial
↓
checkout
↓
webhook active
↓
pode escrever
↓
cancel_at_period_end
↓
mantém acesso
↓
expira
↓
somente leitura
```

---

# FASE 16 — SEGURANÇA

Rodar Supabase Security Advisor.

Revisar:

```text
SECURITY DEFINER
RPCs novas
storage
loan_contracts
snapshots de contrato
billing
```

---

# SECURITY DEFINER

Toda nova função DEFINER deve:

```text
usar auth.uid()
verificar ownership
SET search_path
REVOKE PUBLIC
REVOKE anon
```

---

# FASE 17 — PERFORMANCE

Não otimizar prematuramente.

Mas verificar:

```text
N+1
consultas da Home
lista clientes
estoque
histórico
empréstimos
```

Usar paginação quando necessário.

---

# FASE 18 — AÇÕES MANUAIS DO RESPONSÁVEL

Se ainda pendente, documentar explicitamente:

```text
ativar Leaked Password Protection
rotacionar OpenAI key
definir domínio final
definir gateway de pagamento
remover Deployment Protection antes do beta
```

Não fingir que isso foi feito automaticamente.

---

# TESTES OBRIGATÓRIOS

Rodar:

```text
npm run lint
npm run test
npm run build
npm run test:security
npm run test:e2e
npm run test:ui
npm run test:benchmark:rules
```

Rodar amostra LLM:

```text
npm run test:benchmark:llm -- --sample=100
```

---

# ADICIONAR TESTES PARA

```text
lucro adulterado via RPC
cost_pending
resolve_item_cost
merge cliente avulso
merge item avulso
contrato snapshot
PDF contrato
billing webhook
cancelamento
reativação
PWA manifest
offline UX
```

---

# NÃO FAZER

Não adicionar neste ciclo:

```text
NF-e
NFS-e
DRE
contabilidade
multiempresa
equipe
permissões avançadas
funil CRM
kanban
marketplace
relatórios complexos
BI
```

---

# DEFINITION OF DONE

Este ciclo só termina quando:

- [ ] lucro não pode ser adulterado pelo payload
- [ ] CMV é validado/calculado no backend/banco
- [ ] cost_pending não gera lucro falso
- [ ] pendências avulsas têm fluxo claro
- [ ] cliente avulso pode ser consolidado
- [ ] item avulso pode ser consolidado
- [ ] empréstimo possui documento contratual
- [ ] contrato pode ser impresso/PDF
- [ ] snapshot do contrato é preservado
- [ ] billing real está conectado, se provider definido
- [ ] checkout funciona
- [ ] webhook funciona
- [ ] cancelamento funciona
- [ ] trial funciona ponta a ponta
- [ ] onboarding está simples
- [ ] PWA instalável
- [ ] experiência offline não mente
- [ ] mobile validado
- [ ] security advisor revisado
- [ ] testes passam
- [ ] build passa
- [ ] Vercel fica READY

---

# RELATÓRIO FINAL

Criar:

```text
docs/architecture/relatorio_figocrm_v1_beta_ready.md
```

Incluir:

```text
resumo
commits
migrations
integridade do lucro
CMV
pendências avulsas
contratos
PDF
billing
trial
onboarding
PWA
security advisor
performance advisor
testes
build
Vercel
pendências manuais
bloqueios para beta
```

---

# PRINCÍPIO FINAL

O V1 não precisa ter muitas funcionalidades.

Precisa fazer muito bem:

```text
cadastrar
vender
trocar
emprestar
receber
consultar
falar
```

e nunca registrar dinheiro errado.

Prioridade:

```text
1. Integridade financeira
2. Simplicidade
3. Velocidade de uso
4. Voz
5. Aparência
```

Não inverter essa ordem.
