# Relatório — Módulos do app v1 (navegação por atalhos)

Data: 23/09/2026 · Branch: `main` · Commits `d358cff..8798d48` (a partir de `61ef171`) · Deploy Vercel: **Ready (Production, 8798d48)**

Base: `Prompt — Finalização dos Módulos do FigoCRM com Navegação por Atalhos.md`, `contrato_api_front.md`,
`relatorio_pre_front_production_ready.md`. Nenhuma regra financeira foi duplicada no React: toda tela
monta dados e chama o domínio existente (`DealCommand → executor → RPC`) ou a nova RPC de empréstimo, que
reusa a mesma dívida/parcelas/liquidações/estorno/renegociação.

## 1. Resumo

| Critério | Estado | Evidência |
| :--- | :--- | :--- |
| Cadastro / login / logout / reset de senha | ✅ | telas + `/auth/callback`; E2E auth 3/3; UI: guardas no navegador |
| Guardas de rota | ✅ | `/app/*` sem sessão → `/login?next=`; logado em `/login`/`/cadastro` → `/app` (unit + navegador) |
| Home com atalhos | ✅ | indicadores, FALAR, 6 atalhos grandes + 4 de consulta |
| Nenhuma sidebar | ✅ | teste de UI procura `aside`/sidebar/menu em todas as telas e larguras: 0 |
| Clientes completos | ✅ | lista em cards com busca/filtro, cadastro, detalhe (deve/atrasado/próximo), edição, histórico |
| Estoque completo | ✅ | cards, cadastro adaptável por categoria, custos adicionais, status, foto |
| Venda manual | ✅ | fluxo 3 (3200 → 1000 Pix → 4×550) no banco e clicando no navegador |
| Troca manual + item recebido no estoque | ✅ | E2E: XRE entra `disponivel` por 22.000, aparece "Recebido em troca" |
| Empréstimo com juros → dívida e parcelas | ✅ | fluxo 4 + % ao mês; banco recusa payload adulterado |
| Pagamentos manuais (inclusive parcial) | ✅ | fluxo 5; clicando: escolha explícita entre 2 dívidas + desfazer |
| Histórico do cliente | ✅ | vendas, trocas, empréstimos, pagamentos, abatimentos, renegociações, estornos |
| Voz contextual | ✅ | fluxo 6 com LLM real e com parser: "Ele pagou mais 500 do empréstimo." na tela do Carlos |
| Dashboard simples | ✅ | A receber / Atrasado / Em mercadoria / Ganhei este mês (RPC existente) |
| Mobile-first validado | ✅ | Chrome real em 360, 390, 430, 768, 1024, 1440 px: sem rolagem horizontal, alvos ≥ 40 px |
| Build / testes | ✅ | seções 10 e 12 |
| Deploy Vercel | ✅ | seção 13 |

## 2. Rotas

| Rota | Tela |
| :--- | :--- |
| `/login`, `/cadastro`, `/esqueci-senha`, `/redefinir-senha` | entrada (públicas) |
| `/auth/callback` | destino do link de e-mail (código PKCE ou `token_hash`) |
| `/app` | Home: resumo, FALAR, atalhos |
| `/app/conta` | plano, dias de teste, dados, alterar senha, sair |
| `/app/clientes`, `/novo`, `/[id]`, `/[id]/editar` | clientes |
| `/app/estoque`, `/novo`, `/[id]`, `/[id]/editar` | mercadorias |
| `/app/vendas/nova` | nova venda (5 passos) — aceita `?cliente=` e `?item=` |
| `/app/trocas/nova` | nova troca (5 passos) |
| `/app/emprestimos`, `/novo`, `/[id]` | empréstimos |
| `/app/receber` | receber pagamento — aceita `?cliente=` e `?divida=` |
| `/app/negocios` | vendas / trocas / compras |

`loading.tsx` (skeleton), `error.tsx` (tentar de novo) e `not-found.tsx` cobrem todas as rotas do app.

## 3. Estrutura e navegação

- **Sem sidebar e sem hambúrguer.** A Home é a central. Abaixo de 1024 px: barra inferior fixa
  (Início, Clientes, **Falar** elevado no centro, Estoque, Conta). A partir de 1024 px: navegação
  horizontal compacta no topo + botão Falar. O teste de UI pegou rolagem horizontal de 20 px em 768 px
  quando a navegação de topo começava em `md`; por isso tablet usa a barra inferior.
- Fluxo: Home → atalho → passos → tela "Pronto" com [Início] [Ver cliente] [Repetir].
- Acessibilidade: labels visíveis, `aria-label` nos ícones, foco visível (anel de 3 px), texto de campo
  16 px (iPhone não dá zoom), zoom do navegador liberado (antes estava bloqueado), alvos ≥ 48 px nos
  botões, `role="radio"`/`role="tab"`/`role="dialog"`, foco levado ao título a cada passo, "Pular para o conteúdo".

## 4. Componentes

| Pasta | Conteúdo |
| :--- | :--- |
| `src/components/ui` | `Button`/`ButtonLink`, campos (`TextField`, `MoneyField`, `SelectField`, `TextAreaField`, `Choice`), `PageHeader`, `Card`, `Stat`, `Badge`, `Alert`, `EmptyState`, `Skeleton`, `Row` |
| `src/components/app` | `AppShell`, pickers com busca e cadastro rápido, listas (clientes, estoque, negócios), formulários (cliente, mercadoria, empréstimo), painéis (custos, status, renegociação), assistentes (venda, troca, receber), `debt-parts` (dívida, parcela, histórico) |
| `src/components/voice` | `VoiceProvider` (painel de voz global), `useRecorder` (MediaRecorder), `VoiceScreen`/`useVoiceScreen` (contexto da tela), `VoiceButton` |
| `src/components/auth` | formulários de entrada com `useActionState` |

## 5. Módulos de domínio (novos)

| Arquivo | Papel |
| :--- | :--- |
| `src/lib/finance/loans.ts` | juros (% total, % ao mês simples, valor fixo), distribuição de centavos, grade pelo gerador de parcelas existente |
| `src/lib/domain/loan-plan.ts` | `planLoan`: termos + grade, sem servidor (prévia da tela = o que grava) |
| `src/lib/domain/loans.ts` | `createLoanContract` → RPC `create_loan_contract` |
| `src/lib/domain/customers.ts`, `items.ts` | cadastro/edição com validação, homônimo perguntado, custos e status |
| `src/lib/domain/app-data.ts` | leituras das telas (sempre com o cliente do usuário → RLS) |
| `src/lib/domain/views.ts` | status em português, estado da parcela, rótulo da dívida, histórico do cliente |
| `src/lib/domain/manual-plan.ts` | contas dos formulários ("4 × 550 = 2200") |
| `src/lib/ai/screen-context.ts` | contexto da tela para a voz |
| `src/lib/voice/assistant-view.ts` | `AssistantResponse` → o que o painel mostra |
| `src/lib/auth/redirects.ts`, `session.ts` | guardas puras e sessão em páginas/ações |

## 6. Migration e tabelas

Uma migration nova, aplicada no banco real: **`20260923000014_app_modules_loans.sql`**.

| Mudança | Detalhe |
| :--- | :--- |
| `loan_contracts` (nova) | `principal_amount`, `interest_type` (`percent_total` / `percent_monthly` / `fixed_amount`), `interest_rate`, `interest_amount`, `total_amount` (CHECK = principal + juros), `installments_count`, `start_date`, `first_due_date`, `status` (`active`/`paid`/`canceled`), `notes`, `source`, `idempotency_key` (único por usuário) |
| `receivables` | `deal_id` passa a ser opcional; nova `loan_contract_id`; CHECK: exatamente uma origem (negócio **ou** empréstimo) |
| `cash_movements` | `loan_contract_id` (saída do dinheiro emprestado) |
| `create_loan_contract(p_payload)` | INVOKER, atômica: confere cliente do usuário, juros × taxa (tolerância 1 centavo), total, grade (1..N, soma = total, vencimentos ≥ data); grava contrato + dívida + parcelas + saída de caixa + `audit_log` (`CREATE_LOAN_CONTRACT`); idempotente |
| `sync_loan_contract_status` | trigger DEFINER (sem EXECUTE para clientes): contrato vira `paid` quando a dívida quita e volta a `active` num estorno |
| RLS `loan_contracts` | SELECT/INSERT do próprio; UPDATE/DELETE revogados; trigger de assinatura (fail-closed) |
| `items` | `brand`, `model`, `identifier`, `imei`, `serial_number`, `plate`, `model_year` |
| `item_costs` | categoria `servico` |
| `customers` | `address` |
| `profiles` | `business_name` (editável); `handle_new_user` grava telefone e negócio do cadastro |
| Storage `item-photos` | bucket privado, 5 MB, jpeg/png/webp; policies por pasta = `auth.uid()`; leitura por URL assinada |

Auditoria (`npm run db:audit`) igual ao baseline anterior: 2 WARN intencionais (`consume_voice_rate_limit`,
`record_ai_telemetry`) e 3 INFO intencionais. As novas funções/tabelas não geraram achados.

## 7. Ações manuais

Todas passam pelo domínio; nenhuma calcula saldo no React.

| Tela | Caminho |
| :--- | :--- |
| Nova venda | `createSaleAction` → `buildManualSaleCommand` → `executeDealCommand` → `execute_deal_transaction`. Pagamento combinável: dinheiro/Pix, ficou devendo (parcelas validadas: não salva se não fechar), mercadoria recebida (vira `itemsIn`). `idempotencyKey` por tela |
| Nova troca | `createTradeAction` → `buildManualTradeCommand` (itemOut, itemIn, cashIn/cashOut, dívida da volta). Quem pagou a diferença é sugerido pelos valores; escolha contraditória é bloqueada |
| Receber | `receivePaymentAction` sobre **uma** dívida escolhida (auto só se o cliente tem exatamente uma), parcela escolhida ou "abater das mais antigas"; parcial normal; excesso recusado; **Desfazer** = estorno |
| Renegociar | `renegotiateDebtAction` → `renegotiate_installments` (parcelas antigas ficam `renegotiated`) |
| Estoque | `createItemFormAction` (com custos), `updateItemFormAction`, `addItemCostFormAction`, `removeItemCostAction` (bloqueado após venda), `setItemStatusAction` (Disponível/Reservado) |

Status do item na tela: `disponivel` → Disponível, `reservado` → Reservado, `vendido` → Vendido;
disponível que entrou numa troca → **Recebido em troca**. "Vender" só aparece para disponível
(a RPC só baixa item `disponivel`).

## 8. Empréstimos

- Juros: **% sobre o total** (principal × taxa), **% ao mês** (juros simples: principal × taxa × nº de
  parcelas) e **valor fixo** (0 = sem juros). Nenhuma fórmula composta foi criada.
- Prévia antes de salvar (emprestado, juros, total, N parcelas de, vencimentos) e confirmação manual.
- Vencimentos mensais no mesmo dia (limitado ao fim do mês). Sem data informada, a 1ª é daqui a um mês —
  o teste de UI mostrou que o padrão "a cada 30 dias" dos negócios escorregava o dia (23/10 → 22/11 → 21/01)
  e isso foi corrigido para empréstimos.
- Detalhe: Empréstimo / Total com juros / Pago / Falta, parcelas com estado, [Receber] [Renegociar] [Falar].
- Dashboard: "A receber" e "Atrasado" já incluem parcelas de empréstimo (mesmas tabelas).

## 9. Voz

- Painel de voz em toda tela (barra inferior / topo / botões Falar nas telas), estados
  Ouvindo → Enviando → Entendendo → Registrando → Pronto/erro, sem termos técnicos. Microfone negado ou
  indisponível → cai para digitar. Candidatos viram botões; leitura de volta vira **Sim / Não**;
  `executed` com `undoAvailable` mostra **Desfazer**; `subscription_required` mostra CTA do plano.
- **Contexto da tela:** cliente, mercadoria, empréstimo (e dívida) vão junto em cada fala. O servidor
  confere cada ID contra o usuário antes de pôr no contexto; ID alheio é ignorado. Se a tela é de outro
  cliente, dívida/negócio da conversa anterior são descartados (nunca selecionar em silêncio).
- **Empréstimo por voz:** intenção `create_loan` (LLM + parser de regras). "Emprestei dois mil pro Pedro em
  cinco de quinhentos" → juro fixo de 500 pela diferença. Sem juros ditos → pergunta. Juros e valor da
  parcela que não fecham → pergunta. "Carlos pagou a segunda do empréstimo" → parcela 2 da dívida do empréstimo.
- `transcribe` agora devolve `assistant` também nos erros.

## 10. Testes

| Suíte | Resultado |
| :--- | :--- |
| `npm run lint` | limpo |
| `npm run test` | financeiro 11/11 · pipeline IA 26/26 · domínio 9/9 · **módulos do app 23/23** (novo) · benchmark de regras aprovado (400/400 núcleo; 0% inseguro no fallback) · diálogo canônico 4/4 |
| `npm run test:security` | **15/15** (+3: empréstimo anon, cruzado entre usuários, UPDATE/DELETE direto) |
| `npm run test:e2e` | multi-turno 9/9 · finance-ops 10/10 · assinatura 10/10 · auth 3/3 · **módulos do app 12/12** (novo) · segurança 15/15 |
| `E2E_INTERPRETER=rules npm run test:app` | 12/12 (fluxos de voz também pelo parser determinístico) |
| `npm run test:ui` (novo, Chrome real) | **13/13** — todas as 15 telas × 6 larguras, fluxos clicando, voz contextual |

Fluxos obrigatórios (todos no banco real): 1 cadastro → Carlos; 2 iPhone custo 2000 (+200 conserto +50 frete
= 2250); 3 venda 3200 / 1000 Pix / 4×550 (idempotente); 4 empréstimo 2000 + 500 em 5×500; 5 receber 500 no
empréstimo + parcial 200 (falta 300) + estorno; 6 "Ele pagou mais 500 do empréstimo" na tela do Carlos →
settlement do Carlos, na dívida do empréstimo, R$ 500, saldo 1.500, venda do iPhone intacta.

Observação honesta: numa das execuções completas o multi-turno falhou 3/9 porque a OpenAI demorou mais de
15 s em um turno. O sistema fez o certo (caiu no parser e pediu confirmação em vez de gravar) e a reexecução
passou 9/9. É instabilidade externa, não regressão.

`npm run test:ui` precisa de `next start` rodando e Chrome instalado (`CHROME_PATH` se estiver em outro lugar):
`npm run build && npx next start -p 3100` e depois `UI_BASE_URL=http://localhost:3100 npm run test:ui`.

## 11. Commits

| Commit | Descrição |
| :--- | :--- |
| `d358cff` | feat(db): add loan contracts, item attributes and private item photos |
| `c31fd82` | feat(domain): loans, customers, items and read models for the app screens |
| `0250afc` | feat(ai): loans by voice and screen-aware voice context |
| `0bf0143` | feat(auth): sign-up, login, password reset and route guards |
| `ac77dfb` | feat(app): shortcut-driven app with customers, stock, sales, trades, loans and payments |
| `8798d48` | test: cover app modules, loans, contextual voice and screens in a real browser |

95 arquivos (64 novos, 31 alterados), +8.525 / −826 linhas. Dependência nova só de desenvolvimento:
`playwright-core` (sem download de navegador; usa o Chrome instalado).

## 12. Build

`next build` ok (Next 16.3.6, Turbopack, TypeScript sem erros). 30 rotas; todas as telas do app são dinâmicas
(sessão por cookie).

## 13. Deploy

- Push `61ef171..8798d48` em `main` → status do GitHub `Vercel: success — Deployment has completed`
  (`2026-09-24T00:44Z`). O commit deste relatório gera um novo deploy só de documentação.
- Migration `000014` aplicada no banco real antes do deploy (`npm run db:migrate`).
- O domínio de produção continua atrás do Deployment Protection (ver relatório anterior): as telas foram
  validadas em `next start` local com o mesmo commit, o mesmo Supabase e a mesma OpenAI (`npm run test:ui`).

## 14. Pendências

**Configuração manual (painel do Supabase):**

1. **Authentication → URL Configuration:** incluir `https://<domínio de produção>/auth/callback` (e o de
   preview, se usado) em *Redirect URLs* e ajustar *Site URL*. Sem isso o link de recuperação de senha e o
   de confirmação de e-mail voltam para a URL padrão e não criam a sessão.
2. O link de recuperação usa PKCE: precisa ser aberto no mesmo navegador que pediu. Aberto em outro aparelho,
   a tela explica e oferece novo link. Para aceitar qualquer aparelho, trocar o template de e-mail para o
   formato `token_hash` (o `/auth/callback` já aceita).
3. Continuam do ciclo anterior: rotacionar a chave da OpenAI, ligar *Leaked password protection*, decidir
   sobre o *Deployment Protection* do domínio público.

**Produto / técnico:**

- "Ganhei este mês" não inclui juros de empréstimo: separar juros de principal em cada recebimento é regra
  financeira ainda não definida (qual parte do pagamento é juro).
- Não há desfazer de empréstimo nem de negócio inteiro (só de pagamento/abatimento).
- "Receber" não tem chave de idempotência na RPC de liquidação; o botão fica bloqueado enquanto salva, mas
  dois envios de abas diferentes gravariam duas vezes.
- Listas carregam até 500 registros com busca no navegador; paginação quando houver volume.
- Uma foto por mercadoria; trocar a foto não apaga a antiga do Storage.
- Exclusão de cliente, de mercadoria e de conta não foram feitas.
- Status `em_preparacao` existe no banco mas não é escolhível na tela.
- PWA e landing final fora do escopo deste ciclo (a landing atual ainda cita PWA).
- `npm audit`: 2 avisos baixos em `@supabase/auth-js` (anteriores a este ciclo).
