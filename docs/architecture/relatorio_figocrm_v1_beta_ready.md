# Fechamento do FigoCRM V1 para beta — 24/09/2026

## Resumo e estado

O núcleo financeiro e os fluxos de registros avulsos e contratos documentais foram fechados e verificados contra o Supabase real. A decisão comercial posterior do usuário definiu **Asaas, Free permanente e Pro a R$ 24,50/mês**. A integração Free/Pro está implementada; todas as 21 migrations locais constam como aplicadas no Supabase `crm`, e testes unitários, E2E, visuais e build passaram. O checkout autenticado do app publicou uma sessão recorrente no Asaas Sandbox, redirecionou para a página hospedada, persistiu a sessão e processou o cancelamento pelo webhook. O deployment Production da `main` foi refeito e está `READY`. **Ainda falta validar um pagamento sandbox e seu evento financeiro ponta a ponta antes de declarar beta público.**

## Código, commits e migrations

- Em 24/09/2026, `HEAD` e `origin/main` apontavam para `591ee2c`. A instrução posterior do usuário escolheu Asaas com Free/Pro; ela prevalece sobre o preço anterior do prompt.
- Aplicadas no projeto Supabase `crm` (`wjtsxomfezrqwdnnxcuh`): `20260924113532_derive_deal_profit_from_cmv.sql` e `20260924114640_loan_document_snapshots.sql`.
- Aplicadas no projeto `crm` após autorização explícita: `20260924131613_free_pro_entitlements.sql`, `20260924131911_voice_plan_quota.sql` e `20260924132517_asaas_billing_support.sql`, em transação única pelo executor limitado `scripts/apply_free_pro_migrations.mjs`. Antes disso, a revisão automática rejeitou o executor genérico `scripts/apply_migrations.mjs` por potencialmente aplicar todas as migrations pendentes sem autorização; nenhum outro arquivo foi aplicado por esse caminho.

## Integridade financeira e CMV

O PostgreSQL calcula `recognized_profit = total_value - CMV` usando todos os itens `OUT`. O CMV inclui `acquisition_cost` e os custos adicionais de `item_costs`. Triggers recalculam o lucro quando itens ou custos mudam. Se houver custo pendente, `profit_pending = true` e lucro reconhecido zero até a resolução. O banco ignora o lucro enviado pelo payload; permissões impedem alteração direta de preço, itens e custos históricos. O teste de rollback `scripts/check_beta_migrations.mjs` e os E2E confirmaram os cenários de adulteração, múltiplos itens, custo adicional e resolução posterior.

## Pendências e registros avulsos

A Home apresenta contagens separadas de clientes avulsos, mercadorias avulsas e vendas sem custo, com acesso a `/app/pendencias`. Cada pendência leva ao cadastro correspondente. Antes de vincular um cliente provisório a outro, a tela mostra quantos negócios e empréstimos serão transferidos e o valor a receber. Os fluxos de consolidação de cliente e item foram exercitados em E2E, preservando dívidas, pagamentos e lucro. O limite atual das listagens é de 500 registros; a paginação deve ser ampliada antes de contas acima desse volume.

## Empréstimos, contratos e PDF

Há uma prévia do instrumento contratual no empréstimo. A emissão exige nome, documento no formato CPF/CNPJ e endereço de credor e devedor; dados ausentes são pedidos na tela, sem preenchimento fictício. A RPC `issue_loan_document` armazena snapshots financeiro, de partes e de termos, preserva versões anteriores e é idempotente quando os dados não mudaram. O PDF é gerado no servidor em A4, com paginação e espaço para assinaturas. Não há assinatura eletrônica integrada nem alegação de validade jurídica absoluta. Os cálculos de juros, arredondamento, fevereiro e dia 31 já têm testes locais; a RPC rejeita totais e parcelas adulterados.

## Billing, assinatura e trial

O trial Pro dura sete dias. Ao terminar, a conta passa ao Free permanente: até 10 clientes (inclusive avulsos) e 20 comandos de voz por mês. O Pro custa R$ 24,50/mês, permite clientes ilimitados e tem guarda de 1.000 comandos de voz por mês. O banco faz o controle de clientes e voz; a conta mostra consumo e o caminho de upgrade. O adaptador Asaas cria checkout hospedado recorrente por cartão, persiste a tentativa, autentica webhooks com o token Asaas e aplica eventos financeiros idempotentes. Checkout pago ou redirect não ativam o Pro sem `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`. A rota de cancelamento desativa novas cobranças no Asaas e mantém acesso até o fim do período já pago; a reativação durante esse período religa a recorrência. A chave de sandbox em `.env.local` autenticou via GET (HTTP 200). A primeira tentativa real de checkout revelou que `customerData` parcial causa HTTP 400; o adaptador foi corrigido para deixar o checkout hospedado coletar os dados completos do pagador. O webhook sandbox está ativo, com URL HTTPS pública e os eventos esperados. Uma divergência entre o token do Asaas e o deployment produziu HTTP 401 e penalizou a fila sequencial. O token foi alinhado nos dois serviços, a `main` foi redeployada, o endpoint aceitou o token (HTTP 200) e a penalização foi removida (HTTP 204). O teste autenticado criou checkout pelo app (HTTP 200), redirecionou para `sandbox.asaas.com`, persistiu a sessão, cancelou o checkout (HTTP 200) e confirmou `checkout.canceled` processado para a conta de teste. Um checkout órfão da primeira tentativa interrompida também foi identificado com segurança e cancelado (HTTP 200). Nenhum pagamento foi realizado. O adaptador envia `User-Agent`, exigido pela documentação atual do Asaas.

## Onboarding, Home e PWA

A Home prioriza voz e atalhos operacionais antes do resumo e das pendências. Um cartão contextual de até três passos acompanha primeira mercadoria, cliente e venda e pode ser pulado. A PWA tem manifest, ícones 192/512, modo standalone, theme color, safe area e service worker. O cache guarda somente arquivos públicos de instalação e a página offline; não guarda respostas financeiras. A interface avisa quando a conexão cai e não sugere que uma operação offline foi salva.

## Segurança e performance

- `npm run db:audit` passou em modo estrito após as migrations Free/Pro. Security Advisor: quatro avisos de RPC `SECURITY DEFINER` executáveis por autenticados; `issue_loan_document` e `consume_voice_rate_limit` verificam `auth.uid()`, e os grants continuam restritos. Duas tabelas com RLS e sem policy (`ai_telemetry`, `billing_events`) são acessadas apenas pelo servidor; `voice_rate_limits` agora tem policy de leitura do próprio usuário para mostrar a cota. A proteção contra senhas vazadas permanece desativada e exige ação no painel Supabase.
- Performance Advisor: 17 índices marcados como não usados em uma base ainda pequena. Não foram removidos sem evidência de carga. Home usa consultas paralelas; listagens têm limite de 500 registros e devem receber paginação quando necessário.

## Testes e build

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | Passou após a integração Free/Pro |
| `npm run test` | Passou antes da integração Free/Pro; depois dela, `test:unit`, E2E e build passaram separadamente. O benchmark de regras anterior teve 400/400 e 0 execução insegura |
| `npm run build` | Passou após a integração Free/Pro no Next.js 16.3.6 |
| `npm run test:unit` | Passou após a integração; inclui contrato Asaas simulado, fallback Free, CTA estruturado e bloqueio de ativação por checkout |
| `node scripts/check_asaas_sandbox.mjs` | Chave de sandbox aceita (HTTP 200); token local preenchido |
| `npx tsx scripts/smoke_asaas_checkout.ts --confirm-sandbox` | Checkout real no sandbox criado e cancelado (HTTP 200) após o redeploy; `checkout.created` e `checkout.canceled` processados no Supabase |
| Webhook público `/api/webhooks/payment` | Token inválido: HTTP 401; evento inofensivo com token local: HTTP 200, `applied=false` |
| `npx tsx scripts/smoke_live_checkout.ts --confirm-sandbox` | Botão do app: HTTP 200, redirecionamento HTTPS para o Asaas Sandbox, sessão persistida, cancelamento HTTP 200 e webhook de cancelamento processado; conta descartável limpa |
| Checkout público `/api/billing/checkout` | POST sem sessão: HTTP 401, `unauthenticated`; POST autenticado pelo botão: HTTP 200 |
| `node scripts/check_free_pro_migrations.mjs` | Passou com rollback: catálogo, Free 10/11 clientes, voz 20/21, Pro acima do limite e downgrade |
| `npm run test:security` | 20/20 passaram contra Supabase real |
| `npm run test:e2e` | Passou após as migrations: multiturno 9/9, finanças 10/10, Free/Pro/Asaas 15/15, autenticação 3/3, módulos 18/18 e segurança 20/20. A suíte Free/Pro/Asaas foi repetida após a correção do checkout e passou 15/15 |
| `npm run db:audit` | Passou em modo estrito, com avisos documentados acima |
| `npm run test:benchmark:rules` | Passou separadamente: 400/400, 0 execução insegura |
| `npm run test:benchmark:llm -- --sample=100` | Aprovado: 98% de acurácia completa, 0 execução insegura; 2 cenários falharam sem execução perigosa |
| `npm run test:ui` | 15/15 passaram após as migrations em 360, 390, 430, 768, 1024 e 1440 px; inclui fluxos clicáveis e aviso offline |

## Vercel e ações manuais

O projeto Vercel `figocrm` foi redeployado em Production a partir da `main` (`591ee2c`), deployment `dpl_EQJFwnhszByPpEVdZ7nY6u1WATUy`, estado `READY`, alias `https://figocrm-navy.vercel.app`. A comparação segura confirmou em Production `BILLING_PROVIDER=asaas`, URL e chave de sandbox, token de webhook igual ao da `.env.local` e `NEXT_PUBLIC_APP_URL` com essa origem HTTPS. Nenhuma chave Asaas de produção foi usada. O token local diferia do valor do deployment anterior; por isso `ASAAS_WEBHOOK_TOKEN` foi atualizado novamente e a `main` redeployada. As demais variáveis foram preservadas. Verificar domínio final e Deployment Protection antes de convidar clientes.

**Efeito na variável Preview:** `ASAAS_WEBHOOK_TOKEN` é um registro Vercel compartilhado entre Preview e Production; a CLI atualizou o valor nos dois ambientes, embora o comando tenha especificado `production`. Nenhuma outra variável foi modificada. O valor antigo de Preview não foi recuperável pelo comando de snapshot do deployment anterior. O usuário orientou usar a `.env.local` e fazer funcionar; Preview permaneceu com o token sandbox atual. Essa alteração adicional foi comunicada.

Responsável pelo produto: confirmar a entrega de um pagamento sandbox real até a ativação do Pro, incluindo posterior cancelamento, reativação e renovação; ativar Leaked Password Protection no Supabase; confirmar a rotação da chave OpenAI; definir o domínio final e retirar Deployment Protection quando o beta for aberto. A revisão automática também rejeitou a exclusão de duas contas descartáveis `e2e-ui` criadas em testes interrompidos; a exclusão depende de autorização específica.

## Bloqueios para beta público

1. Validar pagamento sandbox, ativação Pro, cancelamento e reativação de assinatura e renovação reais. O checkout autenticado e o webhook de cancelamento já passaram. A reativação só é oferecida durante o período pago; após esse prazo, um novo checkout inicia outra assinatura.
2. Concluir as ações manuais de segurança e acesso citadas acima.
