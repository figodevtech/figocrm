# Checklist de abertura do beta público

Marque somente após guardar evidência (SHA, URL, horário e resultado) no [relatório de launch hardening](../architecture/relatorio_launch_ready_figocrm.md). Não abrir o beta enquanto houver `BLOCKER`.

## Publicação e proteção

- [x] PR #2 mesclada; CI da `main` verde no commit `eba8b5c5`: lint, typecheck, unit, benchmark de regras, build, security e `final-gate`.
- [x] `main` exige PR e `final-gate` atualizado, inclui administradores, bloqueia force push e delete (API do GitHub em 26/09/2026). Há um único colaborador; por isso, a regra exige 0 aprovações temporariamente.
- [x] Deployment de produção `READY` no commit `eba8b5c5`; domínio `crm.figosoftwares.com.br` responde; `/api/health` retorna `ok`.
- [x] Runtime Errors e 5xx novos examinados após a publicação; nenhum erro novo recorrente no deployment.
- [ ] Após o merge do relatório de 26/09, confirmar o novo deployment de produção em `READY`, `/api/health` com o SHA correspondente e revisar Runtime Errors/5xx desse deployment. Repetir esta verificação após qualquer novo commit na `main` antes de abrir o beta.

## Dados, segurança e suporte

- [x] Migrations locais e remotas alinhadas; Security Advisor e Performance Advisor oficiais revisados, com achados documentados no relatório.
- [x] Mitigação de senha vazada com HIBP Range API no backend, consulta por prefixo, falha fechada e testes automatizados; Supabase Free mantém proteção nativa OFF por decisão de custo.
- [ ] Confirmar no Auth remoto senha mínima de 8 caracteres e revisar o risco residual de chamadas diretas à API Supabase Auth.
- [ ] Backup criptografado real no R2 privado, retenção de sete dias e restauração em ambiente isolado com smoke; definir responsável e risco aceito para Storage V1.
- [x] Contato oficial de suporte incorporado: `figo.devtech@gmail.com`, WhatsApp `+55 83 98787-2668`; confirmar no domínio oficial após o deploy.
- [ ] Termos e Privacidade revisados e publicados sem aviso de rascunho.
- [x] Exportação, feedback e pedido de encerramento verificados com conta descartável no domínio oficial.

## Smoke de produto

- [ ] E2E manual do GitHub verde com LLM real no environment `ci`; o E2E completo já passou localmente com Supabase descartável.
- [ ] Cadastro, login, logout e reset de senha; sessão expirada/revogada leva ao login sem loop.
- [ ] Cliente, item, venda, troca, recebimento, empréstimo e contrato PDF.
- [ ] Comandos de voz: venda, recebimento, cliente avulso, item sem estoque, empréstimo e consulta; telemetria registra provedor, modelo, fonte e sucesso.
- [ ] PWA em Android e desktop: ícones, standalone, offline page e safe areas.
- [ ] Conta controlada: Free/trial → Pro pago → webhook → plano ativo → cancelar renovação → Pro até `current_period_end`. Pro → Pro Mais apenas se houver necessidade de confirmar valor, sem cobrança de teste repetida.
- [ ] `billing:report` sem mismatch nem checkout pago sem ativação; `billing:reconcile:asaas` sem divergências; alertas operacionais ativos.

## Freeze

Até a abertura do beta, aceitar só correções de bug, segurança, billing, UX crítica e performance comprovada por medição. Novos módulos ficam fora do escopo.
