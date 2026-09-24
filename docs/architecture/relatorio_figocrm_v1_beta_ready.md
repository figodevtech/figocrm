# Fechamento do FigoCRM V1 para beta — 24/09/2026

## Resumo e estado

O núcleo financeiro e os fluxos de registros avulsos e contratos documentais foram fechados e verificados contra o Supabase real. A decisão comercial posterior do usuário definiu **Asaas, Free permanente e Pro a R$ 24,50/mês**. A integração Free/Pro está implementada; todas as 21 migrations locais constam como aplicadas no Supabase `crm`, e testes unitários, E2E, visuais e build passaram. A chave Asaas sandbox autenticou, e um checkout recorrente de teste foi criado e cancelado. **Esta entrega ainda não deve ser declarada beta público:** o endpoint de webhook publicado respondeu HTTP 503 e falta validar um pagamento e seu evento financeiro ponta a ponta.

## Código, commits e migrations

- Em 24/09/2026, `HEAD` e `origin/main` apontavam para `a4bcfec`; as correções deste diagnóstico estão no workspace. A instrução posterior do usuário escolheu Asaas com Free/Pro; ela prevalece sobre o preço anterior do prompt.
- Aplicadas no projeto Supabase `crm` (`wjtsxomfezrqwdnnxcuh`): `20260924113532_derive_deal_profit_from_cmv.sql` e `20260924114640_loan_document_snapshots.sql`.
- Aplicadas no projeto `crm` após autorização explícita: `20260924131613_free_pro_entitlements.sql`, `20260924131911_voice_plan_quota.sql` e `20260924132517_asaas_billing_support.sql`, em transação única pelo executor limitado `scripts/apply_free_pro_migrations.mjs`. Antes disso, a revisão automática rejeitou o executor genérico `scripts/apply_migrations.mjs` por potencialmente aplicar todas as migrations pendentes sem autorização; nenhum outro arquivo foi aplicado por esse caminho.

## Integridade financeira e CMV

O PostgreSQL calcula `recognized_profit = total_value - CMV` usando todos os itens `OUT`. O CMV inclui `acquisition_cost` e os custos adicionais de `item_costs`. Triggers recalculam o lucro quando itens ou custos mudam. Se houver custo pendente, `profit_pending = true` e lucro reconhecido zero até a resolução. O banco ignora o lucro enviado pelo payload; permissões impedem alteração direta de preço, itens e custos históricos. O teste de rollback `scripts/check_beta_migrations.mjs` e os E2E confirmaram os cenários de adulteração, múltiplos itens, custo adicional e resolução posterior.

## Pendências e registros avulsos

A Home apresenta contagens separadas de clientes avulsos, mercadorias avulsas e vendas sem custo, com acesso a `/app/pendencias`. Cada pendência leva ao cadastro correspondente. Antes de vincular um cliente provisório a outro, a tela mostra quantos negócios e empréstimos serão transferidos e o valor a receber. Os fluxos de consolidação de cliente e item foram exercitados em E2E, preservando dívidas, pagamentos e lucro. O limite atual das listagens é de 500 registros; a paginação deve ser ampliada antes de contas acima desse volume.

## Empréstimos, contratos e PDF

Há uma prévia do instrumento contratual no empréstimo. A emissão exige nome, documento no formato CPF/CNPJ e endereço de credor e devedor; dados ausentes são pedidos na tela, sem preenchimento fictício. A RPC `issue_loan_document` armazena snapshots financeiro, de partes e de termos, preserva versões anteriores e é idempotente quando os dados não mudaram. O PDF é gerado no servidor em A4, com paginação e espaço para assinaturas. Não há assinatura eletrônica integrada nem alegação de validade jurídica absoluta. Os cálculos de juros, arredondamento, fevereiro e dia 31 já têm testes locais; a RPC rejeita totais e parcelas adulterados.

## Billing, assinatura e trial

O trial Pro dura sete dias. Ao terminar, a conta passa ao Free permanente: até 10 clientes (inclusive avulsos) e 20 comandos de voz por mês. O Pro custa R$ 24,50/mês, permite clientes ilimitados e tem guarda de 1.000 comandos de voz por mês. O banco faz o controle de clientes e voz; a conta mostra consumo e o caminho de upgrade. O adaptador Asaas cria checkout hospedado recorrente por cartão, persiste a tentativa, autentica webhooks com o token Asaas e aplica eventos financeiros idempotentes. Checkout pago ou redirect não ativam o Pro sem `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`. A rota de cancelamento desativa novas cobranças no Asaas e mantém acesso até o fim do período já pago; a reativação durante esse período religa a recorrência. A chave de sandbox em `.env.local` autenticou via GET (HTTP 200). A primeira tentativa real de checkout revelou que `customerData` parcial causa HTTP 400; o adaptador foi corrigido para deixar o checkout hospedado coletar os dados completos do pagador. Um checkout recorrente real no sandbox foi criado e cancelado (HTTP 200) sem pagamento. O webhook sandbox está ativo, com URL HTTPS pública e todos os eventos esperados, mas o endpoint publicado respondeu HTTP 503 a um teste de token inválido; nenhum evento Asaas apareceu no Supabase durante a verificação. O smoke test agora recusa criar outro checkout enquanto o webhook público não estiver pronto. O adaptador envia `User-Agent`, exigido pela documentação atual do Asaas.

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
| `npx tsx scripts/smoke_asaas_checkout.ts --confirm-sandbox` | Checkout real no sandbox criado e cancelado (HTTP 200) após correção do payload; novo smoke test exige webhook público pronto |
| `node scripts/check_free_pro_migrations.mjs` | Passou com rollback: catálogo, Free 10/11 clientes, voz 20/21, Pro acima do limite e downgrade |
| `npm run test:security` | 20/20 passaram contra Supabase real |
| `npm run test:e2e` | Passou após as migrations: multiturno 9/9, finanças 10/10, Free/Pro/Asaas 15/15, autenticação 3/3, módulos 18/18 e segurança 20/20. A suíte Free/Pro/Asaas foi repetida após a correção do checkout e passou 15/15 |
| `npm run db:audit` | Passou em modo estrito, com avisos documentados acima |
| `npm run test:benchmark:rules` | Passou separadamente: 400/400, 0 execução insegura |
| `npm run test:benchmark:llm -- --sample=100` | Aprovado: 98% de acurácia completa, 0 execução insegura; 2 cenários falharam sem execução perigosa |
| `npm run test:ui` | 15/15 passaram após as migrations em 360, 390, 430, 768, 1024 e 1440 px; inclui fluxos clicáveis e aviso offline |

## Vercel e ações manuais

O deployment de produção Vercel `READY` aponta para `a4bcfec`. Ele ainda não contém a correção local do payload de checkout e do evento de cancelamento sem sessão. O endpoint de webhook cadastrado no Asaas responde HTTP 405 para GET, mas HTTP 503 para POST com token inválido, indicando que o provedor de cobrança não está disponível nesse deployment. É necessário configurar no ambiente Vercel uma chave de sandbox, o mesmo token de webhook e a URL de sandbox, publicar uma revisão e validar o endpoint antes de testar pagamento. Verificar domínio final e Deployment Protection antes de convidar clientes.

Responsável pelo produto: configurar as variáveis de sandbox no deployment Vercel, mantendo a chave de produção fora desse ambiente; usar `NEXT_PUBLIC_APP_URL` HTTPS público para callbacks; confirmar que o token de webhook cadastrado no Asaas corresponde ao configurado no deployment; ativar Leaked Password Protection no Supabase; confirmar a rotação da chave OpenAI; definir o domínio final e retirar Deployment Protection quando o beta for aberto. A revisão automática também rejeitou a exclusão de duas contas descartáveis `e2e-ui` criadas em testes interrompidos; a exclusão depende de autorização específica.

## Bloqueios para beta público

1. Configurar o Asaas sandbox na Vercel e validar pagamento, webhook, cancelamento de assinatura, reativação e renovação reais. A reativação só é oferecida durante o período pago; após esse prazo, um novo checkout inicia outra assinatura.
2. Publicar a correção local do checkout e verificar o novo deployment na Vercel.
3. Concluir as ações manuais de segurança e acesso citadas acima.
