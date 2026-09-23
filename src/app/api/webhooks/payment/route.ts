// src/app/api/webhooks/payment/route.ts
// Webhook para recepção de notificações de gateway de pagamento (Fase 6)

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('x-webhook-signature');
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;

    // Se o segredo estiver configurado em produção, valida a assinatura
    if (webhookSecret && signature !== webhookSecret) {
      return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
    }

    const payload = await request.json();
    const { event, data } = payload;

    if (!event || !data || !data.userId) {
      return NextResponse.json({ error: 'Payload incompleto.' }, { status: 400 });
    }

    const supabase = await createClient();
    const userId = data.userId;

    switch (event) {
      case 'payment.succeeded':
      case 'subscription.activated':
      case 'subscription.renewed':
        await supabase
          .from('profiles')
          .update({
            subscription_status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        break;

      case 'payment.failed':
        await supabase
          .from('profiles')
          .update({
            subscription_status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        break;

      case 'subscription.canceled':
        await supabase
          .from('profiles')
          .update({
            subscription_status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        break;

      default:
        // Evento ignorado
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Erro no processamento do webhook:', error);
    return NextResponse.json({ error: 'Falha interna ao processar webhook.' }, { status: 500 });
  }
}
