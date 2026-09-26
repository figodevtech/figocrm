# Checklist de abertura do beta público

Marque somente após guardar evidência (SHA, URL, horário e resultado) no [relatório de launch hardening](../architecture/relatorio_launch_ready_figocrm.md). Não abrir o beta enquanto houver `BLOCKER`.

## Publicação e proteção

- [ ] PR revisado e CI verde: lint, typecheck, unit, benchmark de regras, build e security no environment `ci`.
- [x] `main` exige PR e status checks, bloqueia force push e delete (verificado pela API do GitHub em 26/09/2026).
- [ ] Deployment de produção `READY` no commit do PR; domínio `crm.figosoftwares.com.br` responde; `/api/health` retorna `ok`.
- [ ] Runtime Errors e 5xx novos examinados após a publicação.

## Dados, segurança e suporte

- [ ] Migrations locais e remotas alinhadas; Security Advisor e Performance Advisor revisados.
- [ ] Leaked Password Protection ativa e senha mínima de pelo menos 8 caracteres.
- [ ] Backup restaurado em ambiente separado ao menos uma vez; último deployment estável conhecido.
- [ ] Termos e Privacidade revisados e publicados; e-mail oficial de suporte publicado.
- [ ] Exportação e pedido de encerramento verificados com conta descartável; feedback chega à operação.

## Smoke de produto

- [ ] Cadastro, login, logout e reset de senha; sessão expirada/revogada leva ao login sem loop.
- [ ] Cliente, item, venda, troca, recebimento, empréstimo e contrato PDF.
- [ ] Comandos de voz: venda, recebimento, cliente avulso, item sem estoque, empréstimo e consulta; telemetria registra provedor, modelo, fonte e sucesso.
- [ ] PWA em Android e desktop: ícones, standalone, offline page e safe areas.
- [ ] Conta controlada: Free/trial → Pro pago → webhook → plano ativo → cancelar renovação → Pro até `current_period_end`. Pro → Pro Mais apenas se houver necessidade de confirmar valor, sem cobrança de teste repetida.
- [ ] `billing:report` sem mismatch nem checkout pago sem ativação; `billing:reconcile:asaas` sem divergências; alertas operacionais ativos.

## Freeze

Até a abertura do beta, aceitar só correções de bug, segurança, billing, UX crítica e performance comprovada por medição. Novos módulos ficam fora do escopo.
