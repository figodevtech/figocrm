import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { listCustomers, listStock } from '@/lib/domain/app-data';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Para completar' };

export default async function PendingPage() {
  const { supabase, user } = await requireSession();
  const [customers, items] = await Promise.all([listCustomers(supabase, user.id), listStock(supabase, user.id)]);
  const provisionalCustomers = customers.filter((c) => c.isProvisional);
  const costPending = items.filter((i) => i.costPending);
  const provisionalItems = items.filter((i) => i.isProvisional);
  const total = provisionalCustomers.length + costPending.length + provisionalItems.length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Para completar" back="/app" subtitle="Você pode continuar vendendo e recebendo normalmente." />
      <p className="mb-5 text-base text-slate-300">{total ? `${total} ${total === 1 ? 'tarefa' : 'tarefas'} para revisar` : 'Tudo em dia por aqui.'}</p>

      <section id="custos" className="mb-6 scroll-mt-20">
        <h2 className="mb-2 text-lg font-semibold text-white">Informar custo · {costPending.length}</h2>
        <div className="grid gap-2">
          {costPending.map((item) => <PendingLink key={item.id} href={`/app/estoque/${item.id}`} title={item.name} detail="Falta informar quanto custou. O lucro da venda está pendente." action="Informar custo" />)}
          {!costPending.length ? <Empty>Não há vendas esperando custo.</Empty> : null}
        </div>
      </section>

      <section id="clientes" className="mb-6 scroll-mt-20">
        <h2 className="mb-2 text-lg font-semibold text-white">Clientes avulsos · {provisionalCustomers.length}</h2>
        <div className="grid gap-2">
          {provisionalCustomers.map((customer) => <PendingLink key={customer.id} href={`/app/clientes/${customer.id}`} title={customer.name} detail="Complete o cadastro ou vincule a um cliente existente." action="Revisar cliente" />)}
          {!provisionalCustomers.length ? <Empty>Não há clientes avulsos.</Empty> : null}
        </div>
      </section>

      <section id="mercadorias" className="scroll-mt-20">
        <h2 className="mb-2 text-lg font-semibold text-white">Mercadorias avulsas · {provisionalItems.length}</h2>
        <div className="grid gap-2">
          {provisionalItems.map((item) => <PendingLink key={item.id} href={`/app/estoque/${item.id}`} title={item.name} detail="Vincule ao estoque ou confirme como mercadoria independente." action="Revisar mercadoria" />)}
          {!provisionalItems.length ? <Empty>Não há mercadorias avulsas.</Empty> : null}
        </div>
      </section>
    </div>
  );
}

function PendingLink({ href, title, detail, action }: { href: string; title: string; detail: string; action: string }) {
  return <Link href={href} className="block rounded-2xl border border-white/10 bg-slate-900/70 p-4 hover:border-amber-300/40">
    <span className="block text-base font-semibold text-white">{title}</span>
    <span className="mt-1 block text-sm text-slate-300">{detail}</span>
    <span className="mt-2 block text-sm font-semibold text-amber-200">{action} →</span>
  </Link>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-white/5 p-4 text-sm text-slate-400">{children}</p>;
}
