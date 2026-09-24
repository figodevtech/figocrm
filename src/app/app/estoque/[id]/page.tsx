import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Package, Pencil } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { getItemDetail, listAvailableItemOptions } from '@/lib/domain/app-data';
import { CostPendingPanel, ProvisionalItemPanel } from '@/components/app/provisional-panels';
import { formatBRL, formatDate } from '@/lib/format';
import { ItemCostsPanel, ItemStatusToggle } from '@/components/app/item-panel';
import { Badge, Card, PageHeader, Row, SectionTitle } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { VoiceButton, VoiceScreen } from '@/components/voice/voice-provider';

export const metadata: Metadata = { title: 'Mercadoria' };

const statusTone = { available: 'emerald', trade_in: 'sky', reserved: 'amber', sold: 'neutral', preparing: 'violet', returned: 'neutral' } as const;

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireSession();
  const detail = await getItemDetail(supabase, user.id, id);
  if (!detail) notFound();
  const { item } = detail;
  const stock = item.isProvisional ? await listAvailableItemOptions(supabase, user.id) : [];
  const inStock = item.status === 'disponivel' || item.status === 'reservado';
  const attrs = [
    ['Marca', item.brand],
    ['Modelo', item.model],
    ['IMEI', item.imei],
    ['Série', item.serialNumber],
    ['Placa', item.plate],
    ['Ano', item.modelYear ? String(item.modelYear) : null],
    ['Identificação', item.identifier],
  ].filter(([, v]) => v) as Array<[string, string]>;

  return (
    <div className="mx-auto max-w-2xl">
      <VoiceScreen itemId={item.id} label={item.name} />
      <PageHeader
        title={item.name}
        back="/app/estoque"
        subtitle={
          <span className="flex flex-wrap gap-2">
            <Badge tone={statusTone[item.statusKey]}>{item.statusLabel}</Badge>
            {item.isProvisional ? <Badge tone="amber">Avulsa</Badge> : null}
            {item.costPending ? <Badge tone="rose">Sem custo</Badge> : null}
          </span>
        }
        action={
          inStock ? (
            <Link href={`/app/estoque/${item.id}/editar`} aria-label="Editar mercadoria" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300 hover:bg-white/5">
              <Pencil className="h-5 w-5" aria-hidden />
            </Link>
          ) : null
        }
      />

      {item.costPending ? <CostPendingPanel itemId={item.id} name={item.name} /> : null}
      {item.isProvisional ? <ProvisionalItemPanel item={{ id: item.id, name: item.name }} stock={stock} /> : null}

      <div className="flex gap-4">
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária
          <img src={item.photoUrl} alt={`Foto de ${item.name}`} className="h-28 w-28 shrink-0 rounded-2xl border border-white/10 object-cover" />
        ) : (
          <span className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-white/6 text-slate-500">
            <Package className="h-10 w-10" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <Row label="Custo total" value={item.costPending ? 'Não informado' : formatBRL(item.totalCost)} strong tone="sky" />
          <Row label="Venda sugerida" value={item.targetSalePrice !== null ? formatBRL(item.targetSalePrice) : '—'} tone="emerald" />
          {item.targetSalePrice !== null ? <Row label="Margem" value={formatBRL(item.targetSalePrice - item.totalCost)} /> : null}
        </div>
      </div>

      {inStock ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {item.status === 'disponivel' ? <ButtonLink href={`/app/vendas/nova?item=${item.id}`}>Vender</ButtonLink> : <p className="self-center text-base text-amber-200">Reservado: libere para vender.</p>}
          <VoiceButton />
        </div>
      ) : null}

      {detail.origin ? (
        <p className="mt-4 text-base text-slate-300">
          Recebido em troca de <Link className="text-emerald-300 underline underline-offset-4" href={`/app/clientes/${detail.origin.customerId}`}>{detail.origin.customerName}</Link> em {formatDate(detail.origin.date)}.
        </p>
      ) : null}
      {detail.sale ? (
        <p className="mt-4 text-base text-slate-300">
          Vendido para <Link className="text-emerald-300 underline underline-offset-4" href={`/app/clientes/${detail.sale.customerId}`}>{detail.sale.customerName}</Link> em {formatDate(detail.sale.date)} por {formatBRL(detail.sale.value)}.
        </p>
      ) : null}

      <SectionTitle>Custos</SectionTitle>
      <ItemCostsPanel itemId={item.id} acquisitionCost={item.acquisitionCost} costs={detail.costs} editable={inStock} />

      {inStock ? (
        <>
          <SectionTitle>Situação</SectionTitle>
          <ItemStatusToggle itemId={item.id} status={item.status as 'disponivel' | 'reservado'} />
        </>
      ) : null}

      {attrs.length > 0 || item.description ? (
        <>
          <SectionTitle>Detalhes</SectionTitle>
          <Card>
            {attrs.map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
            {item.description ? <p className="mt-2 whitespace-pre-line text-base text-slate-300">{item.description}</p> : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
