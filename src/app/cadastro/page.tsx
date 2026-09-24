import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell, SignUpForm } from '@/components/auth/auth-forms';

export const metadata: Metadata = { title: 'Criar conta' };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Crie sua conta"
      footer={
        <p className="text-base text-slate-400">
          Já tem conta?{' '}
          <Link href="/login" className="font-semibold text-emerald-300 underline-offset-4 hover:underline">
            Entrar
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
