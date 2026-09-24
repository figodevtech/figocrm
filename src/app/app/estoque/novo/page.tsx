import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/auth/redirects';
import { ItemForm } from '@/components/app/item-form';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Nova mercadoria' };

export default async function NewItemPage({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const { user } = await requireSession();
  const { voltar } = await searchParams;
  const returnTo = voltar ? safeNextPath(voltar, '') || undefined : undefined;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Nova mercadoria" back={returnTo ?? '/app'} />
      <ItemForm userId={user.id} returnTo={returnTo} />
    </div>
  );
}
