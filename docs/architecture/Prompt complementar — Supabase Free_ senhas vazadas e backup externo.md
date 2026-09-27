ALTERAÇÃO DE DECISÃO DO RELEASE CANDIDATE DO FIGOCRM.

NÃO migrar para Supabase Pro.

O projeto continuará utilizando:

```text
Supabase Free
```

Remova Supabase Pro da lista de bloqueadores de lançamento.

Precisamos substituir os dois benefícios que estavam motivando o upgrade:

```text
1. Leaked Password Protection
2. Backup diário
```

por alternativas próprias, gratuitas e seguras.

Não alterar outras partes do Release Candidate.

---

# 1. PROTEÇÃO CONTRA SENHAS VAZADAS

Como o recurso nativo do Supabase não será contratado, implementar verificação própria no BACKEND usando:

```text
Have I Been Pwned
Pwned Passwords Range API
k-anonymity
```

NÃO usar API de consulta de e-mail.

NÃO enviar a senha para terceiros.

NÃO enviar SHA-1 completo.

---

# FLUXO

Quando o usuário DEFINIR uma nova senha:

```text
senha
↓
SHA-1 calculado server-side
↓
primeiros 5 caracteres do hash
↓
Pwned Passwords Range API
↓
recebe lista de sufixos
↓
comparação acontece localmente no servidor
```

Exemplo conceitual:

```text
SHA1(password):
5BAA61E4...

prefix:
5BAA6

suffix:
1E4...
```

Apenas:

```text
5BAA6
```

pode sair do servidor.

---

# CRIAR SERVIÇO

Criar algo equivalente a:

```text
src/lib/security/pwned-password.ts
```

API:

```ts
checkPwnedPassword(password: string)
```

Resposta:

```ts
{
  compromised: boolean
  occurrences?: number
}
```

---

# APLICAR EM

Obrigatoriamente:

```text
cadastro
redefinição de senha
alteração de senha
```

NÃO executar a consulta a cada login.

O login não deve depender do Have I Been Pwned.

---

# SENHA COMPROMETIDA

Se encontrada:

bloquear.

Mensagem:

```text
Essa senha já apareceu em vazamentos de dados.
Escolha outra senha.
```

Não mostrar:

```text
SHA-1
quantidade de vazamentos
nome de breach
API externa
```

---

# INDISPONIBILIDADE DO HIBP

Timeout curto.

Exemplo:

```text
2–3 segundos
```

Não deixar requisição pendurada indefinidamente.

Para operações de DEFINIÇÃO DE SENHA:

preferir falhar com segurança.

Mensagem:

```text
Não foi possível verificar a segurança da senha agora.
Tente novamente em instantes.
```

Não impedir LOGIN de usuários existentes por indisponibilidade externa.

---

# CACHE

Pode fazer cache temporário apenas da resposta por:

```text
prefix SHA-1
```

Nunca cachear:

```text
senha
hash completo
```

---

# LOGS

NUNCA logar:

```text
password
hash
suffix
```

Pode registrar apenas:

```text
pwned_password_check_failed
pwned_password_rejected
```

sem dados da senha.

---

# TESTES

Adicionar testes com:

```text
senha sabidamente comprometida
senha não encontrada
API indisponível
timeout
resposta malformada
```

E garantir que:

```text
senha completa nunca aparece na requisição externa
```

---

# 2. POLÍTICA LOCAL DE SENHA

Manter no mínimo:

```text
8 caracteres
```

Não criar exigências irritantes como:

```text
1 maiúscula
1 número
1 caractere especial
```

se não houver necessidade.

O principal controle será:

```text
comprimento
+
bloqueio de senha comprometida
```

---

# 3. SUPABASE SECURITY ADVISOR

O Advisor continuará mostrando:

```text
Leaked Password Protection Disabled
```

Isso agora é ESPERADO porque o projeto permanece Free.

NÃO classificar mais isso como BLOCKER.

Documentar:

```text
Proteção nativa Supabase:
OFF por decisão de custo.

Mitigação:
Pwned Passwords Range API server-side com k-anonymity.
```

Adicionar teste automatizado dessa mitigação.

---

# 4. BACKUP NO SUPABASE FREE

O projeto Free não possui backup diário gerenciado como requisito do nosso plano operacional.

Implementar backup lógico externo.

Arquitetura:

```text
Supabase PostgreSQL
↓
pg_dump / supabase db dump
↓
compressão
↓
criptografia
↓
Cloudflare R2 privado
```

---

# 5. CLOUDFLARE R2

Usar:

```text
Cloudflare R2
```

como destino off-site.

Bucket sugerido:

```text
figocrm-backups
```

Bucket:

```text
PRIVATE
```

Nunca tornar público.

---

# CREDENCIAIS

Configurar somente como secrets:

```text
BACKUP_DATABASE_URL

R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET

BACKUP_ENCRYPTION_KEY
```

Nunca utilizar:

```text
NEXT_PUBLIC_*
```

para essas informações.

Nunca commitar.

---

# 6. BACKUP AUTOMÁTICO

Criar:

```text
.github/workflows/database-backup.yml
```

Executar:

```text
1 vez por dia
```

Também permitir:

```text
workflow_dispatch
```

---

# FLUXO DO WORKFLOW

```text
checkout
↓
instalar ferramentas necessárias
↓
gerar pg_dump
↓
comprimir
↓
criptografar
↓
upload para R2
↓
validar existência/tamanho
↓
remover arquivo temporário do runner
```

---

# FORMATO

Usar formato do PostgreSQL adequado para restore.

Preferência:

```text
pg_dump custom format
```

com compressão.

Depois criptografar antes de sair do runner.

---

# NÃO SUBIR DUMP PURO

Proibido enviar para R2:

```text
.sql
.dump
```

sem criptografia.

O objeto remoto deve ser criptografado.

Exemplo:

```text
figocrm-2026-09-27.dump.enc
```

---

# CRIPTOGRAFIA

Usar ferramenta estável disponível no runner.

Exemplo:

```text
openssl
```

ou equivalente.

A chave:

```text
BACKUP_ENCRYPTION_KEY
```

fica exclusivamente em GitHub Secrets/local seguro.

Não registrar a chave nos logs.

---

# 7. RETENÇÃO

Manter:

```text
7 backups diários
```

Excluir backups mais antigos automaticamente.

Pode utilizar:

```text
R2 lifecycle
```

preferencialmente.

Ou rotina segura no workflow.

---

# NÃO APAGAR BACKUP ATUAL ANTES DO NOVO

Ordem:

```text
criar novo
↓
upload
↓
validar
↓
somente depois executar retenção
```

---

# 8. ALERTA DE BACKUP

Se:

```text
dump falhar
criptografia falhar
upload falhar
validação falhar
```

workflow deve:

```text
FAIL
```

Não retornar sucesso falso.

Adicionar backup ao monitor operacional.

Critério:

```text
último backup válido < 36 horas
```

Caso contrário:

```text
ALERT
```

---

# 9. RESTORE DRILL

Criar script/documentação:

```text
scripts/restore_backup_test.*
```

ou equivalente.

Fluxo:

```text
baixar backup
↓
descriptografar
↓
subir Supabase/Postgres isolado
↓
restore
↓
validar tabelas
```

Nunca restaurar sobre produção durante teste.

---

# VALIDAR DEPOIS DO RESTORE

No mínimo:

```text
profiles
customers
items
deals
deal_items
receivables
installments
payments
settlements
loan_contracts
subscriptions
billing_events
```

Comparar:

```text
existência
contagem plausível
integridade referencial
```

---

# RESTORE DRILL DE RELEASE

Antes de liberar beta:

executar UMA vez.

Registrar:

```text
backup criado
backup baixado
descriptografado
restore concluído
smoke concluído
```

Depois disso não precisa restaurar diariamente.

---

# 10. STORAGE

Esse backup protege PostgreSQL.

Não fingir que protege automaticamente:

```text
Supabase Storage
```

No FigoCRM, documentar separadamente arquivos não regeneráveis.

Se contrato PDF puder ser regenerado do snapshot:

não tratar PDF como fonte primária.

Fotos de mercadoria podem permanecer fora do primeiro backup automatizado se o risco for aceito no beta.

Registrar explicitamente:

```text
Database:
backup diário externo

Storage:
fora do escopo do backup V1
```

---

# 11. SEGURANÇA DO BACKUP

Nunca colocar backups em:

```text
Git repository
GitHub release
/public
Supabase public bucket
Vercel static assets
```

Nunca permitir download por usuário do aplicativo.

---

# 12. RUNBOOK

Atualizar:

```text
docs/operations/runbook.md
```

Adicionar:

```text
BACKUP — criação
BACKUP — falha
RESTORE — procedimento
R2 — recuperação
perda da encryption key
rotação de credenciais
```

---

# 13. RELATÓRIO DE LANÇAMENTO

Atualizar:

```text
docs/architecture/relatorio_launch_ready_figocrm.md
```

Alterar:

```text
Supabase Pro obrigatório
```

para:

```text
Supabase Free — decisão de produto
```

---

# STATUS DE SENHAS

Registrar:

```text
Supabase native leaked password protection:
OFF

Compensating control:
HIBP Pwned Passwords k-anonymity
```

Se os testes passarem:

```text
FEITO
```

---

# STATUS DE BACKUP

Depois do backup + restore drill:

```text
Supabase managed daily backups:
não contratado

External encrypted daily backup:
ATIVO

Destination:
Cloudflare R2 private

Retention:
7 dias

Restore drill:
PASS
```

---

# NÃO CLASSIFICAR COMO BLOCKER

Depois dessas implementações, NÃO bloquear lançamento por:

```text
Supabase Free
Leaked Password Protection nativo desligado
ausência de Supabase Daily Backup
ausência de PITR
```

desde que:

```text
HIBP funcionando
backup externo funcionando
restore testado
```

---

# CONTATOS OFICIAIS

Também aplicar as informações já definidas:

```text
Suporte:
figo.devtech@gmail.com

WhatsApp:
+55 83 98787-2668

wa.me:
5583987872668
```

Atualizar:

```text
/suporte
/app/conta
/termos
/privacidade
```

onde aplicável.

Remover aviso:

```text
canais serão publicados antes do beta
```

---

# PRINCÍPIO

Não comprar infraestrutura antes de precisar dela.

Supabase Free continuará sendo usado no beta.

Compensar as limitações do plano através de controles próprios simples e auditáveis.

Objetivo:

```text
custo baixo
+
dados recuperáveis
+
senhas comprometidas bloqueadas
+
nenhuma falsa sensação de segurança
```

Depois de implementar:

```text
rodar testes
rodar backup
fazer restore drill
auditar produção
recalcular BLOCKER
```