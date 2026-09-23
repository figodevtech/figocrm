// src/lib/ai/provider.ts
// Camada Centralizada de Provedores de IA (OpenAI / Gemini) com Structured Output — Fase D do FigoCRM
// Encapsula chamadas de LLM, timeout, formato JSON e observabilidade de latência.

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  provider: 'openai' | 'gemini' | 'none';
  latencyMs: number;
}

export const STRUCTURED_DEAL_INTERPRETER_SYSTEM_PROMPT = `
Você é o interpretador oficial de linguagem natural do FigoCRM, um SaaS voice-first para revendedores brasileiros de veículos e produtos autônomos.
Sua função é converter o relato falado do usuário em um JSON estrito para negociações, vendas, trocas, recebimentos e consultas.

REGRAS DE OURO INEGOCIÁVEIS:
1. NUNCA INVENTE PREÇOS, VALORES, QUANTIDADE DE PARCELAS, CLIENTES OU DIREÇÃO DE VOLTA.
   - Se o usuário não disse o valor da venda, marque "requiresConfirmation": true e coloque a pergunta em "missingInformation".
   - Se o usuário disse "deu dois" ou "faltando três" de forma ambígua, marque "intent": "clarify_ambiguity", "requiresConfirmation": true.
2. Fidelidade matemática:
   - Total = Entrada em dinheiro + Recebível a prazo + Abatimentos.
   - Na troca com volta: especifique se a volta foi recebida pelo usuário (direction = "inflow") ou paga pelo usuário (direction = "outflow").
3. Retorne APENAS um objeto JSON válido, sem formatações Markdown adicionais.

ESTRUTURA JSON ESPERADA:
{
  "intent": "create_sale" | "create_trade" | "create_deal" | "register_payment" | "register_partial_payment" | "register_adjustment" | "update_due_date" | "query_information" | "clarify_ambiguity",
  "customer": string | null,
  "item": string | null,
  "itemOut": string | null,
  "itemIn": string | null,
  "totalValue": number | null,
  "cashIn": number | null,
  "cashOut": number | null,
  "tradeBalance": number | null,
  "direction": "inflow" | "outflow" | "even" | null,
  "receivable": number | null,
  "installmentsCount": number | null,
  "installmentAmount": number | null,
  "dueDay": number | null,
  "firstDueDate": string | null,
  "adjustmentAmount": number | null,
  "adjustmentType": "item_offset" | "discount" | "service_offset" | null,
  "requiresConfirmation": boolean,
  "confirmationPrompt": string | null,
  "missingInformation": Array<{ type: string; promptQuestion: string }>
}
`;

/**
 * Executa uma chamada com Structured Output para OpenAI ou Gemini.
 */
export async function callLLMStructured(
  prompt: string,
  systemPrompt: string = STRUCTURED_DEAL_INTERPRETER_SYSTEM_PROMPT
): Promise<LLMResponse | null> {
  const startTime = Date.now();
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  // 1. Tenta OpenAI se disponível
  if (openaiApiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        return {
          content,
          provider: 'openai',
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      console.warn('Falha na chamada OpenAI LLM:', err);
    }
  }

  // 2. Tenta Google Gemini se disponível
  if (geminiApiKey) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${systemPrompt}\n\nAnalise o seguinte comando e responda em JSON:\n${prompt}` },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        return {
          content,
          provider: 'gemini',
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      console.warn('Falha na chamada Gemini LLM:', err);
    }
  }

  return null;
}
