// src/lib/domain/entity-resolver.ts
// Resolução central de entidades por nome/ID — Fases D e E do hardening.
// Toda resolução de cliente ou mercadoria por nome passa por aqui. Nunca escolhe silenciosamente
// entre homônimos: retorna 'ambiguous' com os candidatos e a pergunta para o usuário.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityReference } from '@/lib/ai/context_manager';

export type ResolutionStatus = 'resolved' | 'ambiguous' | 'not_found';
export type MatchedBy = 'id' | 'context' | 'exact' | 'tokens';

export interface EntityCandidate {
  id: string;
  name: string;
  detail?: string;
}

export interface ResolutionResult<T> {
  status: ResolutionStatus;
  entity?: T;
  matchedBy?: MatchedBy;
  candidates?: EntityCandidate[];
  promptQuestion?: string;
}

export interface ResolvedCustomer {
  id: string;
  name: string;
  phone?: string | null;
}

export interface ResolvedItem {
  id: string;
  name: string;
  acquisitionCost: number;
  status: string;
}

const STOPWORDS = new Set(['o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'de', 'meu', 'minha', 'seu', 'sua', 'dele', 'dela', 'um', 'uma']);
const CANDIDATE_SCAN_LIMIT = 1000;

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Um candidato casa com a referência quando TODOS os tokens da referência aparecem no nome:
 * tokens numéricos por igualdade ("13" não casa com "130"), tokens alfabéticos por prefixo.
 */
export function referenceMatchesName(reference: string, candidateName: string): boolean {
  const refTokens = nameTokens(reference);
  if (refTokens.length === 0) return false;
  const candTokens = nameTokens(candidateName);
  return refTokens.every((rt) =>
    candTokens.some((ct) => (/^\d+$/.test(rt) ? ct === rt : ct.startsWith(rt)))
  );
}

export function joinOr(values: string[]): string {
  if (values.length <= 1) return values[0] || '';
  return `${values.slice(0, -1).join(', ')} ou ${values[values.length - 1]}`;
}

/**
 * Casamento puro (sem I/O) — reutilizado pelos resolvers e pelos testes unitários.
 * Prioridade: nome exato único > todos os tokens da referência presentes.
 */
export function pickCandidates<T extends { name: string }>(
  reference: string,
  rows: T[]
): { status: ResolutionStatus; matches: T[]; matchedBy?: MatchedBy } {
  const normRef = normalizeName(reference);
  const exact = rows.filter((r) => normalizeName(r.name) === normRef);
  if (exact.length === 1) return { status: 'resolved', matches: exact, matchedBy: 'exact' };
  if (exact.length > 1) return { status: 'ambiguous', matches: exact, matchedBy: 'exact' };

  const byTokens = rows.filter((r) => referenceMatchesName(reference, r.name));
  if (byTokens.length === 1) return { status: 'resolved', matches: byTokens, matchedBy: 'tokens' };
  if (byTokens.length > 1) return { status: 'ambiguous', matches: byTokens, matchedBy: 'tokens' };
  return { status: 'not_found', matches: [] };
}

/** Termo seguro para ILIKE: maior token alfanumérico da referência, preservando acentos. */
function searchTerm(reference: string): string | null {
  const parts = reference.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 2 && !STOPWORDS.has(p.toLowerCase()));
  if (parts.length === 0) return null;
  return parts.sort((a, b) => b.length - a.length)[0];
}

async function fetchCandidateRows<T extends { name: string }>(
  supabase: SupabaseClient,
  table: 'customers' | 'items',
  columns: string,
  userId: string,
  reference: string,
  statuses?: string[]
): Promise<T[]> {
  const base = () => {
    let q = supabase.from(table).select(columns).eq('user_id', userId);
    if (statuses && statuses.length > 0) q = q.in('status', statuses);
    return q;
  };

  const term = searchTerm(reference);
  if (term) {
    const { data } = await base().ilike('name', `%${term}%`).limit(50);
    const rows = (data || []) as unknown as T[];
    if (rows.length > 0) return rows;
  }

  // Fallback sem acento: "Joao" precisa encontrar "João"
  const { data } = await base().limit(CANDIDATE_SCAN_LIMIT);
  return ((data || []) as unknown as T[]).filter((r) => referenceMatchesName(reference, r.name));
}

export async function resolveCustomerReference(
  supabase: SupabaseClient,
  userId: string,
  ref: { id?: string; name?: string; context?: EntityReference }
): Promise<ResolutionResult<ResolvedCustomer>> {
  const loadById = async (id: string) => {
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    return data as ResolvedCustomer | null;
  };

  if (ref.id) {
    const found = await loadById(ref.id);
    return found ? { status: 'resolved', entity: found, matchedBy: 'id' } : { status: 'not_found', promptQuestion: 'Não encontrei esse cliente no seu cadastro.' };
  }

  const name = ref.name?.trim();

  // ID persistido no contexto só quando a fala não traz nome (pronome) ou traz exatamente o mesmo nome.
  // Nome parcial ("João") com vários candidatos sempre pergunta, mesmo que um deles esteja no contexto.
  if (ref.context?.id && (!name || normalizeName(name) === normalizeName(ref.context.name))) {
    const found = await loadById(ref.context.id);
    if (found) return { status: 'resolved', entity: found, matchedBy: 'context' };
  }

  if (!name) {
    return { status: 'not_found', promptQuestion: 'De qual cliente você está falando?' };
  }

  const rows = await fetchCandidateRows<ResolvedCustomer>(supabase, 'customers', 'id, name, phone', userId, name);
  const picked = pickCandidates(name, rows);

  if (picked.status === 'resolved') {
    return { status: 'resolved', entity: picked.matches[0], matchedBy: picked.matchedBy };
  }
  if (picked.status === 'ambiguous') {
    const sameNames = new Set(picked.matches.map((m) => normalizeName(m.name))).size < picked.matches.length;
    const candidates = picked.matches.map((m) => ({
      id: m.id,
      name: m.name,
      detail: m.phone ? `tel. ${m.phone}` : undefined,
    }));
    const labels = candidates.map((c) => (sameNames && c.detail ? `${c.name} (${c.detail})` : c.name));
    return {
      status: 'ambiguous',
      candidates,
      promptQuestion: `Você está falando de ${joinOr(labels)}?`,
    };
  }
  return { status: 'not_found', promptQuestion: `Não encontrei nenhum cliente chamado ${name}.` };
}

export async function resolveItemReference(
  supabase: SupabaseClient,
  userId: string,
  ref: { id?: string; reference?: string; context?: EntityReference; statuses?: string[] }
): Promise<ResolutionResult<ResolvedItem>> {
  const statuses = ref.statuses ?? ['disponivel'];
  type ItemRow = { id: string; name: string; acquisition_cost: number; status: string };
  const toItem = (r: ItemRow): ResolvedItem => ({
    id: r.id,
    name: r.name,
    acquisitionCost: Number(r.acquisition_cost),
    status: r.status,
  });

  const loadById = async (id: string) => {
    const { data } = await supabase
      .from('items')
      .select('id, name, acquisition_cost, status')
      .eq('id', id)
      .eq('user_id', userId)
      .in('status', statuses)
      .maybeSingle();
    return data as ItemRow | null;
  };

  if (ref.id) {
    const found = await loadById(ref.id);
    return found
      ? { status: 'resolved', entity: toItem(found), matchedBy: 'id' }
      : { status: 'not_found', promptQuestion: 'Essa mercadoria não está disponível no seu estoque.' };
  }

  const reference = ref.reference?.trim();

  if (ref.context?.id && (!reference || normalizeName(reference) === normalizeName(ref.context.name))) {
    const found = await loadById(ref.context.id);
    if (found) return { status: 'resolved', entity: toItem(found), matchedBy: 'context' };
  }

  if (!reference) {
    return { status: 'not_found', promptQuestion: 'Qual mercadoria?' };
  }

  const rows = await fetchCandidateRows<ItemRow>(supabase, 'items', 'id, name, acquisition_cost, status', userId, reference, statuses);
  const picked = pickCandidates(reference, rows);

  if (picked.status === 'resolved') {
    return { status: 'resolved', entity: toItem(picked.matches[0]), matchedBy: picked.matchedBy };
  }
  if (picked.status === 'ambiguous') {
    const candidates = picked.matches.map((m) => ({ id: m.id, name: m.name }));
    return {
      status: 'ambiguous',
      candidates,
      promptQuestion: `Você tem mais de um ${reference} no estoque. É ${joinOr(candidates.map((c) => c.name))}?`,
    };
  }
  return {
    status: 'not_found',
    promptQuestion: `Não encontrei '${reference}' disponível no seu estoque.`,
  };
}

/**
 * Casa a resposta do usuário a uma pergunta de desambiguação com um dos candidatos oferecidos.
 * Retorna o candidato somente se exatamente um casar.
 */
export function matchCandidateAnswer(answer: string, candidates: EntityCandidate[]): EntityCandidate | null {
  const normAnswer = normalizeName(answer);
  const exact = candidates.filter((c) => normAnswer.includes(normalizeName(c.name)));
  if (exact.length === 1) return exact[0];
  // Resposta parcial: "o Santos", "o azul", "o primeiro"
  const ordinals: Record<string, number> = { primeiro: 0, primeira: 0, segundo: 1, segunda: 1, terceiro: 2, terceira: 2 };
  for (const [word, idx] of Object.entries(ordinals)) {
    if (new RegExp(`\\b${word}\\b`).test(normAnswer) && candidates[idx]) return candidates[idx];
  }
  const answerTokens = nameTokens(answer);
  const distinctive = candidates.filter((c) => {
    const others = candidates.filter((o) => o.id !== c.id).flatMap((o) => nameTokens(o.name));
    return nameTokens(c.name).some((t) => !others.includes(t) && answerTokens.includes(t));
  });
  return distinctive.length === 1 ? distinctive[0] : null;
}
