// src/lib/ai/disambiguation.ts
// Desambiguação Inteligente e Análise de Confiança — Fase 31 do FigoCRM
// Classifica intenções em high, medium, low.
// Regra de segurança inegociável: Ações financeiras com confiança 'low' NUNCA são gravadas no banco.

import { AmbiguityItem, AmbiguityType } from '@/types/deal-command';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface DisambiguationCheckResult {
  confidence: ConfidenceLevel;
  requiresConfirmation: boolean;
  ambiguities: AmbiguityItem[];
  suggestedPrompt?: string;
  isDestructive: boolean;
}

/**
 * Avalia o texto falado e a interpretação preliminar para detectar ambiguidades e riscos operacionais.
 */
export function evaluateIntentConfidenceAndAmbiguity(
  spokenText: string,
  extractedEntities: Record<string, any> = {}
): DisambiguationCheckResult {
  const t = spokenText.toLowerCase();
  const ambiguities: AmbiguityItem[] = [];
  let confidence: ConfidenceLevel = 'high';
  let isDestructive = false;

  // 1. Operações Destrutivas ou em Massa (Confirmação Obrigatória)
  if (
    /\b(apaga tudo|exclui tudo|exclui todos|zera tudo|deleta tudo|limpa tudo|cancela todas|marca tudo como pago|marca tudo pago|perdoa a divida|perdoa tudo)\b/i.test(t)
  ) {
    isDestructive = true;
    confidence = 'low';
    ambiguities.push({
      field: 'destructive_action',
      type: 'destructive',
      description: 'Tentativa de exclusão ou alteração em massa detectada.',
      possibleInterpretations: ['Cancelar operação recente', 'Alterar dados em massa permanentemente'],
      suggestedPrompt: 'Esta ação afetará dados em massa permanentemente. Você confirma a execução desta operação?',
    });
  }

  // 2. Ambiguidade de Valor Numérico (ex: "me deu dois", "ficou faltando três", "ficou cinco", "cinquenta")
  if (/\b(me deu dois|deu dois|deu duas)\b/i.test(t)) {
    confidence = 'low';
    ambiguities.push({
      field: 'amount',
      type: 'value',
      description: 'Expressão numérica de valor duplo.',
      possibleInterpretations: ['R$ 2.000,00', '2 parcelas', 'R$ 2,00'],
      suggestedPrompt: 'Você quis dizer R$ 2.000 ou 2 parcelas?',
    });
  } else if (/\b(ficou faltando três|faltando tres|faltou tres|voltou tres)\b/i.test(t)) {
    confidence = 'low';
    ambiguities.push({
      field: 'amount',
      type: 'value',
      description: 'Expressão numérica ambígua.',
      possibleInterpretations: ['R$ 3.000,00', '3 parcelas', 'R$ 300,00'],
      suggestedPrompt: 'Você quis dizer R$ 3.000 ou 3 parcelas?',
    });
  } else if (/\b(ficou cinco|ficaram cinco|ficou dez|por vinte e ficou dez)\b/i.test(t)) {
    confidence = 'low';
    ambiguities.push({
      field: 'amount',
      type: 'value',
      description: 'Expressão abreviada de valor.',
      possibleInterpretations: ['R$ 5.000 / R$ 10.000', '5 ou 10 parcelas'],
      suggestedPrompt: 'Você quis dizer valor em mil reais ou quantidade de parcelas?',
    });
  } else if (/\bcinquenta\b/i.test(t) && !/\bcinquenta mil\b/i.test(t) && !/\bcinquenta reais\b/i.test(t)) {
    confidence = 'low';
    ambiguities.push({
      field: 'amount',
      type: 'value',
      description: 'Valor cinquenta sem unidade especificada.',
      possibleInterpretations: ['R$ 50,00', 'R$ 50.000,00'],
      suggestedPrompt: 'Você quis dizer R$ 50 ou R$ 50 mil?',
    });
  } else if (/\bduas vezes\b/i.test(t) && !/\bduas vezes de\b/i.test(t)) {
    confidence = 'low';
    ambiguities.push({
      field: 'amount',
      type: 'installment',
      description: 'Expressão "duas vezes" sem especificação de valor por parcela.',
      possibleInterpretations: ['2 parcelas de valor a definir', '2 pagamentos distintos'],
      suggestedPrompt: 'Ficou em duas vezes de quanto?',
    });
  }

  // 3. Ambiguidade de Direção da Troca (ex: "Ficaram cinco de volta", "ficou de volta aí")
  if (
    (t.includes('ficou') || t.includes('ficaram') || t.includes('teve') || t.includes('troquei e')) &&
    t.includes('de volta') &&
    !t.includes('recebi') &&
    !t.includes('paguei') &&
    !t.includes('voltei') &&
    !t.includes('ele me voltou')
  ) {
    confidence = 'low';
    ambiguities.push({
      field: 'direction',
      type: 'direction',
      description: 'Direção da volta financeira indefinida.',
      possibleInterpretations: ['Você recebeu a volta', 'Você pagou a volta'],
      suggestedPrompt: 'Essa volta de valor foi você que recebeu ou você que pagou?',
    });
  }

  // 4. Ambiguidade de Parcela (ex: "Ele pagou aquela", "aquela lá")
  if (
    /\b(aquela parcela|pagou aquela|acertou aquela|aquela la|aquela lá)\b/i.test(t) &&
    !extractedEntities.installment_number
  ) {
    confidence = 'low';
    ambiguities.push({
      field: 'installment',
      type: 'installment',
      description: 'Referência indeterminada a parcela.',
      possibleInterpretations: ['Primeira parcela vencida', 'Última parcela'],
      suggestedPrompt: 'Qual parcela exatamente ele pagou (a primeira, a vencida ou outra)?',
    });
  }

  const requiresConfirmation = confidence !== 'high' || ambiguities.length > 0;
  const suggestedPrompt = ambiguities.length > 0 ? ambiguities[0].suggestedPrompt : undefined;

  return {
    confidence,
    requiresConfirmation,
    ambiguities,
    suggestedPrompt,
    isDestructive,
  };
}
