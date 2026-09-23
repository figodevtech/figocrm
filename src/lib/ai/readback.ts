// src/lib/ai/readback.ts
// Leitura de volta ("Entendi: ... Confirma?") usada quando a interpretação veio do fallback por regras.
// O parser determinístico não é confiável para fala livre; por isso, sem a LLM, nenhuma escrita é
// executada sem o usuário confirmar exatamente o que foi entendido.

import type { InterpretedVoiceCommand } from '@/lib/ai/interpreter';
import { toCents } from '@/lib/finance/money';

function brl(value: number): string {
  const cents = toCents(value);
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const METHOD: Record<string, string> = { pix: 'no Pix', cash: 'em dinheiro', bank_transfer: 'na transferência', card: 'no cartão' };

export function describeForReadback(cmd: InterpretedVoiceCommand): string {
  const who = cmd.counterparty?.name ? ` ${cmd.counterparty.name}` : '';
  const method = cmd.paymentMethod ? ` ${METHOD[cmd.paymentMethod] ?? ''}` : '';
  const parts: string[] = [];

  switch (cmd.intent) {
    case 'create_sale': {
      parts.push(`venda ${cmd.item ? `de ${cmd.item} ` : ''}para${who}${cmd.totalValue ? ` por ${brl(cmd.totalValue)}` : ''}`);
      if (cmd.cashIn) parts.push(`entrou ${brl(cmd.cashIn)}${method}`);
      if (cmd.installmentsCount && cmd.installmentAmount) parts.push(`${cmd.installmentsCount}x de ${brl(cmd.installmentAmount)}${cmd.dueDay ? ` todo dia ${cmd.dueDay}` : ''}`);
      break;
    }
    case 'create_trade': {
      parts.push(`troca com${who}: sai ${cmd.itemOut ?? '?'}, entra ${cmd.itemIn ?? '?'}`);
      if (cmd.direction === 'inflow' && cmd.tradeBalance) parts.push(`você recebe ${brl(cmd.tradeBalance)} de volta`);
      if (cmd.direction === 'outflow' && cmd.tradeBalance) parts.push(`você paga ${brl(cmd.tradeBalance)} de volta`);
      if (cmd.direction === 'even') parts.push('sem volta');
      break;
    }
    case 'create_purchase':
      parts.push(`compra de ${cmd.item ?? 'mercadoria'} com${who}${cmd.totalValue ? ` por ${brl(cmd.totalValue)}` : ''}`);
      break;
    case 'register_payment':
    case 'register_partial_payment':
      parts.push(cmd.amount ? `recebimento de ${brl(cmd.amount)} do${who}${method}` : `quitação da dívida do${who}`);
      break;
    case 'register_adjustment':
      parts.push(`abatimento de ${brl(cmd.amount ?? cmd.adjustmentAmount ?? 0)} na dívida do${who}`);
      break;
    case 'update_due_date':
      parts.push(`vencimento do${who} para o dia ${cmd.dueDay ?? '?'}`);
      break;
    case 'renegotiate_debt':
      parts.push(`renegociar a dívida do${who} em ${cmd.installmentsCount ?? '?'}${cmd.installmentAmount ? ` de ${brl(cmd.installmentAmount)}` : ' parcelas'}${cmd.dueDay ? ` todo dia ${cmd.dueDay}` : ''}`);
      break;
    case 'reverse_operation':
      parts.push(`desfazer ${cmd.operationKind === 'adjustment' ? 'o abatimento' : 'o pagamento'}${cmd.amount ? ` de ${brl(cmd.amount)}` : ''} do${who}`);
      break;
    default:
      parts.push('essa operação');
  }
  return `Entendi: ${parts.join(', ')}. Confirma?`;
}

const YES = /^(sim|isso|isso mesmo|confirma|confirmo|confirmado|pode|pode lancar|pode sim|certo|ta certo|esta certo|ok|okay|exato|correto|beleza|fechou|positivo)\b/;
const NO = /^(nao|errado|ta errado|esta errado|cancela|cancelar|negativo|deixa|esquece)\b/;

/** Resposta curta de confirmação: 'yes', 'no' ou null (não é resposta — tratar como comando novo). */
export function confirmationAnswer(text: string): 'yes' | 'no' | null {
  const t = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.split(' ').length > 5) return null;
  if (NO.test(t)) return 'no';
  if (YES.test(t)) return 'yes';
  return null;
}
