// Nova senha: só funciona com a sessão criada pelo link de recuperação (/auth/callback).
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { AuthShell, ResetPasswordForm } from '@/components/auth/auth-forms';
import { Alert } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Nova senha' };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <AuthShell title="Crie uma nova senha">
      {user ? (
        <ResetPasswordForm />
      ) : (
        <div className="space-y-4">
          <Alert tone="warning">Abra esta página pelo link que enviamos para o seu e-mail. O link vale por pouco tempo.</Alert>
          <ButtonLink href="/esqueci-senha" size="lg" className="w-full">
            Pedir um novo link
          </ButtonLink>
        </div>
      )}
    </AuthShell>
  );
}
