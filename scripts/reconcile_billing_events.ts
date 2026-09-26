// Dry run by default. --apply closes only 24h-old, uncorrelated subscription_not_found events.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { createAdminClient } from '../src/lib/supabase/admin';
import { billingReferences, mayTerminallyIgnore } from '../src/lib/billing/reconciliation';

async function main() {
const admin = createAdminClient();
if (!admin) throw new Error('Supabase service role não configurada.');
const apply = process.argv.includes('--apply');
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const { data: events, error } = await admin.from('billing_events')
  .select('id,provider,event_type,received_at,error,payload')
  .is('processed_at', null).eq('error', 'subscription_not_found')
  .lt('received_at', cutoff).order('received_at').limit(100);
if (error) throw new Error(error.message);

const summary = { reviewed: 0, terminalCandidates: 0, terminalApplied: 0, needsInvestigation: 0 };
for (const event of events ?? []) {
  if (!mayTerminallyIgnore(event.error, event.received_at)) continue;
  summary.reviewed++;
  const refs = billingReferences(event.payload);
  if (!refs.checkoutId && !refs.subscriptionId && !refs.customerId && !refs.externalReference) {
    summary.needsInvestigation++;
    console.warn(JSON.stringify({ kind: 'billing_missing_references', event_id: event.id }));
    continue;
  }
  if (refs.externalReference && !/^[0-9a-f-]{36}$/i.test(refs.externalReference)) {
    summary.needsInvestigation++;
    console.warn(JSON.stringify({ kind: 'billing_invalid_external_reference', event_id: event.id }));
    continue;
  }
  let correlated = false;
  if (refs.checkoutId) {
    const result = await admin.from('billing_checkout_sessions').select('id').eq('provider', event.provider)
      .eq('provider_checkout_id', refs.checkoutId).limit(1);
    if (result.error) throw new Error(result.error.message);
    correlated ||= !!result.data?.length;
  }
  if (refs.subscriptionId) {
    const result = await admin.from('subscriptions').select('user_id').eq('provider', event.provider)
      .eq('provider_subscription_id', refs.subscriptionId).limit(1);
    if (result.error) throw new Error(result.error.message);
    correlated ||= !!result.data?.length;
    const checkout = await admin.from('billing_checkout_sessions').select('id').eq('provider', event.provider)
      .eq('provider_subscription_id', refs.subscriptionId).limit(1);
    if (checkout.error) throw new Error(checkout.error.message);
    correlated ||= !!checkout.data?.length;
  }
  if (refs.customerId) {
    const result = await admin.from('subscriptions').select('user_id').eq('provider', event.provider)
      .eq('provider_customer_id', refs.customerId).limit(1);
    if (result.error) throw new Error(result.error.message);
    correlated ||= !!result.data?.length;
  }
  if (refs.externalReference && /^[0-9a-f-]{36}$/i.test(refs.externalReference)) {
    const result = await admin.from('profiles').select('id').eq('id', refs.externalReference).limit(1);
    if (result.error) throw new Error(result.error.message);
    correlated ||= !!result.data?.length;
  }
  if (correlated) {
    summary.needsInvestigation++;
    console.warn(JSON.stringify({ kind: 'billing_reconciliation_required', event_id: event.id, event_type: event.event_type }));
    continue;
  }
  summary.terminalCandidates++;
  if (!apply) continue;
  const result = await admin.from('billing_events')
    .update({ processed_at: new Date().toISOString(), error: 'terminal_ignored:subscription_not_found' })
    .eq('id', event.id).eq('error', 'subscription_not_found').is('processed_at', null).select('id');
  if (result.error) throw new Error(result.error.message);
  summary.terminalApplied += result.data?.length ?? 0;
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', ...summary }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'reconciliation failed'); process.exitCode = 1; });
