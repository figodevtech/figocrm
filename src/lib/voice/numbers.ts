// src/lib/voice/numbers.ts
// Extração determinística de números falados em português ("vinte e seis", "dois mil e quinhentos",
// "1.500", "3 mil", "um pau") — base do grounding que impede a LLM de inventar valores.

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
  meia: 0.5, meio: 0.5,
};

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Converte "1.500", "1.500,50", "2,5" em número. */
function parseNumericToken(token: string): number | null {
  // "5x" (cinco vezes) conta como 5
  let t = token.replace(/^(\d+)x$/, '$1');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Retorna todos os números mencionados no texto, na ordem, já combinando multiplicadores
 * ("3 mil" → 3000, "dois mil e quinhentos" → 2500, "um pau" → 1000).
 */
export interface SpokenNumber {
  value: number;
  /** Seguido de "reais"/"real"/"conto(s)": valor literal, nunca lido em milhares. */
  literal: boolean;
}

export function extractSpokenNumbers(text: string): number[] {
  return extractSpokenNumbersDetailed(text).map((n) => n.value);
}

const LITERAL_UNITS = new Set(['reais', 'real', 'conto', 'contos', 'centavos']);
const ARTICLE_NUMBER_CONTEXT = new Set(['mil', 'pau', 'real', 'conto', 'vez', 'parcela', 'e']);

export function extractSpokenNumbersDetailed(text: string): SpokenNumber[] {
  // Pontuação seguida de espaço separa números ("mil e quatrocentos, sessenta" são dois valores)
  const tokens = stripAccents(text)
    .replace(/r\$\s*/g, ' ')
    .replace(/[.,;:!?]+(\s|$)/g, ' | ')
    .split(/[^a-z0-9.,|]+/)
    .filter(Boolean);

  const results: SpokenNumber[] = [];
  let current: number | null = null; // grupo abaixo de mil em construção
  let total: number | null = null; // acumulado com "mil"

  const flush = (nextToken?: string) => {
    if (current !== null || total !== null) {
      results.push({ value: (total ?? 0) + (current ?? 0), literal: !!nextToken && LITERAL_UNITS.has(nextToken) });
    }
    current = null;
    total = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok === '|') {
      flush();
      continue;
    }

    // "um/uma" como artigo ("um fone") não é número; só conta antes de unidade ("um mil", "uma parcela")
    if ((tok === 'um' || tok === 'uma') && current === null && total === null && !ARTICLE_NUMBER_CONTEXT.has(tokens[i + 1] ?? '')) {
      flush();
      continue;
    }

    if (tok === 'e' && (current !== null || total !== null)) {
      const next = tokens[i + 1];
      if (next && (UNITS[next] !== undefined || /^\d/.test(next))) continue;
      flush(next);
      continue;
    }

    if (tok === 'mil') {
      const base = current ?? 1;
      total = (total ?? 0) + base * 1000;
      current = null;
      continue;
    }

    if ((tok === 'pau' || tok === 'paus') && (current !== null || total !== null)) {
      total = ((total ?? 0) + (current ?? 0)) * 1000;
      current = null;
      flush();
      continue;
    }

    if (/^\d/.test(tok)) {
      const n = parseNumericToken(tok);
      if (n === null) {
        flush();
        continue;
      }
      if (current !== null && total === null) flush();
      current = (current ?? 0) + n;
      continue;
    }

    const word = UNITS[tok];
    if (word !== undefined && !(word === 0.5 && current === null && total === null)) {
      if (current !== null && word >= 100 && current < 100) flush();
      current = (current ?? 0) + word;
      continue;
    }

    flush(tok);
  }
  flush();
  return results;
}

/**
 * Conjunto de valores monetários "ancorados" no texto: cada número falado, sua leitura em milhares
 * (convenção do setor: "por 26" em veículo = 26 mil) e combinações aritméticas de até três termos
 * (entrada + parcelas, total − entrada, quantidade × valor da parcela).
 */
export function groundedMonetaryValues(text: string, extra: number[] = []): Set<number> {
  const raw = [...extractSpokenNumbersDetailed(text), ...extra.map((value) => ({ value, literal: false }))];
  const base = new Set<number>();
  for (const { value: n, literal } of raw) {
    if (n <= 0) continue;
    base.add(round2(n));
    // "quinze conto" / "68 reais" são literais: nunca viram milhar
    if (n < 1000 && !literal) base.add(round2(n * 1000));
  }

  const values = [...base];
  const grounded = new Set<number>(values);
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      const a = values[i];
      const b = values[j];
      grounded.add(round2(a + b));
      grounded.add(round2(Math.abs(a - b)));
      grounded.add(round2(a * b));
      if (b !== 0) grounded.add(round2(a / b));
      for (let k = 0; k < values.length; k++) {
        const c = values[k];
        grounded.add(round2(a + b + c));
        grounded.add(round2(Math.abs(a - b - c)));
        grounded.add(round2(a * b + c));
      }
    }
  }
  return grounded;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
