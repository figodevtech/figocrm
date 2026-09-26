// Read-only operational snapshot. Run periodically with a server-only service role.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { createAdminClient } from '../src/lib/supabase/admin';

async function main() {
const admin = createAdminClient();
if (!admin) throw new Error('Supabase service role não configurada.');
const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const activationDeadline = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const { data: events, error: eventError } = await admin.from('billing_events')
  .select('event_type,error,processed_at,received_at').gte('received_at', since).limit(10000);
if (eventError) throw new Error(eventError.message);
const rows = events ?? [];
const count = (test: (row: typeof rows[number]) => boolean) => rows.filter(test).length;
const { data: paid, error: paidError } = await admin.from('billing_checkout_sessions')
  .select('user_id,provider_subscription_id,plan_code,price_cents,created_at')
  .eq('status', 'paid').lt('created_at', activationDeadline).gte('created_at', since).limit(1000);
if (paidError) throw new Error(paidError.message);
let paidWithoutActivation = 0;
for (const checkout of paid ?? []) {
  const { data: sub, error } = await admin.from('subscriptions')
    .select('status,provider_subscription_id,plan_code,price_cents')
    .eq('user_id', checkout.user_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!sub || sub.status !== 'active' || sub.plan_code !== checkout.plan_code
    || sub.price_cents !== checkout.price_cents
    || (checkout.provider_subscription_id && sub.provider_subscription_id !== checkout.provider_subscription_id))
    paidWithoutActivation++;
}
const report = {
  window_hours: 24,
  webhooks: rows.length,
  processed: count((row) => !!row.processed_at && !row.error),
  failed: count((row) => !row.processed_at && !!row.error),
  terminal_ignored: count((row) => !!row.processed_at && row.error?.startsWith('terminal_ignored:')),
  payment_plan_mismatch: count((row) => row.error === 'payment_plan_mismatch'),
  subscription_not_found: count((row) => row.error === 'subscription_not_found'),
  checkout_paid_without_activation: paidWithoutActivation,
  canceled: count((row) => row.event_type === 'subscription.canceled'),
  activated: count((row) => row.event_type === 'subscription.activated'),
  renewed: count((row) => row.event_type === 'subscription.renewed'),
  duplicate_deliveries: 'not_persisted',
};
console.log(JSON.stringify({ kind: 'billing_operational_snapshot', ...report }));
if (report.payment_plan_mismatch > 0 || report.checkout_paid_without_activation > 0)
  process.exitCode = 2;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'billing report failed'); process.exitCode = 1; });
