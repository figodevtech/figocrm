import { createClient } from '@/lib/supabase/server';

const USER_TABLES = [
  'customers', 'items', 'item_costs', 'deals', 'cash_movements',
  'loan_contracts', 'receivables', 'payables', 'installments',
  'payments', 'adjustments', 'settlements', 'renegotiations',
  'loan_contract_documents', 'subscriptions',
] as const;

/** Explicit owner filter plus RLS. Fetch every page so large accounts are complete. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: 'Faça login para exportar seus dados.' }, { status: 401 });

  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('id,email,full_name,phone,business_name,business_segment,document,address,created_at,updated_at')
    .eq('id', user.id).single();
  if (profileError) return Response.json({ error: 'Não foi possível exportar os dados agora.' }, { status: 503 });

  const sections: Record<string, unknown[]> = {};
  for (const table of USER_TABLES) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from(table).select('*').eq('user_id', user.id)
        .order(table === 'loan_contract_documents' ? 'issued_at' : 'created_at', { ascending: true }).range(offset, offset + 499);
      if (error) return Response.json({ error: 'Não foi possível exportar os dados agora.' }, { status: 503 });
      rows.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
    sections[table] = rows;
  }

  const dealItems: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('deal_items')
      .select('id,deal_id,item_id,direction,evaluated_value,created_at,deals!inner(user_id)')
      .eq('deals.user_id', user.id).order('created_at', { ascending: true }).range(offset, offset + 499);
    if (error) return Response.json({ error: 'Não foi possível exportar os dados agora.' }, { status: 503 });
    dealItems.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  sections.deal_items = dealItems;

  return new Response(JSON.stringify({ exported_at: new Date().toISOString(), profile, ...sections }, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="figocrm-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
