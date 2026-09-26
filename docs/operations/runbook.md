# Runbook de incidentes — FigoCRM

Última revisão: 26/09/2026. Ação inicial em qualquer incidente: registrar horário, rota, commit (`/api/health`), usuários afetados e identificadores do evento sem copiar tokens, senhas ou dados de cartão. Preserve o histórico financeiro.

## Verificações rápidas

- `/api/health`: `status`, banco e configuração do billing. Uma falha aqui exige checar Vercel Runtime Logs e Supabase antes de repetir mutações.
- `npm run billing:report`: resumo das últimas 24 horas. Código 2 indica `payment_plan_mismatch` ou checkout pago sem ativação após 5 minutos. Execute somente em ambiente administrativo com service role.
- `npm run billing:reconcile:orphans`: relatório de eventos com `subscription_not_found` há mais de 24 horas. `-- --apply` fecha somente eventos sem nenhum vínculo encontrado. Revise o resumo antes de aplicar.
- Consulte `billing_events` por `provider,event_id`; nunca reenvie payload não autenticado à rota pública.

## Asaas não entregou webhook

**Identificar:** checkout pago no Asaas, sem `billing_events` correspondente; conferir ID do pagamento e período. **Onde olhar:** painel Asaas, configuração do webhook e Runtime Logs de `/api/webhooks/payment`. **Mitigar:** corrigir token/URL ou indisponibilidade e solicitar reentrega do evento original pelo painel; conferir a ativação em `subscriptions`. **Não fazer:** ativar assinatura só com comprovante ou payload copiado, nem criar um segundo checkout.

## Pagamento confirmado sem ativação

**Identificar:** `billing:report` aponta checkout pago sem plano ativo; `billing_events.error` indica a causa. **Onde olhar:** checkout, IDs de cliente/assinatura, `external_reference`, valor pago, plano escolhido e eventos. **Mitigar:** reconciliar IDs e valor, corrigir a causa e reprocessar o evento autenticado com idempotência. Casos `payment_plan_mismatch` e IDs conflitantes exigem revisão humana. **Não fazer:** mudar preço/plano manualmente para silenciar o alerta.

## Supabase indisponível ou usuário não consegue entrar

**Identificar:** `/api/health` degradado, Auth retorna erro temporário ou crescimento de 5xx. **Onde olhar:** status e logs do Supabase, proxy, cookies e horário da sessão. **Mitigar:** aguardar restauração do serviço e orientar novo login se a sessão foi definitivamente revogada. O proxy preserva cookies em erro de rede e remove cookies da sessão em erros definitivos de refresh. **Não fazer:** limpar sessões por falha de rede nem desativar RLS.

## Vercel com 500

**Identificar:** Runtime Errors por rota e commit, `/api/health`, logs do deployment. **Onde olhar:** deployment `READY` anterior, variáveis de ambiente, funções e banco. **Mitigar:** se a regressão veio do deploy, promover/retornar ao último deployment `READY` conhecido e abrir correção em PR. **Não fazer:** reverter migration que contém dados sem plano de compatibilidade.

## OpenAI indisponível

**Identificar:** erros de voz/IA e telemetria `success=false`; fluxos manuais continuam disponíveis. **Onde olhar:** Runtime Logs de `/api/voice/*` e status do provedor. **Mitigar:** orientar uso dos formulários manuais e retentar quando o serviço normalizar. **Não fazer:** executar comandos financeiros a partir de interpretação parcial ou desativar confirmações.

## Venda duplicada

**Identificar:** comparar operações por usuário, cliente, valor, horário e chave de idempotência. **Onde olhar:** `deals`, `audit_log`, `settlements` e ações de estorno. **Mitigar:** congelar novas tentativas da mesma operação, confirmar qual registro é legítimo e usar o fluxo de desfazer/estorno existente quando aplicável. **Não fazer:** apagar linhas financeiras diretamente do banco.

## Backup e recuperação

Situação verificada em 26/09/2026: o projeto CRM `wjtsxomfezrqwdnnxcuh` está no plano Supabase **Free**. Esse plano não oferece backups diários gerenciados nem PITR; não existe retenção de backup confirmada para este projeto. O beta público continua bloqueado até existir cópia externa periódica e um teste de restauração, ou até a contratação e validação de um plano com backups. A [documentação de backups do Supabase](https://supabase.com/docs/guides/platform/backups) recomenda `supabase db dump` e cópias fora do projeto para o plano Free. O dump do banco não inclui os objetos do Storage, apenas seus metadados.

1. Definir responsável, frequência, retenção e local **privado e criptografado** das cópias. No Free, exportar schema e dados com `supabase db dump` conforme o [procedimento oficial](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), e copiar separadamente os objetos do Storage. Nunca gravar dumps, senhas ou chaves no Git.
2. Antes da abertura, criar um projeto isolado de recuperação, restaurar nele uma cópia recente e registrar data, duração, hash/identificador da cópia e resultado. Confirmar migrations, Auth, objetos de Storage e contagens de `subscriptions`, `deals`, `payments` e `billing_events`; executar smoke de login e financeiro sem cobrar novamente no Asaas.
3. Em incidente de corrupção: registrar o horário e a última operação íntegra; interromper escritas se necessário; escolher o ponto/cópia anterior à corrupção; restaurar primeiro em ambiente isolado; comparar dados financeiros e migrations; planejar corte de tráfego; reabrir escritas somente após smoke e aprovação do responsável. Não restaurar sobre produção durante diagnóstico.
4. Se o projeto for atualizado para Pro ou superior, confirmar no painel `Database > Backups` a janela disponível e testar restauração. Pro oferece 7 dias de backups diários; PITR é adicional e só deve ser considerado contratado após confirmação no painel. Registrar evidências, não apenas a existência do menu.
5. Migrations são progressivas. Para reverter, preparar migration compensatória específica, testar em cópia e preservar dados; jamais editar uma migration já aplicada. Para rollback de deploy, usar o último deployment de produção `READY` compatível com o schema atual e registrar SHA, ID e horário.

## Ritmo operacional

- Verificar `billing:report` ao menos diariamente no beta e imediatamente após incidentes de checkout. Alertar se `payment_plan_mismatch > 0`, checkout pago sem ativação > 5 minutos, 5xx consecutivos do webhook ou `billing_unavailable` recorrente. O script emite JSON estruturado e código 2 para os dois primeiros; os outros dois exigem monitoramento dos Runtime Logs.
- Revisar pedidos em `account_closure_requests` com status `pending_cancellation`, depois os agendados antes de qualquer exclusão. Documentar base e prazo de retenção caso a caso.
- Fazer smoke de login, cliente, item, venda, recebimento, empréstimo/PDF, voz, cancelamento e suporte após cada deploy de produção. Pagamento real deve usar uma conta controlada e não ser repetido em cada PR.
