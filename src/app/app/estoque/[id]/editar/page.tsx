import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { getItemDetail } from '@/lib/domain/app-data';
import { ItemForm } from '@/components/app/item-form';
import { Alert, PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Editar mercadoria' };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireSession();
  const detail = await getItemDetail(supabase, user.id, id);
  if (!detail) notFound();
  const { item } = detail;
  const editable = ['disponivel', 'reservado', 'em_preparacao'].includes(item.status);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Editar mercadoria" back={`/app/estoque/${id}`} />
      {editable ? (
        <ItemForm
          userId={user.id}
          initial={{
            id: item.id,
            name: item.name,
            category: item.category,
            brand: item.brand,
            model: item.model,
            identifier: item.identifier,
            imei: item.imei,
            serialNumber: item.serialNumber,
            plate: item.plate,
            modelYear: item.modelYear,
            acquisitionCost: item.acquisitionCost,
            targetSalePrice: item.targetSalePrice,
            description: item.description,
            photoPath: item.photoPath,
            photoUrl: item.photoUrl,
          }}
        />
      ) : (
        <Alert tone="info">Mercadoria já vendida não pode ser alterada: o custo e o lucro da venda já foram apurados.</Alert>
      )}
    </div>
  );
}
