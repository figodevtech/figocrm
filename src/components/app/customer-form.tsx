'use client';
// Cadastro/edição de cliente: só o nome é obrigatório.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveCustomerAction } from '@/app/actions/customers';
import { Alert } from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { TextAreaField, TextField } from '@/components/ui/form';

interface Initial {
  id?: string;
  name?: string;
  phone?: string | null;
  document?: string | null;
  address?: string | null;
  notes?: string | null;
}

export function CustomerForm({ initial = {}, returnTo }: { initial?: Initial; returnTo?: string }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name ?? '',
    phone: initial.phone ?? '',
    document: initial.document ?? '',
    address: initial.address ?? '',
    notes: initial.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (allowDuplicate = false) => {
    setSaving(true);
    setError(null);
    setDuplicate(null);
    const res = await saveCustomerAction(form, { customerId: initial.id, allowDuplicate });
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      setDuplicate(res.duplicate ?? null);
      return;
    }
    const target = returnTo ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}cliente=${res.customer.id}` : `/app/clientes/${res.customer.id}`;
    router.push(target);
    router.refresh();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <TextField label="Nome" required value={form.name} onChange={set('name')} autoComplete="off" autoFocus={!initial.id} placeholder="João Carlos" />
      <TextField label="Telefone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="off" placeholder="(83) 99999-9999" />
      <TextField label="CPF/CNPJ" inputMode="numeric" value={form.document} onChange={set('document')} autoComplete="off" hint="Opcional" />
      <TextField label="Endereço" value={form.address} onChange={set('address')} autoComplete="off" hint="Opcional" />
      <TextAreaField label="Observações" value={form.notes} onChange={set('notes')} hint="Opcional" />

      {error ? (
        <Alert>
          {error}
          {duplicate ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink href={`/app/clientes/${duplicate.id}`} size="sm" variant="secondary">
                Abrir {duplicate.name}
              </ButtonLink>
              <Button size="sm" variant="secondary" onClick={() => submit(true)}>
                Cadastrar outro mesmo assim
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" loading={saving} disabled={!form.name.trim()}>
        {initial.id ? 'Salvar alterações' : 'Salvar cliente'}
      </Button>
    </form>
  );
}
