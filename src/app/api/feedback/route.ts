import { createClient } from '@/lib/supabase/server';

const CATEGORIES = new Set(['bug', 'billing', 'suggestion', 'other']);
const SENSITIVE = /(?:sk-[a-z0-9_-]{12,}|\$aact_[a-z0-9_-]+|(?:senha|password|token|chave de api)\s*[:=]|\b(?:\d[ -]*?){13,19}\b)/i;

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return Response.json({ error: 'Solicitação inválida.' }, { status: 415 });
  const body = await request.json().catch(() => null);
  const category = body?.category;
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const route = typeof body?.route === 'string' && /^\/app(?:\/|$)/.test(body.route) ? body.route.slice(0, 300) : null;
  if (!CATEGORIES.has(category) || description.length < 10 || description.length > 2000)
    return Response.json({ error: 'Escolha uma categoria e descreva o problema em 10 a 2.000 caracteres.' }, { status: 400 });
  if (SENSITIVE.test(description)) return Response.json({ error: 'Remova senhas, tokens e números de cartão antes de enviar.' }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Entre novamente na sua conta.' }, { status: 401 });
  const { error } = await supabase.from('feedback_reports').insert({
    user_id: user.id, category, description, route,
    app_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'local',
  });
  if (error) return Response.json({ error: 'Não foi possível enviar agora. Tente novamente.' }, { status: 503 });
  return Response.json({ sent: true }, { status: 201 });
}
