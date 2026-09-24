import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/redirects';
import { AuthShell, LoginForm } from '@/components/auth/auth-forms';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const { next, erro } = await searchParams;
  const safeNext = next ? safeNextPath(next, '') : '';
  return (
    <AuthShell
      title="Entre na sua conta"
      footer={
        <>
          <p className="text-base text-slate-400">Ainda não tenho conta</p>
          <ButtonLink href="/cadastro" variant="secondary" size="lg" className="w-full">
            Criar conta
          </ButtonLink>
        </>
      }
    >
      <LoginForm next={safeNext || undefined} linkError={erro === 'link'} />
    </AuthShell>
  );
}
