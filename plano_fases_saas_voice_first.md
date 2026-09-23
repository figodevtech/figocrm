# Plano de Desenvolvimento — SaaS Voice-First para Vendedores e Revendedores

## 1. Visão do produto

Criar um **SaaS online, simples, mobile-first e voice-first**, voltado para vendedores, revendedores e negociadores independentes que vivem de:

- compra e revenda;
- venda à vista;
- venda parcelada;
- promissórias;
- fiado;
- trocas;
- trocas com volta em dinheiro;
- trocas com volta parcelada;
- recebimentos parciais;
- abatimentos;
- renegociações;
- controle de mercadorias;
- acompanhamento do que ainda está “na rua”;
- acompanhamento de lucro por negociação.

O público principal não quer aprender um ERP, preencher dezenas de campos ou entender conceitos contábeis.

O produto deve funcionar com a seguinte filosofia:

> **O usuário fala. O sistema entende, organiza e salva.**

A digitação e os formulários continuam existindo, mas como alternativa.

---

# 2. Modelo comercial

## 2.1 Estrutura do SaaS

- Cadastro individual por usuário.
- Cada usuário enxerga somente seus próprios dados.
- Teste grátis de **7 dias**.
- Após o período de teste:
  - assinatura única;
  - **R$ 24,90/mês**;
  - sem múltiplos planos na primeira versão.
- Usuário inadimplente perde acesso às funções operacionais, mas seus dados permanecem preservados conforme a política do produto.

## 2.2 Jornada comercial

```text
Anúncio / Instagram / indicação / tráfego orgânico
                         ↓
                  Landing page
                         ↓
                 Criar conta grátis
                         ↓
                  7 dias de teste
                         ↓
                Assinatura R$ 24,90
                         ↓
                  Uso recorrente
```

## 2.3 Regra principal

A landing page deve levar o visitante para:

- criação de conta;
- início do teste grátis;
- ou assinatura, dependendo da estratégia adotada.

O checkout não deve complicar a experiência.

---

# 3. Princípios obrigatórios do produto

Antes de iniciar qualquer código, manter estes princípios como requisitos fixos.

## 3.1 Voice-first

A principal forma de registrar operações deve ser a voz.

Exemplos:

> “Vendi o iPhone pro João por três mil. Ele deu mil no Pix e o resto ficou em quatro de quinhentos.”

> “Carlos me pagou mais trezentos daquela moto.”

> “Peguei uma XRE por vinte mil, dei minha Bros por dezesseis, dois no Pix e fiquei devendo dois.”

> “Rafael me deu um iPhone de dois e quinhentos para abater a dívida.”

O usuário não deve precisar saber em qual módulo entrar.

---

## 3.2 Linguagem simples

Evitar expor termos técnicos sempre que possível.

Exemplo:

Em vez de:

- contas a receber;
- ativo circulante;
- CMV;
- margem bruta;
- contas vencidas.

Preferir:

- **Na rua**;
- **Em mercadoria**;
- **Quanto entrou**;
- **Quanto você ganhou**;
- **Quem está atrasado**.

Os termos técnicos podem existir em telas de detalhe.

---

## 3.3 O sistema deve executar ações

A IA não deve ser apenas um chatbot.

Ela precisa interpretar a fala e transformar a intenção em comandos seguros.

Fluxo:

```text
Áudio
  ↓
Transcrição
  ↓
LLM interpreta intenção
  ↓
Dados estruturados
  ↓
Validação determinística no backend
  ↓
Ação executada
  ↓
Persistência no banco
  ↓
Resposta para o usuário
```

A LLM **não deve escrever diretamente no banco de dados**.

---

## 3.4 Confirmação somente quando necessária

Não confirmar cada operação pequena.

Confirmar quando:

- existir ambiguidade;
- valor estiver incerto;
- cliente não puder ser identificado;
- existir mais de um item possível;
- uma ação for destrutiva;
- uma alteração tiver grande impacto financeiro;
- houver inconsistência matemática.

Exemplo:

> Usuário: “João me deu dois daquela moto.”

Sistema:

> “Você quis dizer R$ 2.000?”

---

## 3.5 Toda operação deve ser auditável

Registrar:

- quem fez;
- quando fez;
- origem da operação;
- texto transcrito;
- interpretação da IA;
- dados efetivamente gravados;
- alterações posteriores;
- reversões.

Deve existir suporte a:

- corrigir;
- editar;
- desfazer.

---

# 4. Arquitetura sugerida

A stack pode ser adaptada, mas uma base adequada ao projeto seria:

## Aplicação

- Next.js
- React
- TypeScript
- PWA
- API/backend via Server Actions, Route Handlers ou backend separado

## Banco/Auth

- PostgreSQL
- Supabase
- Supabase Auth
- Row Level Security

## IA

- Speech-to-Text
- LLM com Structured Output / Tool Calling
- Text-to-Speech opcional

## Pagamentos

- Gateway com:
  - assinatura recorrente;
  - Pix;
  - cartão;
  - webhooks;
  - cancelamento;
  - controle de status da assinatura.

## Infra

- Vercel ou equivalente
- Supabase
- serviço de monitoramento de erros
- analytics de produto

---

# FASE 0 — Definição funcional e regras de negócio

## Objetivo

Definir exatamente o que o sistema deve entender antes de criar banco ou interface.

Nenhuma tela deve ser construída nesta fase.

## Entregáveis

Criar documentação para:

- compra;
- venda;
- parcelamento;
- promissória;
- recebimento;
- pagamento parcial;
- abatimento;
- troca;
- troca com volta;
- troca com volta parcelada;
- renegociação;
- cancelamento;
- devolução;
- custos adicionais;
- CMV;
- lucro;
- estoque;
- recebíveis;
- valores a pagar.

## Definir o conceito de “negociação”

Tratar uma negociação como um conjunto de movimentos.

Uma negociação pode conter:

### Saídas

- mercadoria;
- dinheiro;
- crédito.

### Entradas

- mercadoria;
- dinheiro;
- recebível.

### Obrigações futuras

- parcelas a receber;
- parcelas a pagar.

---

# FASE 1 — Benchmark de linguagem natural

## Objetivo

Criar a bateria de testes que determinará se a IA realmente entende o público.

Antes de integrar qualquer LLM em produção, montar pelo menos:

- 150 frases;
- idealmente 250+.

## Categorias

### Venda

- à vista;
- com entrada;
- parcelada;
- parcelada sem entrada;
- múltiplas formas de pagamento.

### Recebimentos

- parcela integral;
- pagamento parcial;
- antecipação;
- quitação;
- pagamento sem mencionar a negociação.

### Trocas

- troca seca;
- troca com volta recebida;
- troca com volta paga;
- troca com parcelas;
- item + dinheiro;
- item + dinheiro + parcelas.

### Abatimentos

- serviço como abatimento;
- mercadoria como abatimento;
- desconto concedido;
- compensação de dívida.

### Renegociação

- alterar vencimento;
- juntar parcelas;
- dividir saldo;
- perdoar parte;
- gerar novo parcelamento.

### Ambiguidade

- “ele me deu dois”;
- “ficou faltando três”;
- “ele pagou aquela”;
- “deixa pro mês que vem”;
- nomes duplicados;
- produtos parecidos.

## Estrutura dos testes

Cada cenário deve conter:

```yaml
input:
  texto_falado:

contexto_disponivel:

intencao_esperada:

dados_esperados:

acao_esperada:

precisa_confirmacao:

pergunta_esperada:

resultado_financeiro_esperado:
```

## Critério de aprovação

A IA deve alcançar alta precisão antes de ganhar permissão para executar operações reais.

Sempre separar:

- interpretação da IA;
- validação do backend.

---

# FASE 2 — Modelagem do domínio

## Objetivo

Criar uma estrutura de dados capaz de representar negociações simples e complexas.

## Entidades principais

### users / profiles

Dados do usuário.

### customers

Clientes e pessoas envolvidas nas negociações.

### items

Mercadorias.

Pode representar:

- celular;
- moto;
- carro;
- eletrônico;
- peça;
- roupa;
- qualquer item negociável.

### deals

Negociação principal.

Campos conceituais:

- tipo;
- data;
- contraparte;
- status;
- observações;
- origem;
- valor total negociado.

### deal_items

Itens que entraram ou saíram da negociação.

Direção:

```text
IN
OUT
```

### cash_movements

Dinheiro que entrou ou saiu.

### receivables

Valores a receber.

### payables

Valores a pagar.

### installments

Parcelas.

### payments

Pagamentos recebidos ou realizados.

### adjustments

Abatimentos, descontos, compensações e ajustes.

### item_costs

Custos associados à mercadoria:

- compra;
- manutenção;
- transporte;
- reparo;
- documentação;
- outros.

### ai_interactions

Histórico das interações por voz/IA.

### audit_log

Auditoria de alterações importantes.

---

# FASE 3 — Regras financeiras e motor de negociação

## Objetivo

Fazer o sistema calcular corretamente os negócios sem depender da LLM.

A LLM interpreta.

O motor financeiro decide.

## Implementar

### CMV

```text
CMV =
custo de aquisição
+ reparos
+ transporte
+ documentação
+ outros custos atribuíveis
```

### Lucro bruto

```text
Lucro bruto =
valor reconhecido da venda
- CMV
```

### Valores a receber

Controlar:

- total;
- recebido;
- saldo;
- vencido;
- a vencer.

### Parcelamento

Permitir:

- quantidade;
- valor por parcela;
- primeira data;
- intervalo;
- vencimento mensal;
- parcelas de valores diferentes.

### Pagamento parcial

Exemplo:

```text
Parcela: R$ 500
Recebido: R$ 200
Saldo: R$ 300
```

Não marcar automaticamente como quitada.

### Abatimento

Abatimento não é pagamento.

Registrar separadamente.

### Troca

Itens recebidos em troca devem virar estoque com custo de entrada definido pela negociação.

### Troca com volta

Suportar:

```text
mercadoria → mercadoria
mercadoria → mercadoria + dinheiro
mercadoria → mercadoria + recebível
mercadoria + dinheiro → mercadoria
mercadoria + parcelas → mercadoria
```

---

# FASE 4 — Banco de dados e segurança

## Objetivo

Criar a fundação multiusuário do SaaS.

## Implementar

- migrations;
- índices;
- foreign keys;
- constraints;
- soft delete onde necessário;
- timestamps;
- trilha de auditoria.

## Multi-tenant

Todas as entidades pertencentes ao usuário devem possuir associação clara ao dono.

Exemplo:

```text
user_id
```

## RLS

Criar políticas para impedir completamente:

- leitura de dados de outro usuário;
- alteração de dados de outro usuário;
- exclusão de dados de outro usuário.

## Testar

Criar testes automáticos tentando acessar registros de usuários diferentes.

---

# FASE 5 — Autenticação e ciclo de vida do usuário

## Objetivo

Ter cadastro e acesso funcionando antes do front-end definitivo.

## Fluxos

- criar conta;
- login;
- logout;
- recuperação de senha;
- confirmação de e-mail, caso adotada;
- exclusão de conta;
- exportação de dados.

## Perfil

Guardar:

- nome;
- telefone;
- segmento principal;
- data de cadastro;
- data de início do trial;
- data de fim do trial;
- situação da assinatura.

---

# FASE 6 — Trial e assinatura

## Objetivo

Implementar o modelo comercial antes do lançamento.

## Trial

Ao criar a conta:

```text
trial_started_at = agora
trial_ends_at = agora + 7 dias
```

## Estados possíveis

```text
trial
active
past_due
canceled
expired
blocked
```

## Após o trial

Se não houver assinatura:

- permitir login;
- permitir visualizar que o período acabou;
- impedir criação de novas operações;
- apresentar assinatura;
- não apagar os dados.

## Assinatura

Plano único:

> **R$ 24,90/mês**

Implementar:

- checkout;
- webhooks;
- confirmação de pagamento;
- renovação;
- falha de cobrança;
- cancelamento;
- reativação.

## Segurança

Nunca liberar assinatura apenas com retorno do navegador.

O backend deve validar o webhook do gateway.

---

# FASE 7 — API e camada de ações do sistema

## Objetivo

Criar operações padronizadas que poderão ser usadas tanto pela interface manual quanto pela IA.

## Exemplos de comandos

```text
create_customer
create_item
register_purchase
create_sale
create_trade
create_receivable
create_payable
register_payment
register_partial_payment
register_adjustment
renegotiate_debt
update_due_date
cancel_deal
undo_operation
get_customer_balance
get_overdue_customers
get_inventory_value
get_profit_summary
```

Cada comando deve:

1. validar autenticação;
2. validar assinatura;
3. validar os dados;
4. validar regras financeiras;
5. executar em transação;
6. registrar auditoria;
7. retornar resultado estruturado.

---

# FASE 8 — Pipeline de voz

## Objetivo

Transformar áudio em intenção estruturada.

## Pipeline

```text
gravação
   ↓
upload temporário
   ↓
speech-to-text
   ↓
normalização
   ↓
LLM
   ↓
structured output
   ↓
validação
   ↓
ação
   ↓
resposta
```

## O áudio não deve ser o dado principal

O dado principal é a operação estruturada.

Definir política específica para retenção ou exclusão dos áudios.

---

# FASE 9 — Orquestração da LLM

## Objetivo

Fazer a IA entender linguagem natural sem dar autonomia irrestrita.

## A LLM deve retornar estrutura

Exemplo:

```json
{
  "intent": "create_sale",
  "customer": "João",
  "items": [
    {
      "reference": "iPhone 13"
    }
  ],
  "deal_value": 3000,
  "payments": [
    {
      "type": "pix",
      "amount": 1000
    }
  ],
  "receivable": {
    "amount": 2000,
    "installments": 4,
    "installment_amount": 500
  },
  "ambiguities": []
}
```

## Nunca permitir

- SQL livre gerado pelo modelo;
- gravação direta no banco;
- exclusão sem validação;
- alteração financeira sem regras determinísticas.

## Contexto permitido

A IA pode consultar:

- clientes do usuário;
- mercadorias;
- negócios recentes;
- saldos;
- parcelas;
- histórico relevante.

Sempre com escopo do usuário atual.

---

# FASE 10 — Motor de contexto e desambiguação

## Objetivo

Permitir conversas naturais.

Exemplo:

> “Quanto João está me devendo?”

Depois:

> “Ele pagou 300 agora.”

O sistema deve conseguir relacionar “ele” com João.

## Contexto temporário

Guardar:

- cliente mencionado recentemente;
- negociação atual;
- mercadoria atual;
- intenção anterior.

## Desambiguação

Exemplo:

> “João pagou 500.”

Se existirem três dívidas abertas:

> “Você quer abater na parcela da moto, no iPhone ou na TV?”

## Nunca inferir valores críticos sem confiança suficiente

Exemplo:

> “Ele me deu dois.”

Perguntar:

> “Você quis dizer R$ 2.000?”

---

# FASE 11 — Respostas e feedback da IA

## Objetivo

Dar confiança ao usuário.

Após cada ação, responder com linguagem curta.

Exemplo:

> “Pronto. Registrei a venda por R$ 3.000. Entrou R$ 1.000 no Pix e ficaram R$ 2.000 em quatro parcelas de R$ 500.”

Evitar textos longos.

## Mostrar sempre que relevante

- o que foi salvo;
- quanto entrou;
- quanto falta;
- próxima parcela;
- item recebido;
- item retirado;
- lucro estimado.

## Desfazer

Após operações:

> **Desfazer**

O recurso deve existir para erros de interpretação.

---

# FASE 12 — Testes automatizados do domínio

## Objetivo

Garantir que mudanças futuras não quebrem regras financeiras.

## Testes obrigatórios

- venda à vista;
- venda parcelada;
- entrada + parcelas;
- recebimento parcial;
- troca seca;
- troca com volta;
- volta parcelada;
- múltiplos meios de pagamento;
- abatimento;
- antecipação;
- renegociação;
- cancelamento;
- reversão;
- CMV;
- lucro;
- estoque;
- saldo do cliente.

---

# FASE 13 — Benchmark automatizado da IA

## Objetivo

Rodar a bateria criada na Fase 1 de forma repetível.

## Medir

- intenção correta;
- valores corretos;
- datas corretas;
- identificação do cliente;
- identificação do produto;
- direção do dinheiro;
- direção da troca;
- parcelamento;
- necessidade de confirmação;
- operação final.

## Métricas

Exemplo:

```text
Intent accuracy
Entity accuracy
Financial accuracy
Ambiguity detection
Unsafe execution rate
Full scenario accuracy
```

A métrica mais importante é:

> **Full scenario accuracy**

Ou seja: toda a negociação foi entendida corretamente?

---

# FASE 14 — Observabilidade e custos

## Objetivo

Saber quanto cada usuário custa e onde o sistema falha.

## Monitorar

- número de transcrições;
- duração de áudio;
- tokens da LLM;
- custo médio por usuário;
- custo médio por operação;
- taxa de erro;
- latência;
- chamadas repetidas;
- falha na transcrição;
- falha na interpretação;
- falha na ação;
- falha de banco.

## Fundamental para o plano de R$ 24,90

O custo de IA por usuário deve ser conhecido antes de escalar.

Criar limites técnicos para impedir abuso sem prejudicar o usuário comum.

---

# FASE 15 — Analytics de produto

## Objetivo

Descobrir se as pessoas realmente usam o sistema.

## Eventos importantes

- cadastro;
- primeira operação;
- primeira operação por voz;
- primeira venda;
- primeiro parcelamento;
- primeiro recebimento;
- primeiro item em troca;
- assinatura iniciada;
- assinatura cancelada.

## Métricas importantes

- ativação no primeiro dia;
- operações por usuário;
- % por voz;
- retenção;
- conversão trial → pago;
- churn;
- usuários que nunca registraram operação.

---

# FASE 16 — Landing page e aquisição

## Objetivo

Criar a página comercial antes do front-end completo do sistema.

A landing page deve ser extremamente simples.

## Mensagem principal sugerida

> **Você fala. Ele organiza.**

Complemento:

> Controle suas compras, vendas, trocas, parcelas e dinheiro a receber sem perder tempo preenchendo sistema.

## Demonstração

Mostrar um exemplo real:

### Usuário fala

> “Vendi a moto pro Carlos por quinze. Ele me deu cinco e vai pagar os outros dez em dez parcelas.”

### Sistema responde

```text
Venda: R$ 15.000
Recebido: R$ 5.000
Na rua: R$ 10.000
10 parcelas de R$ 1.000
```

## CTA

> **Começar 7 dias grátis**

## Página deve apresentar

- problema;
- demonstração da voz;
- simplicidade;
- benefícios;
- preço;
- teste grátis;
- perguntas frequentes;
- CTA.

## Preço

> **R$ 24,90/mês após 7 dias grátis**

Evitar excesso de planos.

---

# FASE 17 — Administração interna

## Objetivo

Criar ferramentas mínimas para operação do SaaS.

## Painel interno

Visualizar:

- usuários;
- trials;
- assinaturas;
- status;
- uso da IA;
- custos;
- erros;
- cancelamentos;
- usuários bloqueados.

## Não misturar

O painel administrativo não deve compartilhar permissões com usuários comuns.

---

# FASE 18 — BACK-END MANUAL COMPLETO

## Objetivo

Antes de criar a experiência visual definitiva, garantir que **todas as operações funcionem por API**.

Deve ser possível testar tudo via:

- testes;
- chamadas HTTP;
- interface temporária de desenvolvimento;
- ferramentas internas.

## Condição para avançar

Só iniciar o front-end final quando:

- banco estiver validado;
- RLS validada;
- pagamentos funcionando;
- trial funcionando;
- motor financeiro funcionando;
- voz funcionando;
- LLM funcionando;
- benchmark aceitável;
- APIs estáveis.

---

# FASE 19 — FRONT-END FINAL

> **Esta fase deve ser executada por último.**

## Objetivo

Criar uma interface adequada para alguém que:

- está trabalhando;
- está andando;
- está negociando;
- está atendendo cliente;
- está na rua;
- tem pouca familiaridade com sistemas;
- quer registrar algo rapidamente e esquecer.

O usuário não deve sentir que está usando um ERP.

---

## 19.1 Home

A home deve responder imediatamente:

### Quanto tenho na rua?

```text
R$ 8.450
```

### Quanto está atrasado?

```text
R$ 1.350
```

### Quanto tenho em mercadoria?

```text
R$ 12.800
```

### Quanto ganhei?

```text
R$ 3.420 este mês
```

---

## 19.2 Principal ação da tela

Botão grande:

> 🎙️ **Falar**

Deve ser o elemento principal.

Exemplo:

```text
┌──────────────────────────────┐
│      O que aconteceu?        │
│                              │
│        🎙️  FALAR            │
│                              │
│  Ex: “João me pagou 500”     │
└──────────────────────────────┘
```

---

## 19.3 Acesso manual

Abaixo:

> Prefere digitar?

Acesso para:

- venda;
- compra;
- troca;
- recebimento;
- cliente;
- mercadoria.

Não transformar a home em um menu gigante.

---

## 19.4 Navegação

No máximo:

```text
Início
Negócios
Clientes
Mercadorias
Conta
```

Evitar dezenas de módulos.

---

## 19.5 Busca universal

Campo:

> **O que você procura?**

Aceitar:

- cliente;
- telefone;
- produto;
- placa;
- descrição;
- valor;
- negócio.

---

## 19.6 Clientes

Ao abrir cliente:

```text
Carlos

Deve para você
R$ 2.300

Atrasado
R$ 500

Próximo pagamento
R$ 600 — dia 10

[ Registrar recebimento ]
[ Falar ]
```

Não começar mostrando relatórios.

---

## 19.7 Mercadorias

Mostrar:

- foto;
- nome;
- quanto custou;
- há quanto tempo está parada;
- valor sugerido/pretendido;
- origem.

---

## 19.8 Negociação

Resumo humano:

```text
Venda para Carlos

iPhone 15 Pro

Vendeu por:
R$ 5.000

Você recebeu:
R$ 2.000

Falta receber:
R$ 3.000

3 × R$ 1.000
```

Detalhes técnicos somente se o usuário expandir.

---

## 19.9 Acessibilidade operacional

Priorizar:

- botões grandes;
- alto contraste;
- tipografia grande;
- poucas opções por tela;
- uma ação principal por tela;
- feedback visual imediato;
- feedback sonoro opcional;
- uso confortável com uma mão.

---

# FASE 20 — PWA

## Objetivo

Fazer o SaaS se comportar como aplicativo sem exigir publicação inicial em loja.

## Implementar

- manifest;
- service worker;
- ícones;
- instalação na tela inicial;
- splash screen;
- standalone mode;
- cache de assets;
- atualização controlada.

## Mobile-first

A experiência principal deve ser celular.

Desktop é secundário.

---

## 20.1 Estratégia offline

Não permitir que perda de internet faça o usuário perder uma anotação importante.

### Fluxo ideal

Usuário grava/fala.

Se estiver offline:

```text
Operação pendente
↓
salvar localmente
↓
sincronizar ao recuperar conexão
```

Porém:

- não executar LLM em nuvem enquanto offline;
- preservar o áudio ou rascunho local temporariamente;
- mostrar claramente que ainda não foi processado.

Exemplo:

> “Salvei sua gravação. Vou processar quando a internet voltar.”

---

## 20.2 Instalação

Após algumas interações:

> “Quer colocar o app na tela inicial?”

Não interromper o primeiro uso imediatamente.

---

# FASE 21 — Onboarding final

## Objetivo

Levar o usuário à primeira operação em menos de poucos minutos.

Não começar pedindo configuração extensa.

## Fluxo sugerido

### Tela 1

> “O que você costuma negociar?”

- celulares;
- motos;
- carros;
- peças;
- eletrônicos;
- roupas;
- outros.

### Tela 2

> “Vamos salvar seu primeiro negócio?”

Botão:

> 🎙️ **Me conte o que aconteceu**

Usuário:

> “Comprei um iPhone 13 hoje por dois mil e quatrocentos.”

Sistema:

> “Pronto. Seu primeiro produto está salvo.”

---

# FASE 22 — Beta fechado

## Objetivo

Testar com usuários reais antes de investir em tráfego.

Buscar inicialmente:

- 10 usuários;
- depois 20;
- depois 50.

## Observar

- o que eles falam;
- como descrevem dinheiro;
- como chamam parcelamentos;
- como falam sobre trocas;
- como falam sobre volta;
- como falam sobre dívida;
- quais termos regionais usam;
- onde a IA erra.

Não corrigir somente o usuário.

Corrigir o produto para entender o usuário.

---

# FASE 23 — Lançamento

## Checklist mínimo

- [ ] Landing page
- [ ] Cadastro
- [ ] Trial 7 dias
- [ ] Assinatura R$ 24,90
- [ ] RLS validada
- [ ] Voz
- [ ] Venda
- [ ] Compra
- [ ] Troca
- [ ] Parcelas
- [ ] Recebimentos
- [ ] Abatimentos
- [ ] CMV
- [ ] Lucro
- [ ] Estoque
- [ ] Valores a receber
- [ ] Desfazer
- [ ] Auditoria
- [ ] Benchmark IA
- [ ] Monitoramento
- [ ] PWA
- [ ] Analytics
- [ ] Política de privacidade
- [ ] Termos de uso
- [ ] LGPD
- [ ] Fluxo de cancelamento

---

# 24. Escopo do MVP

Para impedir que o projeto vire um ERP antes de lançar, o MVP deve focar apenas em:

## Entradas

- compra de mercadoria;
- item recebido em troca.

## Saídas

- venda;
- item entregue em troca.

## Financeiro

- dinheiro recebido;
- dinheiro pago;
- contas a receber;
- contas a pagar;
- parcelas;
- pagamentos parciais;
- abatimentos.

## Controle

- clientes;
- mercadorias;
- negociações;
- CMV;
- lucro;
- atrasados;
- histórico.

## IA

- voz;
- interpretação;
- desambiguação;
- execução segura.

---

# 25. O que NÃO desenvolver no MVP

Evitar inicialmente:

- emissão fiscal;
- NF-e;
- NFC-e;
- NFS-e;
- contabilidade;
- plano de contas complexo;
- DRE contábil completa;
- múltiplas filiais;
- vários usuários por conta;
- RH;
- folha;
- CRM complexo;
- marketplace;
- integrações excessivas;
- dezenas de relatórios;
- customização avançada.

Essas funcionalidades desviariam o produto do público principal.

---

# 26. Ordem final de execução

```text
FASE 0   Regras de negócio
   ↓
FASE 1   Benchmark de linguagem natural
   ↓
FASE 2   Modelagem do domínio
   ↓
FASE 3   Motor financeiro
   ↓
FASE 4   Banco + segurança
   ↓
FASE 5   Autenticação
   ↓
FASE 6   Trial + assinatura
   ↓
FASE 7   APIs e ações
   ↓
FASE 8   Voz
   ↓
FASE 9   LLM
   ↓
FASE 10  Contexto e desambiguação
   ↓
FASE 11  Feedback / desfazer
   ↓
FASE 12  Testes do domínio
   ↓
FASE 13  Benchmark automatizado
   ↓
FASE 14  Observabilidade
   ↓
FASE 15  Analytics
   ↓
FASE 16  Landing page
   ↓
FASE 17  Administração
   ↓
FASE 18  Backend completo validado
   ↓
FASE 19  Front-end final
   ↓
FASE 20  PWA
   ↓
FASE 21  Onboarding
   ↓
FASE 22  Beta
   ↓
FASE 23  Lançamento
```

---

# 27. Regra de ouro do projeto

Sempre que surgir uma nova funcionalidade, perguntar:

> **Isso ajuda o vendedor a salvar, lembrar ou entender um negócio com menos esforço?**

Se a resposta for não, provavelmente não pertence ao MVP.

O produto não deve ensinar o usuário a operar um sistema.

> **O sistema deve aprender a entender o usuário.**

---

# 28. Objetivo de experiência

O cenário ideal é o usuário conseguir abrir o aplicativo e dizer:

> “João me pagou quinhentos daquela Bros.”

E fechar o celular poucos segundos depois.

O sistema deve cuidar do restante:

- identificar João;
- localizar a negociação;
- encontrar o saldo;
- registrar o pagamento;
- atualizar a parcela;
- recalcular o valor em aberto;
- registrar auditoria;
- salvar tudo;
- responder de forma curta.

Se isso funcionar de forma confiável, o principal diferencial do produto estará validado.
