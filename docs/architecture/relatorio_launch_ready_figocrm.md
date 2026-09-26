# NOT LAUNCH READY

**BLOCKER = 6** · Revisão de 26/09/2026. O beta público continua fechado. O código de hardening já está publicado; os bloqueios restantes dependem de configuração, operação ou informação do responsável.

## Estado publicado e entrega

| Item | Evidência | Classe |
| --- | --- | --- |
| Aplicação verificada em produção em 26/09 | [PR #2](https://github.com/figodevtech/figocrm/pull/2) mesclada via squash em `eba8b5c56e0be0b63403b7cf23f6e0fa11bb8dbd`; Vercel `dpl_2pgqCMraNJ2hS8BxnBpBSxRj5Shp` em `READY`. `/api/health` no domínio oficial retornou `status: ok`, `version: eba8b5c5`, `database: ok`, `billing: configured`. A versão atual após commits posteriores deve ser conferida em `/api/health`. | FEITO |
| CI da `main` | [Execução 36263278720](https://github.com/figodevtech/figocrm/actions/runs/36263278720): `checks`, `security` e `final-gate` passaram. O job de segurança iniciou Supabase descartável, aplicou migrations e usou credenciais geradas no próprio runner. | FEITO |
| Proteção da `main` | API do GitHub confirmou PR obrigatória, `final-gate` como único check obrigatório com branch atualizada, administradores incluídos, force push e exclusão bloqueados. Como há um único colaborador, a opção B do pedido foi aplicada: 0 aprovações obrigatórias até existir segundo revisor. | FEITO |
| Node | CI em Node 24 nos três jobs; `package.json` e lockfile declaram `24.x`, compatível com a versão suportada pela Vercel. | FEITO |

## Verificações técnicas

| Item | Resultado | Classe |
| --- | --- | --- |
| Supabase | Projeto CRM `wjtsxomfezrqwdnnxcuh`; migrations remotas alinhadas até `20260926154510_feedback_user_index`. O Security Advisor oficial mostrou dois `INFO` de tabelas server-only sem policy (`ai_telemetry`, `billing_events`), quatro `WARN` de RPCs `SECURITY DEFINER` intencionais e `WARN` de Leaked Password Protection desativada. O Performance Advisor mostrou 17 `INFO` de índices ainda não usados, sem warning crítico. | IMPORTANTE |
| RPCs privilegiadas | `consume_voice_rate_limit`, `issue_loan_document`, `merge_provisional_customer` e `record_ai_telemetry` têm `search_path=public, pg_temp`, owner `postgres`, `anon` sem EXECUTE, `authenticated` com EXECUTE e verificam `auth.uid()`. A primeira precisa gravar contadores sem acesso direto à tabela; a segunda emite snapshot de contrato de empréstimo do próprio usuário; a terceira atualiza vínculos em tabelas de escrita restrita após conferir origem/destino; a quarta grava telemetria sem acesso direto. Não mudar apenas para silenciar o Advisor. | FEITO |
| Billing | Consulta read-only no banco em 26/09: `unprocessed=0`, `payment_plan_mismatch=0`, `terminal_ignored=7` históricos. `billing:report`: 1 webhook processado, 0 falhas, 0 mismatch e 0 checkout pago sem ativação nas últimas 24 h. `billing:reconcile:asaas`: 1 assinatura comparada, 0 achados. Não houve nova cobrança de teste. | FEITO |
| Vercel Runtime Errors | Consulta oficial após o deploy novo: nenhuma ocorrência nova em `dpl_2pgqCMraNJ2hS8BxnBpBSxRj5Shp`. Uma ocorrência isolada `[stt] Whisper HTTP 400` permanece na janela de 1 h, gerada pelo teste controlado de áudio inválido no deployment anterior; a rota retornou 200 com fallback e telemetria de sucesso. | FEITO |
| Testes locais | `lint`, `typecheck`, `test:unit`, `test:benchmark:rules` e `build` passaram. Benchmark LLM real de 100 cenários passou, com p95 de 4691 ms e custo estimado de US$ 0,2951. `npm audit --audit-level=high`: 0 vulnerabilidades. `npm outdated` foi revisado, sem atualização de majors neste ciclo. | FEITO |
| Smoke HTTP de produção | `test:launch:e2e` no domínio oficial após a publicação: 4/4. Confirmou páginas/health, bloqueio sem sessão, exportação isolada, feedback e encerramento com usuários descartáveis. `/termos`, `/privacidade` e `/suporte` responderam HTTP 200. | FEITO |
| UI e voz | `test:ui` pós-deploy no domínio oficial: 12/12 em 390 px, incluindo logout/login e cookie inválido removido sem loop. A suíte completa anterior passou 15/15 nos tamanhos de 360 a 1440 px. `test:smoke` de voz/IA em produção: 8/8, incluindo diálogo financeiro, áudio real via Whisper, rate limit e telemetria. | FEITO |
| E2E completo | `npm run test:e2e` passou integralmente contra Supabase local descartável com LLM real (9/9, 10/10, 18/18, 3/3, 18/18 e 20/20). O helper de SSL foi corrigido para desativar SSL só em `127.0.0.1`/`localhost`. [Execução manual do GitHub 36261431058](https://github.com/figodevtech/figocrm/actions/runs/36261431058): `checks`, `security` e `final-gate` passaram, mas `e2e` falhou por falta de chave de LLM no environment `ci`. A revisão automática bloqueou exportar a chave local ao GitHub sem autorização específica; nenhuma chave foi enviada. | BLOCKER |

## Bloqueios objetivos

1. **BLOCKER — senha vazada:** o Advisor confirma Leaked Password Protection desativada. O projeto está no plano Supabase Free; a [função requer Pro ou superior](https://supabase.com/docs/guides/auth/password-security). É necessária decisão de plano/custo e, depois, habilitação e teste de senha comprometida. Confirmar também no Auth remoto mínimo de 8 caracteres; o ambiente descartável do CI já usa 8.
2. **BLOCKER — suporte:** não foi confirmado e-mail oficial nem WhatsApp autorizado. `/suporte` usa `NEXT_PUBLIC_SUPPORT_EMAIL` e opcionalmente `NEXT_PUBLIC_SUPPORT_WHATSAPP`, mas ainda mostra aviso de canais futuros quando ambos faltam. Não publicar contato presumido. O formulário interno de feedback permanece acessível pela Conta.
3. **BLOCKER — documentos legais:** Termos e Privacidade ainda trazem aviso de revisão jurídica. As páginas usam versão `26/09/2026`; remover o aviso apenas após confirmação do responsável sobre conteúdo final, entidade e contato, sem inventar CNPJ, endereço ou DPO.
4. **BLOCKER — recuperação:** o plano Supabase Free não oferece backup diário gerenciado nem PITR. Não há exportação periódica externa ou teste de restore comprovado. O [runbook](../operations/runbook.md) contém o procedimento e exige restauração isolada antes do beta.
5. **BLOCKER — alertas:** há scripts read-only de billing e logs estruturados, mas não há execução/entrega de alertas comprovada para mismatch, checkout pago sem ativação, 5xx recorrente no webhook ou `billing_unavailable` recorrente. Definir canal operacional e executar teste de alerta apenas com evento controlado.
6. **BLOCKER — E2E manual do GitHub:** fornecer uma chave de IA própria do environment `ci` ou autorizar explicitamente o uso da chave local como secret criptografado desse environment; então repetir o workflow manual. O E2E completo já passou em Supabase local isolado. Não repetir pagamento real sem necessidade.

## Procedimento para encerrar os bloqueios

- Ativar o plano/serviço de proteção de senhas e recuperação após validar custo; registrar evidência do Auth, retenção e restore. A alternativa no Free exige dump periódico externo e restauração verificada, mas não entrega Leaked Password Protection.
- Receber contato oficial e validação jurídica do responsável; configurar variáveis da Vercel, revisar conteúdo e então publicar.
- Repetir o E2E manual do GitHub com a chave autorizada, mantendo banco descartável; conferir `main`, produção e Runtime Logs após qualquer nova publicação.
- Configurar um canal de alerta operacional com teste de entrega; manter reconciliação Asaas read-only como padrão e investigar divergências antes de qualquer correção.

## Pós-lançamento

**PÓS-LANÇAMENTO:** paginação antes de contas com grande volume, painel avançado de observabilidade, BI, contagem persistente de webhook duplicado e novos modelos de IA. Nenhum módulo novo foi criado neste ciclo.
