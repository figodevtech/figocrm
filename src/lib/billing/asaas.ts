import { timingSafeEqual } from 'node:crypto';
import { PLAN, type BillingProvider, type NormalizedBillingEvent, type ProviderSubscription } from '@/lib/billing/types';

type AsaasConfig = { apiKey: string; webhookToken: string; baseUrl: string };
type AsaasObject = Record<string, unknown>;

function record(value: unknown): AsaasObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AsaasObject : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isoDay(value: unknown): string | undefined {
  const day = string(value);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00.000Z` : undefined;
}

function nextMonth(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay))).toISOString();
}

function secureEquals(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function asaasDateTime(value: string | undefined): string {
  const date = value ? new Date(value.length === 10 ? `${value}T15:00:00.000Z` : value) : new Date(Date.now() + 10 * 60_000);
  if (Number.isNaN(date.getTime())) throw new Error('Data da primeira cobrança inválida.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const valueOf = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')} ${valueOf('hour')}:${valueOf('minute')}:${valueOf('second')}`;
}

export function asaasConfig(): AsaasConfig | null {
  const apiKey = process.env.ASAAS_API_KEY;
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const baseUrl = process.env.ASAAS_API_BASE_URL || 'https://api-sandbox.asaas.com/v3';
  if (!apiKey || !webhookToken || /^(?:your[-_]|replace[-_]|placeholder|changeme)/i.test(webhookToken)
    || !['https://api-sandbox.asaas.com/v3', 'https://api.asaas.com/v3'].includes(baseUrl)) return null;
  if (baseUrl.includes('sandbox') ? !apiKey.startsWith('$aact_hmlg_') : !apiKey.startsWith('$aact_prod_')) return null;
  return { apiKey, webhookToken, baseUrl };
}

export class AsaasProvider implements BillingProvider {
  readonly name = 'asaas';
  constructor(private readonly config: AsaasConfig) {}

  private async request(path: string, init: RequestInit = {}): Promise<AsaasObject> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'FigoCRM/1.0 (Node.js)', access_token: this.config.apiKey, ...init.headers },
      cache: 'no-store',
      signal: init.signal || AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Asaas HTTP ${response.status}`);
    const raw = await response.text();
    return raw ? record(JSON.parse(raw)) : {};
  }

  async createCustomer(input: { userId: string; email: string; name?: string }): Promise<{ providerCustomerId: string }> {
    const result = await this.request('/customers', { method: 'POST', body: JSON.stringify({
      name: input.name || input.email, email: input.email, externalReference: input.userId,
    }) });
    const id = string(result.id);
    if (!id) throw new Error('Asaas retornou cliente sem ID.');
    return { providerCustomerId: id };
  }

  async createSubscription(): Promise<ProviderSubscription> {
    throw new Error('A assinatura é criada no checkout recorrente.');
  }

  async createCheckout(input: { userId: string; email: string; successUrl: string; cancelUrl: string; nextDueDate?: string }) {
    const dueDate = asaasDateTime(input.nextDueDate);
    const result = await this.request('/checkouts', { method: 'POST', body: JSON.stringify({
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      minutesToExpire: 60,
      items: [{ name: PLAN.name, quantity: 1, value: PLAN.priceCents / 100 }],
      subscription: { cycle: 'MONTHLY', nextDueDate: dueDate },
      customerData: { email: input.email },
      externalReference: input.userId,
      callback: { successUrl: input.successUrl, cancelUrl: input.cancelUrl, expiredUrl: input.cancelUrl },
    }) });
    const id = string(result.id);
    const url = string(result.link) || (id
      ? `${this.config.baseUrl.includes('sandbox') ? 'https://sandbox.asaas.com' : 'https://asaas.com'}/checkoutSession/show?id=${encodeURIComponent(id)}`
      : undefined);
    if (!id || !url) throw new Error('Asaas retornou checkout incompleto.');
    return { providerSessionId: id, url, externalReference: input.userId };
  }

  async cancelSubscription(input: { providerSubscriptionId: string; atPeriodEnd: boolean }): Promise<void> {
    if (!input.atPeriodEnd) throw new Error('Cancelamento imediato não está disponível.');
    await this.request(`/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`, {
      method: 'PUT', body: JSON.stringify({ status: 'INACTIVE' }),
    });
  }

  async reactivateSubscription(input: { providerSubscriptionId: string }): Promise<void> {
    const current = await this.request(`/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`);
    const due = string(current.nextDueDate);
    if (!due || new Date(`${due}T23:59:59.000Z`).getTime() <= Date.now())
      throw new Error('A recorrência precisa de uma nova data futura.');
    await this.request(`/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`, {
      method: 'PUT', body: JSON.stringify({ status: 'ACTIVE', nextDueDate: due }),
    });
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null> {
    const row = await this.request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
    const id = string(row.id);
    if (!id) return null;
    return {
      providerSubscriptionId: id,
      providerCustomerId: string(row.customer) || '',
      status: row.status === 'ACTIVE' ? 'active' : 'canceled',
      currentPeriodEnd: isoDay(row.nextDueDate),
      cancelAtPeriodEnd: row.status !== 'ACTIVE',
    };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<NormalizedBillingEvent | null> {
    const token = headers.get('asaas-access-token') || '';
    if (!secureEquals(token, this.config.webhookToken)) return null;
    let body: AsaasObject;
    try { body = record(JSON.parse(rawBody)); } catch { return null; }
    const id = string(body.id);
    const kind = string(body.event);
    if (!id || !kind) return null;
    const payment = record(body.payment);
    const checkout = record(body.checkout);
    const sub = record(body.subscription);
    const providerSubscriptionId = string(payment.subscription) || string(sub.id)
      || (typeof body.subscription === 'string' ? body.subscription : undefined);
    const providerCheckoutId = string(checkout.id) || string(payment.checkoutSession)
      || (typeof body.checkout === 'string' ? body.checkout : undefined);
    const base = {
      provider: this.name, eventId: id, providerSubscriptionId, providerCheckoutId,
      providerCustomerId: string(payment.customer) || string(sub.customer) || string(checkout.customer),
      userId: string(payment.externalReference) || string(checkout.externalReference) || string(sub.externalReference),
      occurredAt: string(body.dateCreated) || new Date().toISOString(), raw: body,
    };
    if (kind.startsWith('CHECKOUT_')) {
      const type = ({ CHECKOUT_CREATED: 'checkout.created', CHECKOUT_PAID: 'checkout.paid',
        CHECKOUT_CANCELED: 'checkout.canceled', CHECKOUT_EXPIRED: 'checkout.expired' } as const)[kind as 'CHECKOUT_CREATED'];
      return { ...base, type: type || 'ignored' };
    }
    if (kind === 'SUBSCRIPTION_CREATED') return { ...base, type: 'subscription.created' };
    if (kind === 'PAYMENT_CONFIRMED' || kind === 'PAYMENT_RECEIVED') {
      if (!providerSubscriptionId) return { ...base, type: 'ignored' };
      let periodEnd = isoDay(payment.dueDate);
      if (periodEnd) periodEnd = nextMonth(String(payment.dueDate));
      const current = await this.request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
      if (current.cycle !== 'MONTHLY' || current.billingType !== 'CREDIT_CARD'
        || Number(current.value) !== PLAN.priceCents / 100) return { ...base, type: 'ignored' };
      periodEnd = periodEnd || isoDay(current.nextDueDate);
      if (!periodEnd) return { ...base, type: 'ignored' };
      return { ...base, type: kind === 'PAYMENT_CONFIRMED' ? 'subscription.activated' : 'subscription.renewed',
        userId: base.userId || string(current.externalReference), currentPeriodEnd: periodEnd };
    }
    if (kind === 'PAYMENT_OVERDUE' || kind === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED')
      return { ...base, type: 'payment.failed' };
    if (kind === 'SUBSCRIPTION_INACTIVATED' || kind === 'SUBSCRIPTION_DELETED')
      return { ...base, type: 'subscription.canceled', cancelAtPeriodEnd: true };
    return { ...base, type: 'ignored' };
  }
}

export function createAsaasProvider(): BillingProvider | null {
  const config = asaasConfig();
  return config ? new AsaasProvider(config) : null;
}
