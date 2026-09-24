import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell, ForgotPasswordForm } from '@/components/auth/auth-forms';

export const metadata: Metadata = { title: 'Esqueci minha senha' };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <AuthShell
      title="Esqueci minha senha"
      footer={
        <Link href="/login" className="text-base font-semibold text-emerald-300 underline-offset-4 hover:underline">
          Voltar para o login
        </Link>
      }
    >
      <ForgotPasswordForm linkError={erro === 'link'} />
    </AuthShell>
  );
}
