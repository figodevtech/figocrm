Você está trabalhando no repositório:

`figodevtech/figocrm`

Branch atual:

`main`

O FigoCRM é um SaaS voice-first para vendedores, revendedores e negociadores independentes.

O público do produto:

- vende celulares;
- motos;
- carros;
- peças;
- eletrônicos;
- máquinas;
- mercadorias em geral;
- vende à vista ou parcelado;
- faz trocas;
- recebe mercadoria como parte do pagamento;
- empresta dinheiro com juros;
- recebe pagamentos parciais;
- negocia dívidas.

Esse usuário geralmente está trabalhando, atendendo clientes, andando, negociando e não quer aprender a operar um ERP tradicional.

A experiência deve ser:

> simples, rápida, visual e orientada a ação.

O diferencial principal continua sendo:

> O usuário fala. O sistema entende e executa.

Mas tudo também precisa poder ser feito manualmente.

---

# OBJETIVO DESTE CICLO

Finalizar os principais módulos visíveis do aplicativo.

Implementar:

```text
1. Login / cadastro / logout / recuperação de senha
2. Estrutura principal do aplicativo
3. Home com atalhos grandes
4. Clientes
5. Estoque
6. Vendas e trocas manuais
7. Contratos / empréstimos com juros
8. Recebimentos
9. Histórico dos clientes
10. Dashboard resumido
11. Integração de voz nas telas
12. Mobile-first e responsividade
```

NÃO implementar PWA completa ainda.

NÃO implementar landing page final ainda.

NÃO criar complexidade típica de ERP.

---

# REGRA DE UX PRINCIPAL — NÃO USAR SIDEBAR

NÃO criar sidebar lateral como navegação principal.

Isso vale tanto para desktop quanto mobile.

O público precisa enxergar as ações imediatamente.

Evitar interfaces como:

```text
Dashboard
Clientes
Produtos
Financeiro
Relatórios
Configurações
```

escondidas em uma barra lateral.

A Home deve ser o principal ponto de navegação.

---

# HOME COMO CENTRAL DO SISTEMA

A rota principal autenticada:

```text
/app
```

deve funcionar como central operacional.

Exemplo conceitual:

```text
Olá, Lucas

A RECEBER
R$ 12.450

ATRASADO
R$ 2.300

EM MERCADORIA
R$ 18.700

GANHEI ESTE MÊS
R$ 4.200


          🎙
        FALAR

  “Conte o que aconteceu”


O que você quer fazer?

┌───────────────────┐
│ 👤 Novo cliente   │
└───────────────────┘

┌───────────────────┐
│ 📦 Nova mercadoria│
└───────────────────┘

┌───────────────────┐
│ 💰 Nova venda     │
└───────────────────┘

┌───────────────────┐
│ 🔄 Nova troca     │
└───────────────────┘

┌───────────────────┐
│ 🤝 Emprestar      │
│    dinheiro       │
└───────────────────┘

┌───────────────────┐
│ 💵 Receber        │
│    pagamento      │
└───────────────────┘
```

Os atalhos são parte central da experiência.

---

# ATALHOS DA HOME

Criar atalhos grandes para:

```text
Novo cliente
Nova mercadoria
Nova venda
Nova troca
Novo empréstimo
Receber pagamento
Ver clientes
Ver estoque
Ver negócios
Ver contratos
```

Não precisam aparecer todos simultaneamente no primeiro viewport.

Prioridade visual:

```text
Falar
Nova venda
Receber pagamento
Novo cliente
Nova mercadoria
Novo empréstimo
```

Depois:

```text
Clientes
Estoque
Negócios
Contratos
```

---

# MOBILE FIRST

O sistema deve ser desenvolvido pensando primeiro em smartphone.

No mobile:

```text
1 coluna
botões grandes
cards clicáveis
pouca digitação
ações próximas ao polegar
```

Touch targets adequados.

Evitar:

- tabelas largas;
- menus escondidos;
- hover como requisito;
- modais gigantes;
- múltiplas colunas apertadas.

---

# BARRA INFERIOR

Pode existir uma bottom navigation pequena e fixa no mobile.

Por exemplo:

```text
Início
Clientes
Falar
Estoque
Conta
```

O botão central:

```text
🎙 Falar
```

pode ser visualmente destacado.

Mas a barra inferior NÃO substitui os atalhos da Home.

A Home continua sendo a central de ações.

No desktop, essa barra pode virar uma navegação horizontal compacta no topo.

---

# NÃO USAR MENU HAMBÚRGUER COMO NAVEGAÇÃO PRINCIPAL

Menu hambúrguer pode existir somente para ações secundárias:

```text
Perfil
Assinatura
Configurações
Sair
Ajuda
```

Não esconder:

```text
Nova venda
Novo cliente
Estoque
Receber
Empréstimo
```

dentro dele.

---

# FASE 1 — AUTENTICAÇÃO

Finalizar:

```text
/login
/cadastro
/esqueci-senha
/redefinir-senha
/app
```

Fluxo de cadastro:

```text
Nome *
E-mail *
Senha *
Telefone
Nome do negócio
```

Depois:

```text
Supabase Auth
↓
profile
↓
subscription trialing
↓
7 dias de teste
↓
/app
```

O trial já deve continuar usando a infraestrutura server-side existente.

---

# LOGIN

Tela extremamente simples:

```text
FIGO

Entre na sua conta

E-mail
Senha

[ Entrar ]

Esqueci minha senha

Ainda não tenho conta
[ Criar conta ]
```

---

# LOGOUT

Disponível em:

```text
Conta
↓
Sair
```

Ao sair:

```text
supabase.auth.signOut()
↓
limpar estado local sensível
↓
/login
```

---

# PROTEÇÃO DE ROTAS

Não autenticado:

```text
/app/*
→ /login
```

Autenticado tentando:

```text
/login
/cadastro
```

redirecionar para:

```text
/app
```

---

# FASE 2 — CONTA

Criar:

```text
/app/conta
```

Mostrar:

```text
Nome
E-mail
Telefone
Negócio

Plano
Teste gratuito / Ativo / Vencido

Dias restantes

Alterar senha
Sair
```

Sem complexidade desnecessária.

---

# FASE 3 — CLIENTES

Rotas:

```text
/app/clientes
/app/clientes/novo
/app/clientes/[id]
```

Cadastro:

```text
Nome *
Telefone
CPF/CNPJ
Endereço
Observações
```

---

# LISTA DE CLIENTES

Evitar tabela no mobile.

Usar cards:

```text
João Carlos
(83) 99999-9999

Deve: R$ 4.300
Atrasado: R$ 800

[ Ver cliente ]
```

Busca no topo:

```text
🔎 Buscar cliente
```

---

# DETALHE DO CLIENTE

Exemplo:

```text
João Carlos

DEVE
R$ 4.300

ATRASADO
R$ 800

PRÓXIMO
10/10 — R$ 500
```

Atalhos:

```text
[ Nova venda ]
[ Receber ]
[ Emprestar ]
[ Falar ]
```

---

# HISTÓRICO DO CLIENTE

Timeline simples:

```text
Hoje
Pagamento
+ R$ 500

10/09
Venda — iPhone 13
R$ 3.200

03/09
Empréstimo
R$ 2.000

01/09
Abatimento
R$ 300
```

Mostrar:

```text
vendas
trocas
empréstimos
pagamentos
abatimentos
renegociações
estornos
```

---

# VOZ NO CLIENTE

Dentro de `/app/clientes/[id]`, o botão de voz deve aproveitar o contexto do cliente.

Exemplo:

Usuário está em Carlos.

Fala:

> “Ele pagou 500.”

O contexto deve receber:

```text
customerId = Carlos
```

Nunca depender somente da LLM descobrir “ele”.

---

# FASE 4 — ESTOQUE

Rotas:

```text
/app/estoque
/app/estoque/novo
/app/estoque/[id]
```

---

# CADASTRO DE MERCADORIA

Campos:

```text
Nome / descrição *
Categoria
Marca
Modelo
Identificação
IMEI
Serial
Placa
Ano

Valor de compra *
Preço de venda sugerido

Observações
Fotos
```

Nem todos os campos são obrigatórios.

O formulário deve se adaptar a vários mercados.

---

# CUSTOS ADICIONAIS

Permitir:

```text
+ Adicionar custo
```

Exemplos:

```text
Conserto
Frete
Peça
Documentação
Serviço
Outro
```

Mostrar:

```text
Compra       R$ 2.000
Conserto     R$   200
Frete        R$    50

CUSTO TOTAL
R$ 2.250
```

Usar o motor de CMV existente.

---

# STATUS DO ITEM

```text
available
reserved
sold
trade_in
```

Traduzir no front:

```text
Disponível
Reservado
Vendido
Recebido em troca
```

---

# LISTA DE ESTOQUE

Cards.

Exemplo:

```text
iPhone 13 128GB Preto

Custo:
R$ 2.250

Venda sugerida:
R$ 2.900

Disponível
```

Atalhos:

```text
[ Vender ]
[ Editar ]
```

---

# FASE 5 — VENDA MANUAL

Rota:

```text
/app/vendas/nova
```

O formulário deve montar o mesmo:

```text
DealCommand
```

que o pipeline de voz.

NÃO criar outro sistema financeiro.

---

# PASSO 1 — CLIENTE

```text
Para quem você vendeu?

[ Buscar cliente ]

ou

[ + Novo cliente ]
```

---

# PASSO 2 — ITEM

```text
O que você vendeu?

[ Buscar no estoque ]
```

Mostrar apenas itens disponíveis.

---

# PASSO 3 — VALOR

```text
Valor da venda

R$ __________
```

---

# PASSO 4 — COMO PAGOU

Não criar formulário fiscal.

Mostrar componentes simples:

```text
Como ele pagou?

[ Dinheiro / Pix ]
[ Ficou devendo ]
[ Deu uma mercadoria ]
```

Pode selecionar vários.

---

# EXEMPLO

Venda:

```text
R$ 3.200
```

Pagamento:

```text
Pix
R$ 1.000
```

Saldo:

```text
R$ 2.200
```

Usuário seleciona:

```text
Parcelar saldo
```

---

# PARCELAMENTO

```text
Quantidade:
4

Valor:
R$ 550

Primeiro vencimento:
10/10/2026

Dia:
10
```

O sistema deve validar:

```text
4 × 550 = 2200
```

Se não fechar:

não salvar.

---

# FASE 6 — TROCA

Pode existir atalho separado:

```text
Nova troca
```

mas deve usar o mesmo `DealCommand`.

Tela:

```text
O que você entregou?
[ Bros ]

Valor negociado
R$ 17.000

O que você recebeu?
[ XRE ]

Valor negociado
R$ 22.000

Diferença
R$ 5.000
```

Perguntar:

```text
Quem pagou a diferença?

( ) Eu paguei
( ) Eu recebi
( ) Sem diferença
```

Isso deve resultar em:

```text
itemOut
itemIn
cashOut / cashIn
```

---

# ITEM RECEBIDO EM TROCA

Quando uma mercadoria entrar numa negociação:

ela deve automaticamente entrar no estoque.

Exemplo:

```text
XRE recebida
Valor negociado: R$ 22.000
```

Registrar como nova mercadoria disponível.

Separar:

```text
valor negociado
```

de:

```text
custo reconhecido no estoque
```

seguindo a regra já existente no domínio.

---

# FASE 7 — CONTRATOS / EMPRÉSTIMOS

Criar módulo visível chamado:

```text
Empréstimos
```

ou:

```text
Contratos
```

Preferência de UX:

```text
Empréstimos
```

porque é mais claro para esse público.

Internamente:

```text
loan_contracts
```

Rotas:

```text
/app/emprestimos
/app/emprestimos/novo
/app/emprestimos/[id]
```

---

# NOVO EMPRÉSTIMO

Campos:

```text
Cliente *

Valor emprestado *
Data *

Tipo de juros *

Taxa / valor *

Quantidade de parcelas *
Primeiro vencimento *
Dia de vencimento

Observação
```

---

# TIPOS DE JUROS

Suportar inicialmente:

```text
percentual total
percentual mensal
valor fixo
```

Não implementar fórmulas financeiras complexas que não estejam definidas.

---

# ESTRUTURA DE DADOS

Criar entidade equivalente a:

```text
loan_contracts
```

com:

```text
id
user_id
customer_id

principal_amount

interest_type
interest_rate
interest_amount

total_amount

start_date
status

notes
created_at
updated_at
```

---

# REGRA IMPORTANTE

Não criar um motor financeiro paralelo.

Fluxo:

```text
loan_contract
↓
receivable
↓
installments
↓
payments
↓
settlements
```

Reutilizar:

```text
pagamento
parcela
estorno
renegociação
audit
```

já existentes.

---

# CÁLCULO VISUAL

Antes de salvar mostrar:

```text
Valor emprestado:
R$ 2.000

Juros:
R$ 500

Total:
R$ 2.500

5 parcelas de:
R$ 500
```

Exigir confirmação manual.

---

# DETALHE DO EMPRÉSTIMO

```text
Carlos

Empréstimo
R$ 2.000

Total com juros
R$ 2.500

Pago
R$ 1.000

Falta
R$ 1.500
```

Parcelas:

```text
1. R$ 500 — Pago
2. R$ 500 — Pago
3. R$ 500 — Vence 10/10
4. R$ 500 — Vence 10/11
5. R$ 500 — Vence 10/12
```

Atalhos:

```text
[ Receber ]
[ Renegociar ]
[ Falar ]
```

---

# VOZ EM EMPRÉSTIMOS

Exemplos:

> “Emprestei dois mil pro Carlos em cinco de quinhentos.”

> “Carlos pagou a segunda do empréstimo.”

> “Junta as duas atrasadas e faz quatro de 300.”

Utilizar o mesmo pipeline de IA já existente.

---

# FASE 8 — RECEBER PAGAMENTO MANUALMENTE

Criar atalho:

```text
Receber pagamento
```

Pode abrir:

```text
/app/receber
```

Fluxo:

```text
Quem pagou?
↓
Cliente
↓
Qual dívida?
↓
Quanto?
↓
Forma
↓
Salvar
```

---

# CASO CLIENTE TENHA UMA DÍVIDA

Selecionar automaticamente e mostrar.

---

# CASO TENHA MAIS DE UMA

Exemplo:

```text
Carlos possui:

XRE — R$ 2.000
Empréstimo — R$ 1.500
```

Usuário escolhe.

Nunca selecionar silenciosamente.

---

# PAGAMENTO PARCIAL

Suportar normalmente.

Exemplo:

```text
Parcela:
R$ 500

Recebido:
R$ 200

Falta:
R$ 300
```

---

# FASE 9 — NEGÓCIOS

Criar:

```text
/app/negocios
```

Mostrar:

```text
vendas
trocas
compras
```

Cards:

```text
iPhone 13
João
R$ 3.200

R$ 1.000 recebido
R$ 2.200 a receber
```

Filtro simples:

```text
Todos
Vendas
Trocas
```

Não criar tela complexa.

---

# FASE 10 — VOZ GLOBAL

O botão de voz deve aparecer em praticamente toda tela.

Pode ser:

```text
botão flutuante
```

ou ação fixa inferior.

---

# CONTEXTO POR TELA

A tela atual deve fornecer contexto adicional.

Exemplos:

### Home

```text
context = geral
```

### Cliente Carlos

```text
customerId = Carlos
```

### Item XRE

```text
itemId = XRE
```

### Empréstimo

```text
loanContractId
customerId
receivableId
```

---

# FASE 11 — ASSISTANT RESPONSE

Usar o contrato existente.

Estados:

```text
executed
answered
needs_input
error
```

Representar visualmente.

---

# EXECUTED

Exemplo:

```text
✓ Pronto

Registrei R$ 500 do Carlos.

Ainda faltam R$ 1.500.
```

Mostrar:

```text
[ Desfazer ]
```

quando:

```text
undoAvailable = true
```

---

# NEEDS INPUT

Exemplo:

```text
Qual João?

[ João Silva ]
[ João Santos ]
```

Não obrigar usuário a digitar se os candidatos já existem.

---

# FASE 12 — DASHBOARD

Home deve consultar indicadores existentes.

Mostrar apenas:

```text
A receber
Atrasado
Mercadoria
Ganhei este mês
```

Nada de gráficos neste primeiro ciclo.

---

# FASE 13 — EMPTY STATES

Toda tela precisa funcionar sem dados.

Exemplo estoque:

```text
Nenhuma mercadoria ainda.

Cadastre sua primeira mercadoria ou fale:

“Comprei um iPhone 13 por dois mil.”
```

Botões:

```text
[ Cadastrar ]
[ 🎙 Falar ]
```

---

# FASE 14 — FEEDBACK VISUAL DA VOZ

Estados:

```text
idle
recording
uploading
transcribing
understanding
executing
done
error
```

Exemplo:

```text
🎙 Ouvindo...
```

depois:

```text
Entendendo...
```

depois:

```text
✓ Pronto
```

Não mostrar termos como:

```text
STT
LLM
Structured Output
RPC
```

ao usuário final.

---

# FASE 15 — CARREGAMENTO

Usar:

```text
skeletons
optimistic feedback quando seguro
```

Nunca bloquear a tela inteira sem necessidade.

---

# FASE 16 — CONFIRMAÇÃO

Não pedir confirmação em tudo.

Seguir regras já existentes:

```text
consulta → executar
operação clara → executar + desfazer
ambiguidade → perguntar
ação destrutiva → confirmar
fallback por regras → readback obrigatório
```

---

# FASE 17 — RESPONSIVIDADE

Testar pelo menos:

```text
360px
390px
430px
768px
1024px
1440px
```

Priorizar:

```text
360–430px
```

---

# FASE 18 — ACESSIBILIDADE

Obrigatório:

```text
labels
aria-label nos ícones
focus visível
contraste adequado
navegação por teclado
touch target mínimo
```

---

# DESIGN

Manter:

```text
clean
moderno
pouco texto
cards grandes
tipografia clara
bom espaçamento
```

Não parecer:

```text
ERP desktop antigo
dashboard corporativo
painel administrativo
```

---

# NÃO CRIAR SIDEBAR

Reforçando:

NÃO criar:

```text
sidebar fixa
sidebar recolhível
sidebar com 10 opções
```

A experiência deve ser:

```text
Home
↓
atalho
↓
tarefa
↓
concluir
↓
Home
```

---

# ARQUITETURA

Não duplicar regras financeiras no React.

Front apenas coleta dados.

Fluxo:

```text
UI
↓
Server Action / API
↓
DealCommand
↓
domain
↓
RPC
↓
Supabase
```

---

# TESTES

Adicionar:

```text
auth flows
customers
inventory
manual sale
manual trade
loan creation
loan installments
payment
partial payment
voice context
AssistantResponse
```

Rodar:

```text
npm run lint
npm run test
npm run build
npm run test:security
npm run test:e2e
```

---

# TESTES DE FLUXO OBRIGATÓRIOS

## Fluxo 1

```text
Cadastro
↓
Home
↓
Novo cliente
↓
Carlos
```

---

## Fluxo 2

```text
Nova mercadoria
↓
iPhone
↓
custo 2000
```

---

## Fluxo 3

```text
Nova venda
↓
Carlos
↓
iPhone
↓
3200
↓
1000 Pix
↓
4×550
```

---

## Fluxo 4

```text
Novo empréstimo
↓
Carlos
↓
2000
↓
500 juros
↓
5×500
```

---

## Fluxo 5

```text
Receber pagamento
↓
Carlos
↓
Empréstimo
↓
500
```

---

## Fluxo 6 — VOZ CONTEXTUAL

Abrir Carlos.

Falar:

> “Ele pagou mais 500 do empréstimo.”

Validar:

```text
Carlos
empréstimo correto
pagamento correto
saldo correto
```

---

# CRITÉRIO DE CONCLUSÃO

Este ciclo termina quando:

- [ ] cadastro funciona
- [ ] login funciona
- [ ] logout funciona
- [ ] reset de senha funciona
- [ ] guards funcionam
- [ ] Home com atalhos pronta
- [ ] nenhuma sidebar
- [ ] clientes completos
- [ ] estoque completo
- [ ] venda manual completa
- [ ] troca manual completa
- [ ] item recebido entra no estoque
- [ ] empréstimo com juros funciona
- [ ] empréstimo gera recebível e parcelas
- [ ] pagamentos manuais funcionam
- [ ] histórico do cliente funciona
- [ ] voz contextual funciona
- [ ] dashboard simples funciona
- [ ] mobile-first validado
- [ ] build passa
- [ ] testes passam
- [ ] deploy Vercel READY

---

# RELATÓRIO FINAL

Criar:

```text
docs/architecture/relatorio_modulos_app_v1.md
```

Documentar:

```text
rotas
fluxos
componentes
módulos
novas migrations
tabelas
ações manuais
empréstimos
voz contextual
testes
build
deploy
pendências
```

---

# PRINCÍPIO FINAL

O usuário precisa abrir o aplicativo e saber imediatamente o que fazer.

Ele não deve precisar:

- abrir sidebar;
- aprender nomes técnicos;
- navegar por cinco níveis;
- entender conceitos contábeis.

Ele precisa enxergar:

```text
Vender
Receber
Cadastrar
Emprestar
Consultar
Falar
```

O aplicativo deve funcionar como uma ferramenta de trabalho rápida, não como um ERP tradicional.