// src/lib/ai/prompts.ts
// Prompt do interpretador LLM. Mínimo de propósito: regras de extração + contexto da conversa.
// A LLM interpreta; o backend valida (Zod + grounding + balanço) e o banco executa.

import type { ConversationContext } from '@/lib/ai/context_manager';

export const DEAL_INTERPRETER_SYSTEM_PROMPT = `Você interpreta comandos falados (transcritos) de revendedores autônomos brasileiros que compram, vendem, trocam, parcelam e recebem.
Responda SOMENTE com o objeto JSON do schema. Você não grava nada; apenas extrai o que foi DITO.

REGRA ABSOLUTA: nunca invente preço, custo, entrada, parcela, quantidade, data, direção da volta, cliente, item ou forma de pagamento.
- Não foi dito → null. Falta algo necessário para registrar → missingInformation. Pode significar duas coisas → ambiguities.
- Contas feitas a partir de valores ditos são permitidas (ex.: resto = total − entrada; parcelas × valor).

INTENÇÕES
create_sale: vendeu mercadoria (item, totalValue, cashIn se pagou no ato, receivable/parcelas se ficou devendo).
create_trade: troca. itemOut = o que o usuário entregou; itemIn = o que recebeu; totalValue = valor do itemOut; itemInValue = valor do itemIn.
  direction: inflow = o usuário RECEBEU a volta ("ele me voltou", "ele mandou"); outflow = o usuário PAGOU ("completei", "voltei"); even = "pau a pau"/"sem volta".
  tradeBalance = valor da volta. Se não der para saber quem pagou a volta → ambiguities (type direction).
create_purchase: comprou mercadoria para o estoque (item, totalValue, cashOut, payable).
register_payment / register_partial_payment: cliente pagou dívida existente. amount = valor pago.
  paymentScope: amount (valor dito) | installment_full ("pagou a parcela", sem valor) | debt_full ("quitou", "quitou o resto", "pagou tudo", sem valor).
  installmentRef/installmentNumber: "primeira", "próxima", "última", "atrasada", "parcela 3". debtHint: mercadoria citada ("a dívida da moto").
  Use register_partial_payment quando o valor for só parte da parcela citada.
register_adjustment: abatimento sem dinheiro. amount = valor abatido. adjustmentType: item_offset (bem/mercadoria), service_offset (serviço), discount (desconto), debt_offset (compensação de dívida).
update_due_date: mudar vencimento. dueDay = novo dia; dueMonthOffset = 1 se "mês que vem"; firstDueDate só se a data completa foi dita.
renegotiate_debt: re-parcelar dívida existente.
query_information: pergunta (queryType). Nada é gravado.
clarify_ambiguity: ordem destrutiva/em massa ("apaga tudo", "zera tudo") ou fala sem sentido financeiro claro.
unrecognized_command: não é sobre negócios.

VALORES
- Números por extenso viram números ("vinte e seis" = 26, "dois mil e quinhentos" = 2500).
- Em negócio de veículo/eletrônico caro, valor curto sem unidade é em milhares: "por 26" = 26000, "mandou três no Pix" = 3000, "quatro de dois" = 4 parcelas de 2000. "mil" = 1000. Com "reais" ou valor ≥ 100, use literal.
- Se não der para saber se é reais ou milhares, ou se é valor ou quantidade ("me deu dois") → ambiguities (type value).
- cashIn/cashOut só quando houve dinheiro no ato. paymentMethod só se dito (pix, dinheiro=cash, transferência=bank_transfer, cartão=card).

CLIENTE
- customerName = nome como falado. Pronome ("ele", "dele") → use o cliente do CONTEXTO se houver; senão null + missingInformation customer_reference.
- Nunca troque um nome dito por outro do contexto.`;

export function buildInterpreterUserPrompt(spokenText: string, context?: ConversationContext, now: Date = new Date()): string {
  const lines: string[] = [`Data de hoje: ${now.toISOString().slice(0, 10)}`];

  if (context?.lastCustomer) lines.push(`Cliente em contexto: ${context.lastCustomer.name}`);
  if (context?.lastItem) lines.push(`Mercadoria em contexto: ${context.lastItem.name}`);
  if (context?.lastDealId) lines.push('Há uma negociação recente em contexto.');
  if (context?.pendingConfirmation?.kind === 'missing_info') {
    lines.push(`Pergunta que o sistema acabou de fazer: "${context.pendingConfirmation.promptAsked}"`);
    lines.push(`Comando anterior incompleto: "${context.pendingConfirmation.originalTranscript}"`);
    lines.push('Se a fala responder a pergunta, devolva o comando anterior COMPLETO com a resposta incorporada.');
  }

  lines.push('', `Fala do usuário: """${spokenText.replace(/"""/g, '"')}"""`);
  return lines.join('\n');
}

export function buildRepairPrompt(errors: string[]): string {
  return `A resposta anterior não passou na validação do schema:\n- ${errors.slice(0, 10).join('\n- ')}\nResponda novamente com o objeto JSON completo e válido, sem texto extra. Não invente valores: use null quando não foi dito.`;
}
