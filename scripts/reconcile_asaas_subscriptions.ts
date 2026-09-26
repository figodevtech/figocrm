// Somente leitura: compara o estado contratado no Asaas com subscriptions.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { createAdminClient } from '../src/lib/supabase/admin';
import { getBillingProvider } from '../src/lib/billing/registry';
import { compareAsaasSubscription } from '../src/lib/billing/reconciliation';

async function main() {
  const admin = createAdminClient();
  const provider = getBillingProvider();
  if (!admin || !provider || provider.name !== 'asaas') throw new Error('Asaas e service role devem estar configurados.');
  const { data: subs, error } = await admin.from('subscriptions')
    .select('user_id,status,provider_subscription_id,provider_customer_id,price_cents')
    .eq('provider', 'asaas').in('status', ['active', 'canceled', 'past_due']).limit(200);
  if (error) throw new Error(error.message);
  const findings: Array<{ user_id: string; kind: string; provider_subscription_id: string | null }> = [];
  for (const sub of subs ?? []) {
    const id = sub.provider_subscription_id;
    if (!id) {
      findings.push({ user_id: sub.user_id, kind: 'subscription_id_missing', provider_subscription_id: null });
      continue;
    }
    try {
      const remote = await provider.getSubscription(id);
      for (const kind of compareAsaasSubscription(sub, remote))
        findings.push({ user_id: sub.user_id, kind, provider_subscription_id: id });
    } catch {
      findings.push({ user_id: sub.user_id, kind: 'provider_lookup_failed', provider_subscription_id: id });
    }
  }
  console.log(JSON.stringify({ kind: 'asaas_subscription_reconciliation', checked: subs?.length ?? 0, findings }));
  if (findings.length) process.exitCode = 2;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'reconciliation failed'); process.exitCode = 1; });
