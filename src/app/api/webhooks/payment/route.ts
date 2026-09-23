// src/app/api/webhooks/payment/route.ts
// Webhook de cobrança. Antes: aceitava eventos sem assinatura (ou comparando um segredo em texto no header)
// e ativava assinatura a partir do payload. Agora: exige provedor configurado e assinatura criptográfica
// verificada pelo provedor; aplicação idempotente por event_id. Sem provedor → 503, nada é alterado.

import { handleBillingWebhook } from '@/lib/billing/webhook';

export async function POST(request: Request) {
  return handleBillingWebhook(request);
}
