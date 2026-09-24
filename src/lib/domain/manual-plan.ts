// src/lib/domain/manual-plan.ts
// Contas dos formulários manuais (em centavos), para a tela avisar ANTES de salvar.
// A validação que vale continua no domínio/banco (DealCommand → balanço → RPC); isto só evita
// que o usuário mande algo que vai ser recusado.

import { formatBRL } from '@/lib/format';

export interface PlanCheck {
  ok: boolean;
  message: string;
}

/** "4 × R$ 550 = R$ 2.200" — só fecha se bater exatamente com o saldo. */
export function checkInstallmentPlan(remainingCents: number, count: number | null, valueCents: number | null): PlanCheck {
  if (remainingCents <= 0) return { ok: false, message: 'Não há saldo para parcelar.' };
  if (!count || !Number.isInteger(count) || count < 1) return { ok: false, message: 'Informe a quantidade de parcelas.' };
  if (count > 120) return { ok: false, message: 'No máximo 120 parcelas.' };
  if (valueCents === null || valueCents <= 0) return { ok: false, message: 'Informe o valor de cada parcela.' };
  const total = count * valueCents;
  const line = `${count} × ${formatBRL(valueCents / 100)} = ${formatBRL(total / 100)}`;
  if (total === remainingCents) return { ok: true, message: line };
  const diff = remainingCents - total;
  return {
    ok: false,
    message: `${line}. ${diff > 0 ? `Faltam ${formatBRL(diff / 100)}` : `Passa ${formatBRL(-diff / 100)}`} para fechar ${formatBRL(remainingCents / 100)}.`,
  };
}

/** Valor de cada parcela quando divide exato; senão null (o usuário ajusta). */
export function suggestInstallmentValue(remainingCents: number, count: number | null): number | null {
  if (!count || count < 1 || remainingCents <= 0) return null;
  return remainingCents % count === 0 ? remainingCents / count : null;
}

/** Venda: quanto falta definir depois do dinheiro e da mercadoria recebidos. */
export function saleRemaining(totalCents: number, cashCents: number, itemInCents: number): number {
  return totalCents - cashCents - itemInCents;
}

export type TradeDirection = 'received' | 'paid' | 'even';

/** Troca: quem recebe a diferença sai dos valores negociados. */
export function tradeDifference(outCents: number, inCents: number): { direction: TradeDirection; balanceCents: number } {
  if (outCents === inCents) return { direction: 'even', balanceCents: 0 };
  return outCents > inCents ? { direction: 'received', balanceCents: outCents - inCents } : { direction: 'paid', balanceCents: inCents - outCents };
}
