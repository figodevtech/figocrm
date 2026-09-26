'use client';
// Telas de entrada: extremamente simples, um campo por linha, texto 16px, erros legíveis.
import Link from 'next/link';
import { useActionState, type ReactNode } from 'react';
import {
  requestPasswordResetAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  type AuthState,
} from '@/app/auth/actions';
import { Alert } from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { TextField } from '@/components/ui/form';

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-3xl font-black tracking-tight text-white" aria-label="FIGO — página inicial">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-lg text-emerald-950">F</span>
          FIGO
        </Link>
        <h1 className="mb-6 text-center text-2xl font-bold text-white">{title}</h1>
        {children}
        {footer ? <div className="mt-8 space-y-3 text-center">{footer}</div> : null}
      </div>
    </main>
  );
}

export function LoginForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const [state, action, pending] = useActionState<AuthState | null, FormData>(signInAction, null);
  return (
    <form action={action} className="space-y-4">
      {linkError ? <Alert tone="warning">O link expirou ou já foi usado. Entre com sua senha ou peça outro link.</Alert> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField label="E-mail" name="email" type="email" required autoComplete="email" inputMode="email" />
      <TextField label="Senha" name="password" type="password" required autoComplete="current-password" />
      {state?.error ? <Alert>{state.error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Entrar
      </Button>
      <Link href="/esqueci-senha" className="block py-2 text-center text-base font-medium text-emerald-300 underline-offset-4 hover:underline">
        Esqueci minha senha
      </Link>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState<AuthState | null, FormData>(signUpAction, null);
  if (state?.success) {
    return (
      <div className="space-y-4">
        <Alert tone="success">{state.message}</Alert>
        <ButtonLink href="/login" variant="secondary" className="w-full">
          Ir para o login
        </ButtonLink>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <TextField label="Nome" name="fullName" required autoComplete="name" />
      <TextField label="E-mail" name="email" type="email" required autoComplete="email" inputMode="email" />
      <TextField label="Senha" name="password" type="password" required minLength={8} autoComplete="new-password" hint="Mínimo 8 caracteres" />
      <TextField label="Telefone" name="phone" type="tel" autoComplete="tel" hint="Opcional" />
      <TextField label="Nome do negócio" name="businessName" autoComplete="organization" hint="Opcional" />
      {state?.error ? <Alert>{state.error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Criar conta e testar 7 dias
      </Button>
      <p className="text-center text-sm text-slate-500">Sem cartão. Depois de 7 dias, você continua no Free ou assina o Pro por R$ 39,90/mês.</p>
      <p className="text-center text-sm text-slate-400">Ao criar sua conta, você concorda com os <Link href="/termos" className="text-emerald-300 underline">Termos de Uso</Link> e reconhece a <Link href="/privacidade" className="text-emerald-300 underline">Política de Privacidade</Link>.</p>
    </form>
  );
}

export function ForgotPasswordForm({ linkError }: { linkError?: boolean }) {
  const [state, action, pending] = useActionState<AuthState | null, FormData>(requestPasswordResetAction, null);
  if (state?.success) return <Alert tone="success">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-4">
      {linkError ? <Alert tone="warning">O link expirou, já foi usado ou foi aberto em outro aparelho. Peça um novo abaixo.</Alert> : null}
      <p className="text-base text-slate-300">Digite o e-mail da sua conta. Vamos enviar um link para criar uma nova senha.</p>
      <TextField label="E-mail" name="email" type="email" required autoComplete="email" inputMode="email" />
      {state?.error ? <Alert>{state.error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Enviar link
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<AuthState | null, FormData>(updatePasswordAction, null);
  if (state?.success) {
    return (
      <div className="space-y-4">
        <Alert tone="success">Senha alterada. Você já está dentro da sua conta.</Alert>
        <ButtonLink href="/app" size="lg" className="w-full">
          Ir para o início
        </ButtonLink>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <TextField label="Nova senha" name="password" type="password" required minLength={8} autoComplete="new-password" hint="Mínimo 8 caracteres" />
      <TextField label="Repita a nova senha" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      {state?.error ? <Alert>{state.error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Salvar nova senha
      </Button>
    </form>
  );
}
