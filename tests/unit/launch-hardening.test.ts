import assert from 'node:assert/strict';
import { isInvalidSessionError, isSupabaseSessionCookie } from '../../src/lib/auth/invalid-session';
import { guardRedirect } from '../../src/lib/auth/redirects';
import { billingReferences, compareAsaasSubscription, mayTerminallyIgnore } from '../../src/lib/billing/reconciliation';

for (const code of ['refresh_token_not_found', 'invalid_refresh_token', 'refresh_token_already_used', 'session_not_found'])
  assert.equal(isInvalidSessionError({ code }), true, code);
assert.equal(isInvalidSessionError({ message: 'Invalid Refresh Token: Refresh Token Not Found' }), true);
for (const error of [{ code: 'unexpected_failure', message: 'Network request failed' }, { message: 'fetch failed' }, null])
  assert.equal(isInvalidSessionError(error), false);
assert.equal(isSupabaseSessionCookie('sb-project-auth-token'), true);
assert.equal(isSupabaseSessionCookie('sb-project-auth-token.1'), true);
assert.equal(isSupabaseSessionCookie('sb-project-code-verifier'), false);
assert.equal(guardRedirect('/app', '', false), '/login?next=%2Fapp');
assert.equal(guardRedirect('/login', '', false), null);
assert.equal(guardRedirect('/termos', '', false), null);
assert.equal(guardRedirect('/pagina-inexistente', '', false), null);
assert.equal(guardRedirect('/app', '', true), null);

const references = billingReferences({
  checkout: { id: 'checkout-1', externalReference: 'user-1' },
  payment: { subscription: 'sub-1', customer: 'customer-1' },
});
assert.deepEqual(references, {
  checkoutId: 'checkout-1', subscriptionId: 'sub-1', customerId: 'customer-1', externalReference: 'user-1',
});
assert.equal(mayTerminallyIgnore('subscription_not_found', '2026-09-20T00:00:00Z', Date.parse('2026-09-22T00:00:00Z')), true);
assert.equal(mayTerminallyIgnore('subscription_not_found', '2026-09-21T12:00:00Z', Date.parse('2026-09-22T00:00:00Z')), false);
assert.equal(mayTerminallyIgnore('payment_plan_mismatch', '2026-09-20T00:00:00Z', Date.parse('2026-09-22T00:00:00Z')), false);
const local = { status: 'active', provider_subscription_id: 'sub-1', provider_customer_id: 'cus-1', price_cents: 3990 };
assert.deepEqual(compareAsaasSubscription(local, { providerSubscriptionId: 'sub-1', providerCustomerId: 'cus-1', status: 'active', cancelAtPeriodEnd: false, priceCents: 3990 }), []);
assert.deepEqual(compareAsaasSubscription(local, { providerSubscriptionId: 'sub-2', providerCustomerId: 'cus-1', status: 'active', cancelAtPeriodEnd: false, priceCents: 3990 }), ['subscription_id_mismatch']);
assert.deepEqual(compareAsaasSubscription(local, { providerSubscriptionId: 'sub-1', providerCustomerId: 'cus-1', status: 'canceled', cancelAtPeriodEnd: true, priceCents: 8990 }), ['asaas_inactive_figo_active', 'price_mismatch']);
console.log('launch hardening rules: ok');
