// src/app/api/operations/reverse/route.ts
// Botão "desfazer" do front: estorna a operação devolvida em `assistant.operationId` (pagamento ou
// abatimento). Estorno idempotente e com histórico (nada é apagado). Responde no contrato AssistantResponse.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { reverseAndDescribe } from '@/lib/ai/orchestrator';
import { errorResponse } from '@/lib/api/assistant-response';
import { getSubscriptionAccess, writeDeniedMessage } from '@/lib/subscription';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ assistant: errorResponse('unauthenticated', 'Você precisa estar logado.') }, { status: 401 });

  const body = await request.json().catch(() => null);
  const operationId = body?.operationId;
  if (typeof operationId !== 'string' || !UUID.test(operationId)) {
    return NextResponse.json({ assistant: errorResponse('validation', 'Não sei qual operação desfazer.') }, { status: 400 });
  }

  const access = await getSubscriptionAccess(supabase);
  if (!access.canWrite) {
    return NextResponse.json({ assistant: errorResponse('subscription_required', writeDeniedMessage(access.reason)) }, { status: 403 });
  }

  const { data: settlement } = await supabase
    .from('settlements')
    .select('id, customers(name)')
    .eq('id', operationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!settlement) {
    return NextResponse.json({ assistant: errorResponse('not_found', 'Não achei essa operação para desfazer.') }, { status: 404 });
  }

  const customerName = (settlement.customers as unknown as { name: string } | null)?.name;
  const outcome = await reverseAndDescribe(supabase, settlement.id, customerName, 'Desfazer pelo app', 'manual');
  if (outcome.error) console.warn('[operations/reverse]', outcome.error);

  const assistant =
    outcome.executionStatus === 'executed'
      ? { status: 'executed' as const, message: outcome.humanResponse, undoAvailable: false, operationId: outcome.operation?.id, operationType: 'reversal' as const }
      : errorResponse(outcome.errorCode ?? 'internal', outcome.humanResponse);
  return NextResponse.json({ assistant }, { status: assistant.status === 'executed' ? 200 : 422 });
}
