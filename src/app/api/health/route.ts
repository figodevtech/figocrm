import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const admin = createAdminClient();
  if (!admin) return Response.json({ status: 'unavailable', database: 'unconfigured' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  const { error } = await admin.from('profiles').select('id').limit(1);
  const healthy = !error;
  return Response.json({
    status: healthy ? 'ok' : 'degraded',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || process.env.NEXT_PUBLIC_APP_VERSION || 'local',
    database: healthy ? 'ok' : 'unavailable',
    billing: process.env.BILLING_PROVIDER && process.env.ASAAS_API_KEY && process.env.ASAAS_WEBHOOK_TOKEN ? 'configured' : 'unconfigured',
  }, { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
