// src/lib/billing/registry.ts
// Provedor de cobrança ativo (BILLING_PROVIDER). Nenhum implementado ainda: retorna null e todo fluxo
// de cobrança responde "não configurado" — nunca ativa assinatura por conta própria.

import type { BillingProvider } from '@/lib/billing/types';

const providers = new Map<string, BillingProvider>();

/** Registra uma implementação (usado pelo provedor escolhido e pelos testes). */
export function registerBillingProvider(provider: BillingProvider): void {
  providers.set(provider.name, provider);
}

export function getBillingProvider(): BillingProvider | null {
  const name = process.env.BILLING_PROVIDER;
  if (!name) return null;
  return providers.get(name) ?? null;
}
