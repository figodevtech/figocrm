# Runbook de incidentes — FigoCRM

Última revisão: 27/09/2026. Ação inicial em qualquer incidente: registrar horário, rota, commit (`/api/health`), usuários afetados e identificadores do evento sem copiar tokens, senhas ou dados de cartão. Preserve o histórico financeiro.

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

Decisão de produto: o projeto CRM `wjtsxomfezrqwdnnxcuh` permanece no Supabase **Free**. Backups diários gerenciados e PITR não estão contratados. **O backup externo de produção ainda não está configurado nem ativo; o responsável aceitou esse risco operacional para o beta.** O workflow `database-backup.yml` está pronto para executar diariamente às 03:20 UTC: `pg_dump` PostgreSQL 17 em formato custom comprimido, GPG AES-256, upload apenas de `.dump.gpg` para bucket privado do Cloudflare R2, conferência de tamanho e retenção dos sete dias UTC mais recentes. `workflow_dispatch` permite execução controlada. A ausência de qualquer uma das seis credenciais gera aviso `External backup not configured — accepted beta risk` e pula os passos externos com sucesso; com todas presentes, uma falha real continua vermelha. O CI comprovou dump/restore local descartável dos schemas `auth` e `public`; **isso não comprova recuperação de um backup R2 de produção**. A [documentação oficial do Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) descreve particularidades de restaurar Auth e Storage em outro projeto.

### BACKUP — criação e operação

1. Criar bucket R2 `figocrm-backups` (ou nome registrado), **privado**, sem domínio público nem acesso `r2.dev`. Criar token R2 restrito a esse bucket. No GitHub Environment `backup`, configurar somente secrets `BACKUP_DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP_ENCRYPTION_KEY`. A URL do banco deve usar conexão direta acessível ao runner ou session pooler porta 5432; nunca o pooler transacional. Manter cópia da frase aleatória de criptografia (pelo menos 32 caracteres) em cofre seguro independente do GitHub.
2. Disparar `Database backup` manualmente após configurar. Confirmar workflow verde, `backup_uploaded`, objeto `.dump.gpg` no bucket privado com tamanho não zero e nenhuma cópia `.dump`/`.sql` no R2. A cópia em claro existe apenas no runner e é removida no `trap` mesmo em falha. Registrar horário UTC, chave do objeto, tamanho e responsável.
3. `Backup health` roda a cada seis horas. Sem as seis credenciais, emite o mesmo aviso de risco aceito e não consulta R2. Com a configuração completa, falha se não houver objeto reconhecido de tamanho positivo criado nas últimas 36 horas. A falha dos workflows precisa ter notificações do GitHub Actions ativas para o responsável; testar recebimento do alerta. O arquivo mais novo não é apagado antes da confirmação de upload/tamanho do substituto.

### BACKUP — falha

Com as seis credenciais configuradas, quando `pg_dump`, GPG, upload, verificação ou retenção falhar, o workflow termina vermelho. Consultar a etapa, corrigir conectividade/credencial/quota e repetir `workflow_dispatch`; não apagar a cópia anterior. Se `Backup health` indicar idade acima de 36 horas, tratar como incidente operacional e confirmar a entrega do alerta ao responsável. Sem configuração completa, o workflow verde com aviso significa **ausência de backup**, não saúde de recuperação. Jamais anexar dump ou chave a issue, log, GitHub Release ou pasta pública.

### RESTORE — procedimento e drill

1. Identificar o objeto íntegro anterior ao incidente. Interromper escritas, se necessário, e registrar o último estado financeiro confiável. Para o drill, iniciar **Supabase/Postgres descartável** com a mesma versão e extensões/migrations. `scripts/restore_backup_test.sh` exige `RESTORE_DATABASE_URL` em `localhost`/`127.0.0.1`/`::1`; recusa destino remoto. Nunca apontar para produção.
2. Com as credenciais R2 e a frase de criptografia carregadas somente no ambiente local seguro, executar `bash scripts/restore_backup_test.sh database/figocrm-YYYYMMDDTHHMMSSZ.dump.gpg`. O script baixa, descriptografa, valida a estrutura do arquivo custom, restaura em transação e verifica as 12 tabelas essenciais, contagens e FKs validadas. O banco de destino deve ser descartável e não conter dados a preservar, pois `pg_restore --clean` substitui objetos.
3. Fazer smoke de login, clientes e financeiro no ambiente restaurado, sem cobrar no Asaas. Comparar contagens com a origem/relatórios de backup e verificar migrations, Auth e vínculo entre registros. Registrar objeto, horário, duração, contagens, resultado do restore e do smoke. Só declarar `Restore drill: PASS` após uma execução real completa.
4. Em recuperação de incidente, restaurar primeiro em ambiente separado, investigar diferença de dados financeiros e Storage, preparar corte de tráfego e reabrir escritas somente após smoke e aprovação do responsável. Nunca restaurar diretamente em produção durante diagnóstico. Migrations são progressivas; preparar migration compensatória testada se necessário.

O job `security` do CI executa `scripts/restore_backup_ci.sh`: cria fixture descartável, faz dump de `auth` e `public`, restaura em segundo banco local vazio e roda `restore_validation.sql`. Esse teste valida o mecanismo e as 12 tabelas essenciais, mas não inclui download R2, os schemas internos gerenciados do Supabase nem objetos de Storage.

### R2 — recuperação, chaves e escopo

- Se perder `BACKUP_ENCRYPTION_KEY`, os backups existentes serão irrecuperáveis. Procurar a cópia do cofre independente; se não existir, registrar perda de capacidade de recuperação e criar nova chave/novo backup imediatamente. Não apagar arquivos antigos até decisão explícita.
- Para rotação, criar token R2 novo restrito ao bucket, atualizar secrets, executar backup e drill, então revogar o token anterior. Para trocar a frase GPG, guardar também a versão antiga enquanto houver arquivos criptografados por ela nos sete dias de retenção; testar restore da primeira cópia com a nova frase antes de descartá-la.
- **Database:** backup lógico externo implementado, ainda não configurado nem ativo. **Storage:** fora do escopo do backup V1. O dump proposto inclui metadados do Storage, não bytes dos objetos. A perda de fotos não regeneráveis também integra o risco aceito para o beta; definir cópia separada no pós-lançamento. PDFs regeneráveis a partir do snapshot não são fonte primária. Nenhum backup pode ser disponibilizado ao usuário do aplicativo.

## Ritmo operacional

- Verificar `billing:report` ao menos diariamente no beta e imediatamente após incidentes de checkout. Alertar se `payment_plan_mismatch > 0`, checkout pago sem ativação > 5 minutos, 5xx consecutivos do webhook ou `billing_unavailable` recorrente. O script emite JSON estruturado e código 2 para os dois primeiros; os outros dois exigem monitoramento dos Runtime Logs.
- Revisar pedidos em `account_closure_requests` com status `pending_cancellation`, depois os agendados antes de qualquer exclusão. Documentar base e prazo de retenção caso a caso.
- Fazer smoke de login, cliente, item, venda, recebimento, empréstimo/PDF, voz, cancelamento e suporte após cada deploy de produção. Pagamento real deve usar uma conta controlada e não ser repetido em cada PR.
