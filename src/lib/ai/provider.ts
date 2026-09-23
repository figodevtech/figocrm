// src/lib/ai/provider.ts
// Camada de provedores de LLM (OpenAI / Gemini) com Structured Output.
// OpenAI: response_format json_schema strict (schema real). Gemini: responseMimeType JSON.
// Em ambos os casos o resultado ainda passa por validação Zod no interpretador.
//
// Configuração (env):
//   OPENAI_API_KEY / GEMINI_API_KEY   — chaves (nunca logadas)
//   LLM_PROVIDER                      — auto (padrão) | openai | gemini
//   OPENAI_MODEL                      — padrão gpt-4o-mini
//   GEMINI_MODEL                      — padrão gemini-2.5-flash
//   LLM_TIMEOUT_MS                    — padrão 15000

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
}

export interface LLMResponse {
  content: string;
  provider: 'openai' | 'gemini';
  model: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export type LLMErrorType = 'not_configured' | 'timeout' | 'http_error' | 'network' | 'empty_response';

export class LLMProviderError extends Error {
  constructor(
    public readonly type: LLMErrorType,
    message: string,
    public readonly provider?: 'openai' | 'gemini'
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

export type LLMCaller = (request: LLMRequest) => Promise<LLMResponse>;

function configuredProviders(): Array<'openai' | 'gemini'> {
  const pref = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const available: Array<'openai' | 'gemini'> = [];
  if (process.env.OPENAI_API_KEY) available.push('openai');
  if (process.env.GEMINI_API_KEY) available.push('gemini');
  if (pref === 'openai' || pref === 'gemini') return available.filter((p) => p === pref);
  return available;
}

export function isLLMConfigured(): boolean {
  return configuredProviders().length > 0;
}

async function fetchWithTimeout(url: string, init: RequestInit, provider: 'openai' | 'gemini'): Promise<Response> {
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new LLMProviderError('timeout', `Timeout após ${timeoutMs}ms`, provider);
    throw new LLMProviderError('network', err instanceof Error ? err.message : 'Falha de rede', provider);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(request: LLMRequest): Promise<LLMResponse> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const start = Date.now();
  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: request.messages,
        response_format: request.jsonSchema
          ? { type: 'json_schema', json_schema: { name: request.schemaName || 'structured_output', strict: true, schema: request.jsonSchema } }
          : { type: 'json_object' },
      }),
    },
    'openai'
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LLMProviderError('http_error', `OpenAI HTTP ${response.status}: ${body.slice(0, 300)}`, 'openai');
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LLMProviderError('empty_response', 'OpenAI sem conteúdo', 'openai');

  return {
    content,
    provider: 'openai',
    model,
    latencyMs: Date.now() - start,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

async function callGemini(request: LLMRequest): Promise<LLMResponse> {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const start = Date.now();
  const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    },
    'gemini'
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LLMProviderError('http_error', `Gemini HTTP ${response.status}: ${body.slice(0, 300)}`, 'gemini');
  }
  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new LLMProviderError('empty_response', 'Gemini sem conteúdo', 'gemini');

  return {
    content,
    provider: 'gemini',
    model,
    latencyMs: Date.now() - start,
    promptTokens: data.usageMetadata?.promptTokenCount,
    completionTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

/**
 * Chama o primeiro provedor configurado; se falhar por rede/HTTP, tenta o próximo.
 * Lança LLMProviderError('not_configured') quando não há chave.
 */
export const callLLMStructured: LLMCaller = async (request) => {
  const providers = configuredProviders();
  if (providers.length === 0) {
    throw new LLMProviderError('not_configured', 'Nenhum provedor de LLM configurado (OPENAI_API_KEY / GEMINI_API_KEY).');
  }

  let lastError: LLMProviderError | undefined;
  for (const provider of providers) {
    try {
      return provider === 'openai' ? await callOpenAI(request) : await callGemini(request);
    } catch (err) {
      lastError = err instanceof LLMProviderError ? err : new LLMProviderError('network', String(err), provider);
      console.warn(`[llm] ${provider} falhou (${lastError.type}): ${lastError.message.slice(0, 200)}`);
    }
  }
  throw lastError!;
};
