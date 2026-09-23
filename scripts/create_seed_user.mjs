import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DATABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Credenciais do Supabase não encontradas!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Erro ao listar usuários:', listError.message);
    process.exit(1);
  }

  console.log(`Usuários existentes no Supabase Auth: ${users.length}`);
  for (const u of users) {
    console.log(`- ${u.email} (ID: ${u.id})`);
  }

  const testEmail = 'teste@figocrm.com';
  const testPassword = 'Password123!';

  const existingTestUser = users.find(u => u.email === testEmail);

  if (existingTestUser) {
    console.log(`Usuário de teste já existe: ${testEmail}`);
    // Atualiza senha para garantir que esteja funcionando
    const { error: updateError } = await supabase.auth.admin.updateUserById(existingTestUser.id, {
      password: testPassword,
      email_confirm: true,
      user_metadata: { name: 'Usuário Teste Figo CRM' }
    });
    if (updateError) {
      console.error('Erro ao atualizar senha:', updateError.message);
    } else {
      console.log('Senha redefinida com sucesso para o padrão de teste!');
    }
  } else {
    console.log(`Criando novo usuário de teste: ${testEmail}...`);
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { name: 'Usuário Teste Figo CRM' }
    });

    if (createError) {
      console.error('Erro ao criar usuário:', createError.message);
      process.exit(1);
    }

    console.log(`Usuário de teste criado com sucesso! ID: ${newUser.user.id}`);
  }

  // Verificar ou criar profile na tabela public.profiles
  const { data: userRecord } = await supabase.auth.admin.listUsers();
  const targetUser = userRecord.users.find(u => u.email === testEmail);

  if (targetUser) {
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: targetUser.id,
      name: 'Usuário Teste Figo CRM',
      tier: 'premium',
      plan: 'scale',
      voice_quota: 1000,
      voice_quota_reset_at: new Date(Date.now() + 30 * 86400000).toISOString()
    });

    if (profileError) {
      console.warn('Aviso ao criar profile (verifique RLS se necessário):', profileError.message);
    } else {
      console.log('Perfil sincronizado na tabela public.profiles com plano Scale/Premium!');
    }
  }
}

main().catch(console.error);
