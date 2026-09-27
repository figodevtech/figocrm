# NOT LAUNCH READY

**BLOCKER = 5** na revisão de produção de 27/09/2026. O beta público continua fechado. Supabase Free é decisão de produto, não bloqueador por si só. Cada commit posterior exige nova conferência de deployment, health e Runtime Errors antes do beta.

## Estado publicado e entrega

| Item | Evidência | Classe |
| --- | --- | --- |
| Aplicação verificada em produção em 27/09 | [PR #4](https://github.com/figodevtech/figocrm/pull/4) mesclada via squash em `111f1006400d1063a0c836ac12c5f9198f4fe5b4`; Vercel `dpl_6etdaj8n4uk85HKohAGYm6SztbZq` em `READY`. `/api/health` no domínio oficial retornou `status: ok`, `version: 111f1006`, `database: ok`, `billing: configured`. | FEITO |
| CI da `main` | [Execução 36287197268](https://github.com/figodevtech/figocrm/actions/runs/36287197268): `checks`, `security` e `final-gate` passaram. O job de segurança iniciou Supabase descartável, aplicou migrations e usou credenciais geradas no próprio runner. | FEITO |
| Proteção da `main` | API do GitHub confirmou PR obrigatória, `final-gate` como único check obrigatório com branch atualizada, administradores incluídos, force push e exclusão bloqueados. Como há um único colaborador, a opção B do pedido foi aplicada: 0 aprovações obrigatórias até existir segundo revisor. | FEITO |
| Node | CI em Node 24 nos três jobs; `package.json` e lockfile declaram `24.x`, compatível com a versão suportada pela Vercel. | FEITO |

## Verificações técnicas

| Item | Resultado | Classe |
| --- | --- | --- |
| Supabase | Projeto CRM `wjtsxomfezrqwdnnxcuh` no Free, por decisão de produto; migrations remotas alinhadas até `20260926154510_feedback_user_index`. O Security Advisor oficial mostrou dois `INFO` de tabelas server-only sem policy (`ai_telemetry`, `billing_events`), quatro `WARN` de RPCs `SECURITY DEFINER` intencionais e `WARN` esperado de Leaked Password Protection nativa desativada. O Performance Advisor mostrou 17 `INFO` de índices ainda não usados, sem warning crítico. Confirmar configuração remota de comprimento mínimo de senha (8). | IMPORTANTE |
| Senhas vazadas | Proteção nativa Supabase: OFF por decisão de custo. Mitigação no backend do FigoCRM: Pwned Passwords Range API com SHA-1 calculado no servidor, envio só dos 5 caracteres de prefixo, comparação local, timeout de 2,5 s e falha fechada ao criar/alterar/redefinir senha. Testes automatizados cobrem ocorrência, ausência, indisponibilidade, timeout, resposta malformada e formato da requisição; consulta real com senha sabidamente comprometida foi bloqueada. Em produção, o cadastro com e-mail `.invalid` e senha sabidamente comprometida exibiu a mensagem esperada sem criar conta. O login não chama HIBP. Como a API pública do Supabase Auth continua acessível diretamente, esse controle cobre os fluxos do aplicativo, mas não impede um cliente externo de chamar Auth diretamente para definir senha: risco residual a revisar antes do beta. | IMPORTANTE |
| Suporte | Contatos oficiais fornecidos pelo responsável e publicados em `/suporte`, Conta, Termos e Privacidade: `figo.devtech@gmail.com`, WhatsApp `+55 83 98787-2668`. Em produção, `/suporte` contém ambos e não contém o aviso de canais futuros; `/termos` e `/privacidade` contêm o e-mail. | FEITO |
| Backup externo | Workflows diários e de monitoramento de 36 h, dump custom comprimido, GPG AES-256, upload R2, verificação de tamanho, retenção de sete dias e script de restore isolado estão implementados. **Não há bucket/secrets configurados nem backup remoto e restore drill comprovados nesta revisão.** Storage está fora do backup V1; confirmar aceitação do risco das fotos. | BLOCKER |
| RPCs privilegiadas | `consume_voice_rate_limit`, `issue_loan_document`, `merge_provisional_customer` e `record_ai_telemetry` têm `search_path=public, pg_temp`, owner `postgres`, `anon` sem EXECUTE, `authenticated` com EXECUTE e verificam `auth.uid()`. A primeira precisa gravar contadores sem acesso direto à tabela; a segunda emite snapshot de contrato de empréstimo do próprio usuário; a terceira atualiza vínculos em tabelas de escrita restrita após conferir origem/destino; a quarta grava telemetria sem acesso direto. Não mudar apenas para silenciar o Advisor. | FEITO |
| Billing | Consulta read-only no banco em 26/09: `unprocessed=0`, `payment_plan_mismatch=0`, `terminal_ignored=7` históricos. `billing:report`: 1 webhook processado, 0 falhas, 0 mismatch e 0 checkout pago sem ativação nas últimas 24 h. `billing:reconcile:asaas`: 1 assinatura comparada, 0 achados. Não houve nova cobrança de teste. | FEITO |
| Vercel Runtime Errors | Consulta oficial após o deploy `111f1006`: nenhuma ocorrência nova na janela de 15 minutos. O evento isolado de áudio inválido do ciclo anterior não se repetiu. | FEITO |
| Testes locais | `lint`, `typecheck`, `test:unit`, `test:benchmark:rules` e `build` passaram. Benchmark LLM real de 100 cenários passou, com p95 de 4691 ms e custo estimado de US$ 0,2951. `npm audit --audit-level=high`: 0 vulnerabilidades. `npm outdated` foi revisado, sem atualização de majors neste ciclo. | FEITO |
| Smoke HTTP de produção | `test:launch:e2e` no domínio oficial após a publicação: 4/4. Confirmou páginas/health, bloqueio sem sessão, exportação isolada, feedback e encerramento com usuários descartáveis. `/termos`, `/privacidade` e `/suporte` responderam HTTP 200. | FEITO |
| UI e voz | `test:ui` pós-deploy no domínio oficial: 12/12 em 390 px, incluindo logout/login e cookie inválido removido sem loop. A suíte completa anterior passou 15/15 nos tamanhos de 360 a 1440 px. `test:smoke` de voz/IA em produção: 8/8, incluindo diálogo financeiro, áudio real via Whisper, rate limit e telemetria. | FEITO |
| E2E completo | `npm run test:e2e` passou integralmente contra Supabase local descartável com LLM real (9/9, 10/10, 18/18, 3/3, 18/18 e 20/20). O helper de SSL foi corrigido para desativar SSL só em `127.0.0.1`/`localhost`. [Execução manual do GitHub 36261431058](https://github.com/figodevtech/figocrm/actions/runs/36261431058): `checks`, `security` e `final-gate` passaram, mas `e2e` falhou por falta de chave de LLM no environment `ci`. A revisão automática bloqueou exportar a chave local ao GitHub sem autorização específica; nenhuma chave foi enviada. | BLOCKER |

## Bloqueios objetivos

1. **BLOCKER — documentos legais:** Termos e Privacidade ainda trazem aviso de revisão jurídica. As páginas usam versão `26/09/2026`; remover o aviso apenas após confirmação do responsável sobre conteúdo final e entidade, sem inventar CNPJ, endereço ou DPO. O contato oficial já foi confirmado.
2. **BLOCKER — recuperação:** no Supabase Free, a alternativa escolhida é backup externo criptografado diário. Faltam bucket R2 privado e secrets, primeira execução real, validação da retenção e restore drill completo. O [runbook](../operations/runbook.md) contém o procedimento; não declarar backup ativo antes das evidências. Definir também aceitação do risco de Storage V1.
3. **BLOCKER — alertas:** há scripts read-only de billing e logs estruturados, mas não há execução/entrega de alertas comprovada para mismatch, checkout pago sem ativação, 5xx recorrente no webhook ou `billing_unavailable` recorrente. Definir canal operacional e executar teste de alerta apenas com evento controlado. Os workflows de backup falham em caso de erro/idade >36 h, mas a entrega da notificação precisa ser testada.
4. **BLOCKER — E2E manual do GitHub:** fornecer uma chave de IA própria do environment `ci` ou autorizar explicitamente o uso da chave local como secret criptografado desse environment; então repetir o workflow manual. O E2E completo já passou em Supabase local isolado. Não repetir pagamento real sem necessidade.
5. **BLOCKER — smoke de produto:** ainda falta evidência completa para cadastro e reset de senha, fluxos centrais de cliente/item/venda/troca/recebimento/empréstimo/PDF, todos os cenários de voz exigidos, instalação PWA em Android e desktop e ciclo real controlado de Free/trial até cancelamento da renovação Pro. Os testes parciais descritos acima não encerram essas linhas do checklist.

## Procedimento para encerrar os bloqueios

- Manter Supabase Free. Confirmar comprimento mínimo remoto de 8, revisar o risco residual de acesso direto à API Auth e testar em produção o fluxo do aplicativo com senha comprometida, sem cadastrar conta. Configurar R2 privado/secrets, executar backup e restore isolado, registrar a retenção.
- Obter validação jurídica do responsável; revisar conteúdo e então publicar sem aviso de rascunho. Os contatos oficiais já foram incorporados ao aplicativo.
- Repetir o E2E manual do GitHub com a chave autorizada, mantendo banco descartável; conferir `main`, produção e Runtime Logs após qualquer nova publicação.
- Configurar um canal de alerta operacional com teste de entrega; manter reconciliação Asaas read-only como padrão e investigar divergências antes de qualquer correção.
- Concluir cada linha do smoke de produto com evidência de resultado. Depois do merge deste relatório, verificar que o novo deployment está `READY`, que `/api/health` informa o novo SHA e que os Runtime Errors/5xx foram revisados antes de marcar a publicação mais recente como concluída.

## Pós-lançamento

**PÓS-LANÇAMENTO:** paginação antes de contas com grande volume, painel avançado de observabilidade, BI, contagem persistente de webhook duplicado e novos modelos de IA. Nenhum módulo novo foi criado neste ciclo.
