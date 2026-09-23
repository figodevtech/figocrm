# Contrato da API para o front-end definitivo

Estado: backend pronto para o front voice-first. Este documento lista, tela por tela, o que já existe,
o formato das respostas e o que ainda precisa ser criado. O front **não** interpreta mensagens de erro
técnicas: toda resposta de voz vem no contrato `AssistantResponse`, com `message` pronta para mostrar e falar.

Autenticação: cookie de sessão do Supabase (`@supabase/ssr`). Rotas `/api/*` respondem 401 sem sessão.
Escrita exige assinatura válida; leitura nunca é bloqueada por cobrança.

## Contrato comum: `AssistantResponse`

Arquivo: `src/lib/api/assistant-response.ts`.

```ts
type AssistantResponse =
  | { status: 'executed'; message: string; undoAvailable: boolean; operationId?: string;
      operationType?: 'deal' | 'payment' | 'adjustment' | 'reversal' | 'renegotiation' | 'reschedule'; dealId?: string }
  | { status: 'answered'; message: string }                                   // consulta, nada gravado
  | { status: 'needs_input'; message: string; field?: string; candidates?: { id: string; label: string; detail?: string }[] }
  | { status: 'error'; message: string; retryable: boolean;
      code: 'subscription_required' | 'unauthenticated' | 'rate_limited' | 'not_found' | 'validation' | 'provider_unavailable' | 'internal' };
```

Como o front reage:

| status | UI | Voz |
| :--- | :--- | :--- |
| `executed` | toast verde + botão **Desfazer** se `undoAvailable` | falar `message` |
| `answered` | card de resposta | falar `message` |
| `needs_input` | manter o microfone aberto; se houver `candidates`, mostrar botões com `label` (tocar = falar o label) | falar `message` |
| `error` + `subscription_required` | CTA de assinatura (tela Billing) | falar `message` |
| `error` + `retryable` | botão "tentar de novo" | falar `message` |

A conversa é contínua: a próxima fala responde à pergunta pendente (valor que faltou, escolha entre
candidatos, "sim/não" da leitura de volta). O front não precisa guardar estado da conversa.

Leitura de volta: quando a LLM está indisponível, escritas vêm como `needs_input` com
`field: 'confirmation'` e `message` do tipo "Entendi: … Confirma?". Mostrar botões **Sim** / **Não**
(tocar = enviar "sim"/"não" como fala).

## Voice interaction

| Ação | Endpoint | Entrada | Saída |
| :--- | :--- | :--- | :--- |
| Falar (áudio) | `POST /api/voice/transcribe` | `multipart/form-data`: `audio` (webm/m4a/mp4/wav/ogg/mp3, ≤ 15 MB), `autoProcess` (padrão true) | `{ transcribedText, processResult: { assistant, intent, metrics }, metrics }` |
| Falar (texto já transcrito) | `POST /api/voice/process` | `{ spokenText }` (≤ 2000 caracteres) | `{ assistant, intent, metrics }` |
| Desfazer operação | `POST /api/operations/reverse` | `{ operationId }` (de `assistant.operationId`) | `{ assistant }` |
| Desfazer última (atalho) | server action `undoLastAction()` | — | `{ success, message }` |

Erros HTTP dos endpoints de voz também trazem `assistant`: 401 (`unauthenticated`), 429 (`rate_limited`,
header `Retry-After`), 400/413 (`validation`), 500/503 (`internal`). Limite padrão: 10 comandos/min e
120/hora por usuário (`VOICE_RATE_LIMIT_PER_MINUTE`, `VOICE_RATE_LIMIT_PER_HOUR`).

Operações por voz suportadas: venda (à vista/parcelada), troca (seca, com volta recebida/paga, volta
parcelada), compra, pagamento (valor, parcela, quitação), abatimento, mudança de vencimento,
renegociação (juntar parcelas em novo parcelamento), desfazer pagamento/abatimento e consultas
(quanto fulano deve, na rua, em mercadoria, atrasados, próxima parcela, lucro do mês).

## Home

| Dado | Fonte | Observação |
| :--- | :--- | :--- |
| Na rua, Atrasado, Em mercadoria, Ganhou no mês | server action `getDashboardSummaryAction()` → `{ indicators: { naRua, atrasado, emMercadoria, quantoGanhouMes } }` | RPC `get_dashboard_indicators` (INVOKER) |
| Status do trial / CTA | `GET /api/billing/status` | ver Billing |
| Microfone | Voice interaction | |

## Customers

| Ação | Fonte |
| :--- | :--- |
| Listar | `getCustomersAction()` → `{ customers }` |
| Criar | `createCustomerAction({ name, phone?, document?, notes? })` |
| Detalhe (dívidas, parcelas, histórico) | **a criar**: `GET /api/customers/:id` com dívidas abertas, parcelas (inclui `renegotiated`) e liquidações (com `reversal_of`) |

## Items (estoque)

| Ação | Fonte |
| :--- | :--- |
| Listar estoque | `getStockItemsAction(statusFilter?)` |
| Criar | `createItemAction({ name, acquisitionCost, category?, description?, targetSalePrice?, status?, photoUrl? })` |
| Custo agregado (peças, funilaria…) | `addItemCostAction({ itemId, category, description, amount })` |

Lacuna observada em produção: vender por voz um item que não está no estoque responde
"Não encontrei … no seu estoque". Decidir no produto se a venda deve cadastrar o item na hora
(custo desconhecido → CMV/lucro incompletos) ou só orientar o cadastro.

## Deals (negócios)

| Ação | Fonte |
| :--- | :--- |
| Venda manual | `createSaleAction(CreateSaleInput)` → `{ dealId?, error?, alreadyExecuted? }` |
| Troca manual | `createTradeAction(CreateTradeInput)` → idem |
| Listar / detalhe | **a criar**: `GET /api/deals` e `GET /api/deals/:id` |

Formulário e voz executam o mesmo domínio (`DealCommand` → executor → RPC atômica). Enviar
`idempotencyKey` (uuid gerado no front) para evitar duplicidade em duplo clique.

## Receivables (a receber)

| Ação | Fonte |
| :--- | :--- |
| Pagamento de parcela | `registerPaymentAction({ installmentId, amount, paymentMethod, notes? })` |
| Abatimento | `registerAdjustmentAction({ installmentId?, dealId?, adjustmentType, amount, reason, counterItem? })` |
| Mudar vencimento | `updateDueDateAction({ installmentId, newDueDate })` |
| Renegociar (manual) | **a criar**: action que chame `renegotiateInstallments` (RPC `renegotiate_installments` já existe) |
| Desfazer pagamento/abatimento | `POST /api/operations/reverse` |
| Listar por cliente / atrasadas | **a criar** (`GET /api/receivables?customerId=&status=`) |

Regras que o front deve refletir: parcela `renegotiated` aparece no histórico, nunca como aberta;
pagamento maior que o saldo é recusado; estorno é um lançamento negativo ligado ao original.

## Billing

`GET /api/billing/status`:

```json
{ "status": "trialing|active|past_due|canceled|expired|blocked|missing|unknown",
  "canWrite": true, "reason": "trial", "message": null,
  "trialEndsAt": "…", "trialDaysRemaining": 5, "currentPeriodEnd": null, "graceUntil": null,
  "cancelAtPeriodEnd": false,
  "plan": { "name": "FigoCRM", "priceCents": 2490, "currency": "BRL", "interval": "month" },
  "checkoutAvailable": false }
```

- `canWrite: false` → mostrar `message` + CTA. Dados continuam visíveis.
- `checkoutAvailable: false` enquanto nenhum gateway estiver configurado (`BILLING_PROVIDER`).
- **A criar quando o gateway for escolhido**: `POST /api/billing/checkout` (usa `BillingProvider.createCheckout`),
  cancelamento/reativação. A ativação só acontece pelo webhook assinado — nunca pelo redirect de sucesso.

## Account

| Ação | Fonte |
| :--- | :--- |
| Login / cadastro / sair | `signInAction`, `signUpAction`, `signOutAction` |
| Editar nome/telefone/segmento | update direto em `profiles` (só essas colunas são editáveis) |
| Reset de senha | **a criar no front**: `supabase.auth.resetPasswordForEmail` + tela de nova senha (`updateUser`) — fluxo validado em `tests/e2e/auth.e2e.ts` |
| Excluir conta | **a criar** (exclusão em cascata a partir de `auth.users`) |
