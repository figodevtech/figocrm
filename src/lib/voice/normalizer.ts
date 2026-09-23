// src/lib/voice/normalizer.ts
// Normalizador textual para linguagem e gírias de vendedores/revendedores brasileiros

export interface NormalizedVoiceInput {
  originalText: string;
  normalizedText: string;
  detectedSlang: string[];
}

/**
 * Normaliza expressões populares de dinheiro e gírias comerciais em português brasileiro.
 */
export function normalizeSpokenText(rawText: string): NormalizedVoiceInput {
  if (!rawText) {
    return { originalText: '', normalizedText: '', detectedSlang: [] };
  }

  const detectedSlang: string[] = [];
  let text = rawText.toLowerCase().trim();

  // Substituição de pontuações redundantes
  text = text.replace(/[\r\n]+/g, ' ');

  // 1. Gírias de valores em "pau" (1 pau = 1.000)
  const pauRegex = /(\d+)\s*(pau|paus)\b/gi;
  if (pauRegex.test(text)) {
    detectedSlang.push('valor_em_pau');
    text = text.replace(pauRegex, (_match, num) => {
      const val = parseInt(num, 10) * 1000;
      return `${val} reais`;
    });
  }

  // "um pau", "dois pau", "meio pau"
  if (text.includes('meio pau')) {
    detectedSlang.push('meio_pau');
    text = text.replace(/\bmeio\s+pau\b/gi, '500 reais');
  }
  if (text.includes('um pau')) {
    detectedSlang.push('um_pau');
    text = text.replace(/\bum\s+pau\b/gi, '1000 reais');
  }

  // 2. Gírias de valores em "conto" (1 conto = 1 real)
  const contoRegex = /(\d+)\s*(conto|contos)\b/gi;
  if (contoRegex.test(text)) {
    detectedSlang.push('valor_em_conto');
    text = text.replace(contoRegex, '$1 reais');
  }

  // 3. Expressões de Troca / Permuta
  if (/\bpau\s+a\s+pau\b/gi.test(text) || /\bchave\s+na\s+chave\b/gi.test(text) || /\bmano\s+a\s+mano\b/gi.test(text)) {
    detectedSlang.push('troca_seca');
    text = text.replace(/\b(pau\s+a\s+pau|chave\s+na\s+chave|mano\s+a\s+mano)\b/gi, 'troca sem volta');
  }

  // 4. Voltas financeiras
  if (/\bvoltou\s+(\d+)\s*mil\b/gi.test(text)) {
    text = text.replace(/\bvoltou\s+(\d+)\s*mil\b/gi, 'voltou $1000 reais');
  }

  return {
    originalText: rawText,
    normalizedText: text,
    detectedSlang,
  };
}
