# Relatório de launch hardening — FigoCRM

Data: 26/09/2026. **Classificação atual: ainda não pronto para beta público (`BLOCKER > 0`).** Este relatório distingue código local, banco já alterado e produção publicada. Não trate build local como publicação.

## HEAD, commits e entrega

- Base de trabalho: `main` no commit `c8e28f9`. Branch de entrega local: `launch/hardening-final-20260926`. O SHA do commit de entrega, PR, CI e deployment devem ser consultados no GitHub após a publicação da branch.
- O deployment de produção `dpl_DxKF1UJEEcUBVkD7KUNPs9JePRoM` está `READY` e serve `c8e28f9` em `crm.figosoftwares.com.br` e `figocrm-navy.vercel.app`. A página inicial respondeu HTTP 200 em 26/09. Esse deployment **não contém** as novas rotas e correções.
- Vercel Runtime Errors: nenhuma ocorrência agregada nas últimas 24 horas no momento da consulta. Isso não comprova ausência de erros anteriores ou de caminhos pouco usados.

## Estado por frente

| Frente | Evidência/estado | Classe |
| --- | --- | --- |
| Sessão/auth | Proxy agora verifica `error` retornado por `getUser`, remove apenas cookies de sessão em falha definitiva e preserva sessão em falha de rede. Testes de regra e E2E de rotas passaram; falta smoke de refresh revogado/expirado em navegador real e deploy. | BLOCKER |
| Webhooks órfãos | Política de 24 horas com correlação por checkout, assinatura, customer e external reference. 7 eventos históricos confirmados sem vínculo receberam `processed_at` e `terminal_ignored:subscription_not_found`; nova leitura encontrou 0 elegíveis. Eventos conflitantes não são fechados. | Feito |
| Billing e Asaas | `billing:report` das últimas 24h: 1 webhook processado, 0 falhas, 0 `payment_plan_mismatch`, 0 checkout pago sem ativação. `billing:reconcile:asaas`: 1 assinatura comparada, 0 divergências. Falta smoke real pós deploy e alerta agendado para 5xx/billing indisponível. | BLOCKER |
| Observabilidade | JSON estruturado para erro e duplicação de webhook, snapshot operacional e código de saída 2 para mismatch/checkout sem ativação. Entregas duplicadas não persistem contagem no banco; acompanhar Runtime Logs. Alertas automáticos ainda não configurados. | IMPORTANTE |
| CI | `.github/workflows/ci.yml` com lint, typecheck, unit, benchmark de regras e build no PR/main; security em `main` com environment `ci`; E2E manual. Falta criar secrets do environment, abrir PR e observar checks verdes. | BLOCKER |
| Proteção da main | Ainda sem confirmação de regras obrigatórias de PR/checks, bloqueio de force push e delete. O conector GitHub disponível não expõe branch protection. | BLOCKER |
| Supabase security | Auditoria SQL real: todas as tabelas com RLS; novas `account_closure_requests` e `feedback_reports` com policies restritas. `ai_telemetry` e `billing_events` sem policies e sem acesso direto de `anon`/`authenticated` por intenção. Quatro funções `SECURITY DEFINER` seguem com `search_path`, `auth.uid()`, checagem de ownership pertinente e sem `PUBLIC`/`anon`; acesso `authenticated` é necessário aos fluxos atuais. Advisor oficial e Leaked Password Protection não puderam ser verificados pela conexão disponível ao projeto CRM. | BLOCKER |
| Termos e Privacidade | Rascunhos públicos `/termos` e `/privacidade`, links no cadastro e landing, ainda locais. Precisam revisão jurídica e deploy. | BLOCKER |
| Exportação | `/api/account/export` autentica usuário, pagina seções e filtra `user_id`, retornando JSON sem tokens e sem telemetria. E2E HTTP autenticado confirmou isolamento entre contas. Falta smoke após deploy. | BLOCKER |
| Encerramento de conta | Migration aplicada e registrada: pedido com `requested_at`, `status`, `scheduled_for`, `completed_at`; confirmação `ENCERRAR` + senha; cancelamento da renovação quando aplicável. Falha do provedor mantém status pendente para atendimento. E2E HTTP confirmou senha, status e RLS. Exclusão física exige revisão humana de retenção e procedimento posterior. | BLOCKER |
| Suporte e feedback | Página `/suporte`, atalho e formulário na Conta; tabela de relatos com RLS e índice aplicada. E-mail/WhatsApp oficiais ainda não informados/configurados. | BLOCKER |
| Health, versão, erros | `/api/health`, commit na Conta, 404 e error boundary globais implementados localmente. Falta smoke HTTP pós deploy. | BLOCKER |
| PWA | Suite unitária existente valida manifest, ícones e cache público; suíte de interface validou estado offline e responsividade em 360 a 1440 px. Instalação Android/desktop, standalone e safe areas exigem smoke em dispositivo/navegador. | IMPORTANTE |
| Voz/IA | E2E com LLM real validou venda, recebimento, ambiguidade e consultas no banco de teste. Benchmark real de 100 cenários aprovou com 98% de acerto completo e 0% de execução insegura; duas falhas de interpretação de recebimento ficaram registradas. Smoke no deployment novo ainda pendente. | IMPORTANTE |
| UX de erros e rate limit | Erros públicos novos retornam texto amigável; rotas de voz têm rate limit distribuído; checkout limita sessão ativa e evita cobrança duplicada. Revisão completa dos códigos técnicos legados e limites de login/reset/billing ainda pendente. | IMPORTANTE |
| Dependências | `@supabase/supabase-js` atualizado para 2.117.2 e lockfile atualizado; `npm audit` passou com 0 vulnerabilidades. Majors e `@supabase/ssr` não atualizados sem necessidade comprovada. | Feito |
| Performance/listagens | Sem medição autenticada de TTFB/queries lentas nesta execução. Limite fixo de 500 em algumas listagens permanece; monitorar volume real e implementar paginação antes de contas nessa escala. | IMPORTANTE |
| Backup/recovery | Procedimento registrado em `docs/operations/runbook.md`. A existência e o teste de restore/PITR do projeto ainda precisam confirmação no painel Supabase. | BLOCKER |
| Freeze | A partir deste ciclo, somente bug fix, segurança, billing, UX crítica e performance medida antes do beta. | Feito |

## Testes, migrations e produção

- Migrações `20260926151552_account_closure_feedback` e `20260926154510_feedback_user_index` aplicadas em transações específicas e registradas em `supabase_migrations.schema_migrations`. Auditoria SQL após ambas passou; restam 4 warnings de `SECURITY DEFINER` intencionais e 2 informações de tabelas server-only sem policy, sem novo warning de índice.
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:security` (20/20), `npm run test:e2e` (9/9, 10/10, 18/18, 3/3, 18/18, 20/20), `npm run test:benchmark:rules`, `npm run test:launch:e2e` (4/4), `npm run test:ui` (15/15) e build local passaram. A primeira execução visual identificou alvos pequenos na Conta; corrigidos e aprovados na repetição. O benchmark LLM de 100 amostras aprovou (98% acerto completo, 0% execução insegura, p95 3143 ms, custo estimado US$ 0,295). `npm audit`: 0 vulnerabilidades.
- `npm run billing:report` e `npm run billing:reconcile:asaas` são somente leitura. `billing:reconcile:orphans -- --apply` foi usado somente após dry run de 7 candidatos e confirmado por dry run posterior de 0.
- Security Advisor e Performance Advisor oficiais do projeto `crm` não estavam acessíveis pelo conector Supabase desta sessão (a conta conectada lista apenas outro projeto). A auditoria SQL local não substitui o Advisor oficial.

## Bloqueios antes do beta público

1. Publicar o código por PR com CI verde e configurar proteção da `main`. O job `security` precisa dos quatro secrets `CI_SUPABASE_URL`, `CI_SUPABASE_ANON_KEY`, `CI_SUPABASE_SERVICE_ROLE_KEY` e `CI_DATABASE_URL` em environment `ci` isolado.
2. Configurar contato oficial de suporte (`NEXT_PUBLIC_SUPPORT_EMAIL` e opcional WhatsApp), revisar juridicamente Termos/Privacidade e publicar.
3. No painel Supabase do projeto `crm`, revisar Security/Performance Advisor, ativar Leaked Password Protection, confirmar senha mínima ≥ 8 e validar backup/restauração.
4. No deploy novo, verificar health, login, logout, reset, exportação, pedido de encerramento, feedback, 404, voz, PWA e um ciclo de cobrança controlado sem repetir cobranças desnecessárias.
5. Configurar execução/alerta operacional para divergência de plano, checkout pago sem ativação, 5xx consecutivos no webhook e `billing_unavailable` recorrente.

## Pendências após lançamento controlado

- Paginação e busca no servidor nas listagens à medida que contas se aproximarem do limite atual de 500 registros; medir antes de otimizar.
- Contagem persistente de entregas duplicadas e painel interno de billing, se o volume justificar.
- Automatizar a etapa final de exclusão/anonimização depois de definir retenção com orientação jurídica e operacional.
- Medir TTFB e consultas autenticadas das cinco telas principais com dados representativos; validar instalação PWA em Android e desktop.
