'use client';
// Formulários da Conta: dados do perfil, alterar senha e sair.
import { useActionState, useTransition } from 'react';
import { LogOut } from 'lucide-react';
import { signOutAction, updatePasswordAction, updateProfileAction, type AuthState } from '@/app/auth/actions';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/form';

export function ProfileForm({ fullName, phone, businessName }: { fullName: string; phone: string | null; businessName: string | null }) {
  const [state, action, pending] = useActionState<AuthState | null, FormData>(updateProfileAction, null);
  return (
    <form action={action} className="space-y-4">
      <TextField label="Nome" name="fullName" required defaultValue={fullName} autoComplete="name" />
      <TextField label="Telefone" name="phone" type="tel" defaultValue={phone ?? ''} autoComplete="tel" />
      <TextField label="Nome do negócio" name="businessName" defaultValue={businessName ?? ''} autoComplete="organization" />
      {state?.error ? <Alert>{state.error}</Alert> : null}
      {state?.success ? <Alert tone="success">{state.message}</Alert> : null}
      <Button type="submit" variant="secondary" className="w-full" loading={pending}>
        Salvar dados
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<AuthState | null, FormData>(updatePasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      <TextField label="Nova senha" name="password" type="password" required minLength={8} autoComplete="new-password" hint="Mínimo 8 caracteres" />
      <TextField label="Repita a nova senha" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      {state?.error ? <Alert>{state.error}</Alert> : null}
      {state?.success ? <Alert tone="success">{state.message}</Alert> : null}
      <Button type="submit" variant="secondary" className="w-full" loading={pending}>
        Alterar senha
      </Button>
    </form>
  );
}

/** Limpa estado local sensível antes de encerrar a sessão no servidor. */
export function clearLocalState() {
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      Object.keys(storage)
        .filter((k) => k.startsWith('figo') || k.startsWith('sb-'))
        .forEach((k) => storage.removeItem(k));
    }
  } catch {
    // Navegador sem storage (modo privado restrito): nada a limpar
  }
}

export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="danger"
      size="lg"
      className="w-full"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          clearLocalState();
          await signOutAction();
        })
      }
    >
      <LogOut className="h-5 w-5" aria-hidden /> Sair
    </Button>
  );
}
