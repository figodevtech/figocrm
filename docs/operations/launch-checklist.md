# Checklist de abertura do beta público

Marque somente após guardar evidência (SHA, URL, horário e resultado) no [relatório de launch hardening](../architecture/relatorio_launch_ready_figocrm.md). Não abrir o beta enquanto houver `BLOCKER`.

## Publicação e proteção

- [x] PR #9 mesclada; [CI do release candidate](https://github.com/figodevtech/figocrm/actions/runs/36353321147) verde: lint, typecheck, unit, scripts de backup, benchmark, build, security, restore local e `final-gate`.
- [x] `main` exige PR e `final-gate` atualizado, inclui administradores, bloqueia force push e delete (API do GitHub em 26/09/2026). Há um único colaborador; por isso, a regra exige 0 aprovações temporariamente.
- [x] Deployment de produção `READY` no commit `32301356`; domínio `crm.figosoftwares.com.br` responde; `/api/health` retorna `ok`, SHA esperado, `database: ok`, `billing: configured`.
- [x] Runtime Errors e 5xx novos examinados após a publicação; nenhum erro novo recorrente no deployment.
- [x] Após a PR #9, `main`, deployment `READY`, `/api/health` e Runtime Errors/5xx conferidos; repetir após cada novo merge.

## Dados, segurança e suporte

- [x] Migrations locais e remotas alinhadas; Security Advisor e Performance Advisor oficiais revisados, com achados documentados no relatório.
- [x] Mitigação de senha vazada com HIBP Range API no backend, consulta por prefixo, falha fechada e testes automatizados; Supabase Free mantém proteção nativa OFF por decisão de custo.
- [x] RLS em todas as 27 tabelas públicas, 0 FKs públicas inválidas e 24 migrations remotas alinhadas; mitigação HIBP nos fluxos do aplicativo verificada.
- [ ] Pós-lançamento: corrigir a política do Auth remoto. Um `signUp` direto aceitou senha de sete caracteres em produção; a conta descartável foi excluída. O mínimo de oito caracteres e a checagem HIBP no aplicativo podem ser contornados pela API Auth pública.
- [x] **Risco operacional aceito pelo responsável:** backup R2 de produção ainda não configurado; restore local de `auth` e `public` passou no CI. Ativação do backup remoto, retenção, restore completo e proteção de Storage ficam para pós-lançamento. Não declarar backup ativo.
- [x] Contato oficial de suporte publicado e conferido no domínio oficial: `figo.devtech@gmail.com`, WhatsApp `+55 83 98787-2668`.
- [x] Termos e Privacidade publicados sem aviso de rascunho, com e-mail e WhatsApp oficiais confirmados por HTTP 200.
- [x] Exportação, feedback e pedido de encerramento verificados com conta descartável no domínio oficial.

## Smoke de produto

- [x] Cadastro pela página pública criou perfil e trial; Auth 3/3 com recuperação por token gerado pela API Admin; login, logout, novo login e cookie inválido testados sem loop.
- [ ] Pós-lançamento: verificar entrega real do e-mail de recuperação, redirect, `/auth/callback` e formulário de nova senha em produção. O teste Auth 3/3 não cobre essa jornada.
- [x] Cliente, item, venda, troca, recebimento, estorno e empréstimo testados em produção; prévia do contrato carregou no navegador. Geração de PDF validada no CI isolado; smoke da rota HTTP de PDF fica para QA pós-lançamento.
- [x] Voz com LLM real, troca, quitação, STT por Whisper, fallback, rate limit e telemetria: `test:smoke` 8/8 em produção.
- [x] PWA tecnicamente validada: HTTPS, manifest `standalone`, ícones 192/512, service worker, offline page, metadata e safe area. Instalação física em Android/desktop fica para QA pós-lançamento.
- [x] Billing sem nova cobrança real: estado previamente comprovado, relatório read-only com 0 mismatch/checkout pago sem ativação e reconciliação Asaas de 1 assinatura sem achados. O ciclo de renovação/cancelamento não foi repetido nesta revisão.
- [x] `test:launch:e2e` 4/4 e `test:ui` 17/17 no domínio oficial; 0 5xx após os smokes. Acompanhar manualmente billing, GitHub Actions e Runtime Logs/5xx da Vercel durante o beta.

O E2E com LLM real no GitHub, os alertas automáticos avançados, o restore do backup R2 de produção e a instalação física da PWA são acompanhamentos pós-lançamento por decisão de produto. O risco de ausência de backup externo permanece explícito no relatório.

## Freeze

Feature freeze ativo no beta: somente bug crítico, segurança, billing, perda/corrupção de dados e regressão de produção. Novos módulos ficam fora do escopo.
