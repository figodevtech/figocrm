// src/lib/billing/registry.ts
// Provedor de cobrança ativo (BILLING_PROVIDER). Asaas só fica disponível com chave e token configurados.

import type { BillingProvider } from '@/lib/billing/types';
import { createAsaasProvider } from '@/lib/billing/asaas';

const providers = new Map<string, BillingProvider>();

/** Registra uma implementação (usado pelo provedor escolhido e pelos testes). */
export function registerBillingProvider(provider: BillingProvider): void {
  providers.set(provider.name, provider);
}

export function getBillingProvider(): BillingProvider | null {
  const name = process.env.BILLING_PROVIDER;
  if (!name) return null;
  if (name === 'asaas') return createAsaasProvider();
  return providers.get(name) ?? null;
}
