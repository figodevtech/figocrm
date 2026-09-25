Quero alterar a estrutura comercial, de assinatura e limites do FigoCRM.

Analise primeiro a implementação atual do projeto e faça a alteração preservando a arquitetura existente, especialmente Supabase, Asaas, RLS, subscriptions, account_entitlements, voice_rate_limits e os fluxos de trial/cobrança.

## Nova estrutura de planos

O FigoCRM deverá trabalhar com três planos:

### Free
Preço:
R$ 0,00/mês

Limites:
- até 10 clientes;
- até 20 comandos de voz por mês;
- acesso às funcionalidades gratuitas já existentes;
- permanece disponível após o fim do trial;
- não possui cobrança recorrente.

### Pro
Preço:
R$ 39,90/mês

Limites:
- clientes ilimitados;
- até 300 comandos de voz por mês;
- acesso completo às funcionalidades Pro;
- cobrança recorrente mensal pelo Asaas.

Esse deve ser o plano pago principal e destacado comercialmente como "Mais recomendado".

### Pro Mais
Preço:
R$ 89,90/mês

Limites:
- clientes ilimitados;
- até 1.000 comandos de voz por mês;
- mesmas funcionalidades do Pro;
- voltado a usuários que utilizam intensivamente os comandos por voz/IA;
- cobrança recorrente mensal pelo Asaas.

Não criar diferença artificial de funcionalidades entre Pro e Pro Mais neste momento. A principal diferença deve ser a franquia mensal de IA/voz.

---

# Trial

Manter trial gratuito de 7 dias.

Durante o trial, o usuário deve receber temporariamente os benefícios do plano Pro:

- clientes ilimitados;
- até 300 comandos de voz durante o mês/trial;
- todas as funções Pro.

Ao terminar o trial sem assinatura:

- não apagar nenhum dado;
- alterar automaticamente o usuário para o plano Free;
- manter leitura dos dados;
- aplicar limite de 10 clientes;
- aplicar limite de 20 comandos de voz por mês.

O usuário não deve perder dados caso possua mais de 10 clientes ao terminar o trial.

Nesse caso:
- os clientes existentes continuam visíveis;
- impedir apenas a criação de novos clientes enquanto estiver acima do limite Free.

---

# Banco de dados

Revisar a tabela:

public.plan_entitlements

Hoje existe algo semelhante a:

free
pro

Alterar para suportar:

free
pro
pro_plus

Configuração esperada:

free:
- price_cents = 0
- customer_limit = 10
- voice_monthly_limit = 20
- is_paid = false

pro:
- price_cents = 3990
- customer_limit = NULL
- voice_monthly_limit = 300
- is_paid = true

pro_plus:
- price_cents = 8990
- customer_limit = NULL
- voice_monthly_limit = 1000
- is_paid = true

Criar uma nova migration do Supabase seguindo o padrão existente do projeto.

Não editar migrations antigas já aplicadas.

---

# Assinaturas

Revisar:

public.subscriptions

e toda lógica relacionada a:

- plan_code;
- price_cents;
- provider_subscription_id;
- status;
- trial;
- current_period_end;
- cancel_at_period_end.

Criar códigos claros para os planos pagos, por exemplo:

figo_pro_mensal
figo_pro_plus_mensal

Evitar depender apenas do valor monetário para descobrir qual é o plano do usuário.

O plano deve ser identificado explicitamente pelo plan_code.

---

# account_entitlements()

Atualizar:

public.account_entitlements()

para retornar corretamente:

effective_plan:
- free
- pro
- pro_plus

E aplicar os limites correspondentes de:

- customer_limit;
- voice_monthly_limit;
- voice_used_this_month;
- voice_remaining_this_month.

Revisar qualquer lógica que atualmente aceite apenas:

'free' | 'pro'

para também aceitar:

'pro_plus'

---

# TypeScript

Atualizar tipos como:

EffectivePlan

de:

'free' | 'pro'

para:

'free' | 'pro' | 'pro_plus'

Atualizar todas as validações, parsers e condicionais relacionadas.

Não usar casts para esconder incompatibilidades de tipo.

---

# Comandos de voz

A cota deve continuar sendo controlada no backend antes de qualquer gasto com IA.

Fluxo obrigatório:

requisição
→ autenticação
→ consulta do plano
→ consulta da cota
→ rate limit
→ somente depois STT/LLM

Nunca chamar Whisper/OpenAI/Gemini se o usuário já tiver esgotado sua franquia.

Limites mensais:

Free:
20

Pro:
300

Pro Mais:
1000

O contador deve reiniciar de acordo com o mês-calendário, mantendo o comportamento atual do sistema.

---

# Tela Conta / Assinatura

Atualizar a interface de assinatura.

Apresentar os três planos de forma clara.

Free
R$ 0
- 10 clientes
- 20 comandos de voz/mês

Pro
R$ 39,90/mês
- clientes ilimitados
- 300 comandos de voz/mês
- destacar como "Mais recomendado"

Pro Mais
R$ 89,90/mês
- clientes ilimitados
- 1.000 comandos de voz/mês
- indicar como plano para uso intenso de IA

Na conta do usuário mostrar:

Plano atual

Uso da IA:
"127 de 300 comandos usados neste mês"

ou:

"127 / 1.000 comandos"

Exibir barra de progresso.

Quando estiver acima de 80%:
mostrar aviso discreto.

Quando atingir 100%:
informar que a franquia mensal de voz foi utilizada.

No Pro, quando atingir ou se aproximar do limite, apresentar CTA:

"Fazer upgrade para Pro Mais"

---

# Checkout Asaas

Atualizar o fluxo de checkout para receber explicitamente o plano escolhido.

Exemplo:

POST /api/billing/checkout

Payload:

{
  "plan": "pro"
}

ou:

{
  "plan": "pro_plus"
}

O backend deve determinar o preço.

NUNCA confiar em um preço enviado pelo frontend.

Tabela de preços no backend:

pro → R$ 39,90
pro_plus → R$ 89,90

Criar a assinatura correspondente no Asaas.

Persistir corretamente:

plan_code
price_cents
provider_subscription_id

---

# Upgrade Pro → Pro Mais

Preparar o sistema para permitir upgrade do Pro para Pro Mais.

Se a API atual do Asaas e a arquitetura existente permitirem alteração segura da assinatura existente, implementar a alteração.

Caso seja tecnicamente mais seguro criar uma nova assinatura, garantir:

- cancelamento/ajuste correto da anterior;
- não criar duas cobranças ativas;
- operação idempotente;
- atualização somente após confirmação válida do gateway.

Não inventar lógica financeira de pró-rata sem verificar se ela já existe no projeto.

Se não existir pró-rata, documentar explicitamente o comportamento adotado.

---

# Downgrade

Preparar a arquitetura para permitir:

Pro Mais → Pro

Não reduzir a cota no meio do período de forma inesperada.

Preferencialmente aplicar downgrade no próximo ciclo de cobrança.

Se já houver arquitetura de cancel_at_period_end ou mudança agendada, reutilizá-la.

---

# Usuários existentes

Muito importante:

Atualmente o sistema possui referência ao antigo plano de aproximadamente R$ 24,50.

Não alterar silenciosamente uma assinatura paga existente no gateway.

Para registros de desenvolvimento/trial sem assinatura real vinculada ao Asaas, pode migrar para a nova estrutura.

Para assinaturas que possuem:

provider_subscription_id

não fazer alteração automática de valor no Asaas apenas por migration SQL.

Criar lógica segura e documentar como os assinantes legados serão tratados.

Se não houver clientes reais ainda, deixar a implementação preparada, mas não introduzir complexidade desnecessária.

---

# Telemetria e custo de IA

Aproveitar a alteração para corrigir também a estimativa de custo da IA.

Atualmente o FigoCRM usa GPT-5.4 Mini, mas o modelo não está explicitamente cadastrado na tabela de preços e pode cair no fallback incorreto.

Adicionar suporte explícito ao modelo configurado.

Não hardcode silenciosamente preços sem deixar fácil sua manutenção futura.

Idealmente permitir:

LLM_PRICE_INPUT_PER_1M
LLM_PRICE_OUTPUT_PER_1M

como override por variável de ambiente, mantendo tabela interna como fallback.

O relatório:

scripts/ai_usage_report.mjs

deve conseguir mostrar, por plano:

- usuários ativos;
- comandos;
- comandos de voz;
- minutos de áudio;
- tokens de entrada;
- tokens de saída;
- custo estimado de IA;
- receita mensal estimada;
- custo médio de IA por usuário;
- margem bruta estimada por usuário;
- percentual da mensalidade consumido pela IA.

---

# Segurança

Manter todas as garantias atuais:

- RLS;
- fail-closed;
- backend como fonte de verdade;
- usuário não escolhe sua própria cota;
- usuário não altera plan_code diretamente;
- usuário não altera preço;
- service_role nunca no frontend;
- cobrança confirmada por webhook;
- retorno do navegador nunca deve liberar plano pago sozinho.

---

# Testes

Atualizar e criar testes para:

1. Free possui limite de 10 clientes.
2. Free possui 20 comandos de voz.
3. Pro possui clientes ilimitados.
4. Pro possui 300 comandos de voz.
5. Pro Mais possui clientes ilimitados.
6. Pro Mais possui 1.000 comandos.
7. Usuário Free não consegue consumir o comando 21.
8. Usuário Pro não consegue consumir o comando 301.
9. Usuário Pro Mais não consegue consumir o comando 1001.
10. Requisição bloqueada por cota não chama STT nem LLM.
11. Checkout Pro cria cobrança de R$ 39,90.
12. Checkout Pro Mais cria cobrança de R$ 89,90.
13. Frontend não consegue manipular o preço da assinatura.
14. Webhook associa corretamente o plano comprado.
15. Trial recebe limites equivalentes ao Pro.
16. Trial expirado cai corretamente para Free.
17. Usuário com mais de 10 clientes após o trial mantém os dados, mas não cria novos clientes.
18. Upgrade não gera duas assinaturas simultâneas.
19. RLS continua isolando completamente usuários diferentes.
20. TypeScript, lint, testes e build passam sem erros.

---

# UX

Não utilizar termos técnicos como "tokens", "LLM" ou "STT" para o cliente final.

Usar:

"Comandos de voz"

Exemplos:

"Você usou 87 de 300 comandos de voz neste mês."

"Restam 213 comandos de voz."

"Você chegou ao limite do seu plano. Digite a operação ou faça upgrade para continuar usando comandos de voz."

O usuário sempre deve continuar podendo utilizar os recursos manuais permitidos pelo plano mesmo após acabar a franquia de voz.

---

# Resultado esperado

Ao finalizar:

1. listar todos os arquivos alterados;
2. explicar as migrations criadas;
3. explicar como ficou Free, Pro e Pro Mais;
4. informar como assinaturas antigas foram tratadas;
5. informar como funciona upgrade/downgrade;
6. mostrar como o backend impede fraude de preço/plano;
7. mostrar onde alterar preços futuramente;
8. mostrar onde alterar as cotas futuramente;
9. executar testes;
10. executar lint;
11. executar build;
12. corrigir qualquer erro encontrado antes de concluir.

Não faça apenas alterações visuais.

A regra dos planos precisa estar protegida no banco e no backend, com o frontend apenas refletindo a fonte de verdade.