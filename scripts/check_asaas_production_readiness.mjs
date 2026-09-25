// Consultas somente de leitura. Nunca imprime a chave de API nem tokens de webhook.
import nextEnv from '@next/env';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const envResult = nextEnv.loadEnvConfig(process.cwd());
const local = dotenv.parse(readFileSync('.env.local'));
const remoteFile = '.env.production.audit.local';
const remote = existsSync(remoteFile) ? dotenv.parse(readFileSync(remoteFile)) : null;
const unescapeKey = (value) => (value || '').replace(/^\\(?=\$aact_)/, '');

const key = unescapeKey(local.ASAAS_API_KEY);
if (!key.startsWith('$aact_prod_')) {
  console.error(JSON.stringify({ error: 'ASAAS_API_KEY não carregou como chave Asaas de produção.',
    present: Boolean(key), length: key.length, hasProductionMarker: key.includes('aact_prod_'),
    loadedFiles: envResult.loadedEnvFiles?.map((file) => file.path) }));
  process.exitCode = 1;
} else {
  const base = 'https://api.asaas.com/v3';
  const headers = { access_token: key, 'User-Agent': 'FigoCRM/1.0 (Node.js)' };
  const request = async (path) => {
    const response = await fetch(`${base}${path}`, {
      headers, signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  };
  const [account, webhookList] = await Promise.all([
    request('/myAccount/status/'), request('/webhooks?offset=0&limit=100'),
  ]);
  const token = local.ASAAS_WEBHOOK_TOKEN || local.ASAAS_WEBHOOK_TOKEN_ || '';
  const expectedEvents = ['CHECKOUT_CREATED', 'CHECKOUT_PAID', 'CHECKOUT_CANCELED',
    'CHECKOUT_EXPIRED', 'PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED',
    'PAYMENT_OVERDUE', 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
    'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED'];
  const webhooks = Array.isArray(webhookList.body?.data) ? webhookList.body.data : [];
  const matching = webhooks.find((item) => item.url === 'https://figocrm-navy.vercel.app/api/webhooks/payment');
  const webhookDetail = matching?.id ? await request(`/webhooks/${encodeURIComponent(matching.id)}`) : null;
  const summary = webhooks.map((item) => {
    const events = Array.isArray(item.events) ? item.events : [];
    let destination = null;
    try {
      const url = new URL(item.url);
      destination = `${url.origin}${url.pathname}`;
    } catch { /* URL inválida no provedor. */ }
    const returnedToken = item.authToken || (item.id === matching?.id ? webhookDetail?.body?.authToken : null);
    const comparableToken = typeof returnedToken === 'string' && returnedToken.length >= 32
      && !returnedToken.includes('*');
    return {
      destination, enabled: item.enabled === true, interrupted: item.interrupted === true,
      missingEvents: expectedEvents.filter((event) => !events.includes(event)),
      tokenMatchesLocal: comparableToken ? returnedToken === token : null,
    };
  });
  const probe = async (candidate) => {
    if (!candidate) return null;
    const response = await fetch('https://figocrm-navy.vercel.app/api/webhooks/payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': candidate },
      body: JSON.stringify({ id: randomUUID(), event: 'READINESS_PROBE' }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    return response.status;
  };
  const productionTokenProbe = await probe(token);
  const sandboxTokenProbe = await probe(local.ASAAS_WEBHOOK_TOKEN_SANDBOX);
  const matchingSummary = summary.find((item) => item.destination
    === 'https://figocrm-navy.vercel.app/api/webhooks/payment');
  const blockers = [];
  if (local.ASAAS_API_BASE_URL !== base) blockers.push('local_api_url_not_production');
  if (!(process.env.ASAAS_API_KEY || '').startsWith('$aact_prod_')) blockers.push('next_did_not_load_production_key');
  if (!local.ASAAS_WEBHOOK_TOKEN) blockers.push('app_webhook_token_missing');
  if (account.status !== 200 || account.body?.general !== 'APPROVED') blockers.push('production_account_not_approved');
  if (webhookList.status !== 200 || !matchingSummary?.enabled || matchingSummary.interrupted
    || matchingSummary.missingEvents?.length) blockers.push('production_webhook_not_ready');
  if (matchingSummary?.tokenMatchesLocal === false) blockers.push('production_webhook_token_mismatch');
  if (productionTokenProbe !== 200) blockers.push('published_app_rejects_production_token');
  if (sandboxTokenProbe === 200) blockers.push('published_app_still_accepts_sandbox_token');
  if (remote && (remote.ASAAS_API_BASE_URL !== base || unescapeKey(remote.ASAAS_API_KEY) !== key
    || remote.ASAAS_WEBHOOK_TOKEN !== token)) blockers.push('vercel_production_env_differs_from_local');
  console.log(JSON.stringify({
    local: {
      apiBaseUrl: local.ASAAS_API_BASE_URL || null,
      appProductionKeyLoaded: (process.env.ASAAS_API_KEY || '').startsWith('$aact_prod_'),
      appWebhookTokenVariablePresent: Boolean(local.ASAAS_WEBHOOK_TOKEN),
      alternateWebhookTokenVariablePresent: Boolean(local.ASAAS_WEBHOOK_TOKEN_),
      productionWebhookTokenPresent: Boolean(token),
    },
    account: { httpStatus: account.status, general: account.body?.general || null },
    webhookList: { httpStatus: webhookList.status, webhooks: summary },
    deployedEndpoint: { productionTokenProbe, sandboxTokenProbe },
    vercelProduction: remote ? {
      billingProvider: remote.BILLING_PROVIDER || null,
      apiUrlIsProduction: remote.ASAAS_API_BASE_URL === base,
      apiKeyMatchesLocal: unescapeKey(remote.ASAAS_API_KEY) === key,
      webhookTokenMatchesLocal: remote.ASAAS_WEBHOOK_TOKEN === token,
      appUrl: remote.NEXT_PUBLIC_APP_URL || null,
    } : null,
    readyForRealCheckout: blockers.length === 0,
    blockers,
  }, null, 2));
  if (blockers.length) process.exitCode = 1;
}
