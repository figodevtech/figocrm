// src/lib/billing/webhook.ts
// Entrada única de webhooks de cobrança. Ordem: provedor configurado → assinatura criptográfica sobre
// o corpo bruto → evento normalizado → aplicação idempotente. Sem provedor ou sem service_role, recusa.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBillingProvider } from '@/lib/billing/registry';
import { applyBillingEvent } from '@/lib/billing/service';
import { createAdminClient } from '@/lib/supabase/admin';
import type { BillingProvider } from '@/lib/billing/types';

const MAX_BODY_BYTES = 256 * 1024;

export async function handleBillingWebhook(
  request: Request,
  deps: { provider?: BillingProvider | null; admin?: SupabaseClient | null } = {}
): Promise<NextResponse> {
  const provider = deps.provider !== undefined ? deps.provider : getBillingProvider();
  if (!provider) {
    return NextResponse.json({ error: 'billing_provider_not_configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  const event = await provider.verifyWebhook(rawBody, request.headers).catch(() => null);
  if (!event) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const admin = deps.admin !== undefined ? deps.admin : createAdminClient();
  if (!admin) {
    console.error('[billing] SUPABASE_SERVICE_ROLE_KEY ausente: evento não aplicado', event.eventId);
    return NextResponse.json({ error: 'billing_storage_unavailable' }, { status: 503 });
  }

  const result = await applyBillingEvent(admin, event);
  if (result.error && !result.duplicate) {
    console.error('[billing] falha ao aplicar evento', event.eventId, result.error);
    // subscription_not_found é definitivo (não adianta o provedor reenviar); o resto é transitório
    return NextResponse.json({ received: true, applied: false, error: result.error }, { status: result.error === 'subscription_not_found' ? 200 : 500 });
  }
  return NextResponse.json({ received: true, applied: result.applied, duplicate: result.duplicate });
}
