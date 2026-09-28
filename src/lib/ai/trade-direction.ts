import { extractSpokenNumbersDetailed } from '@/lib/voice/numbers';

export type ExplicitTradeDebt = {
  direction: 'inflow' | 'outflow' | undefined;
  confidence: 'explicit' | 'unknown';
  amount?: number;
};

const INFLOW = [
  /\bficou me devendo\b/,
  /\bme ficou devendo\b/,
  /\bme deve\b/,
  /\bficou de me pagar\b/,
  /\bficou devendo\b.{0,50}?\b(?:pra|para) mim\b/,
  /\b(?:ficaram|faltaram|sobraram|ficou|sobrou)\b.{0,50}?\b(?:pra|para) (?:ele|ela|[a-z]+) me pagar\b/,
];

const OUTFLOW = [
  /\b(?:eu )?fiquei devendo\b/,
  /\b(?:eu )?(?:ainda )?devo\b/,
  /\bfiquei de pagar\b/,
  /\b(?:faltaram|sobraram|ficaram|ficou|sobrou)\b.{0,50}?\b(?:pra|para) eu pagar\b/,
  /\b(?:faltaram|sobraram|ficaram|ficou|sobrou)\b.{0,50}?\bque eu vou pagar\b/,
  /\b(?:eu )?vou pagar(?: mais)?\b/,
  /\bfiquei com\b.{0,50}?\b(?:pra|para) pagar\b/,
];

function firstMatch(text: string, patterns: RegExp[]): RegExpExecArray | undefined {
  return patterns.map((pattern) => pattern.exec(text)).filter((match): match is RegExpExecArray => !!match)
    .sort((a, b) => a.index - b.index)[0];
}

/** Identifica somente dívida explicitamente atribuída a uma das partes da troca. */
export function inferTradeBalanceDirection(spokenText: string): ExplicitTradeDebt {
  const text = spokenText.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const inflow = firstMatch(text, INFLOW);
  const outflow = firstMatch(text, OUTFLOW);
  if (!!inflow === !!outflow) return { direction: undefined, confidence: 'unknown' };
  const match = inflow ?? outflow!;
  const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 45)
    .split(/[.!?;,]|\b(?:vence|vencimento|dia)\b/)[0];
  const phrase = `${match[0]} ${tail}`;
  const number = extractSpokenNumbersDetailed(phrase).find(({ value }) => value > 0);
  const amount = number ? number.value < 100 && !number.literal ? number.value * 1000 : number.value : undefined;
  return { direction: inflow ? 'inflow' : 'outflow', confidence: 'explicit', amount };
}

/** Diferença mencionada sem credor/devedor ou agente claro do pagamento. */
export function hasUnattributedTradeDifference(spokenText: string): boolean {
  const text = spokenText.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (inferTradeBalanceDirection(spokenText).confidence === 'explicit') return false;
  const unclear = /\b(?:ficaram|faltaram|sobrou|sobraram|diferenca|deu\s+\d+\s+(?:mil\s+)?de volta)\b/.test(text);
  const clearPayment = /\b(?:ele|ela)\s+(?:me\s+)?(?:voltou|deu|completou|mandou|inteirou)\b|\bme voltou\b|\brecebi\b|\b(?:eu\s+)?(?:completei|voltei|paguei|inteirei)\b|\beu dei\s+\d+\b/.test(text);
  return unclear && !clearPayment;
}
