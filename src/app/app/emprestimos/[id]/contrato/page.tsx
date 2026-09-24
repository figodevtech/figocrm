import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { getLoanDetail, getProfile } from '@/lib/domain/app-data';
import { getLoanDocument, interestDescription, type LoanDocument } from '@/lib/loan-document';
import { formatBRL, formatDate } from '@/lib/format';
import { LoanDocumentActions } from '@/components/app/loan-document-actions';
import { PageHeader } from '@/components/ui/layout';

export const metadata: Metadata = { title: 'Contrato de empréstimo' };

export default async function LoanDocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, user } = await requireSession();
  const loan = await getLoanDetail(supabase, user.id, id);
  if (!loan) notFound();
  const [profile, customerResult, versionsResult] = await Promise.all([
    getProfile(supabase, user.id, user.email ?? ''),
    supabase.from('customers').select('name, document, address, phone').eq('user_id', user.id).eq('id', loan.customerId).maybeSingle(),
    supabase.from('loan_contract_documents').select('version').eq('user_id', user.id).eq('loan_contract_id', id).order('version', { ascending: false }),
  ]);
  const customer = customerResult.data;
  if (!customer) notFound();
  const version = Number(query.version);
  const stored = await getLoanDocument(supabase, user.id, id, Number.isInteger(version) && version > 0 ? version : undefined);
  if (query.version && !stored) notFound();
  const latestVersion = versionsResult.data?.[0]?.version ?? 0;
  const draft: LoanDocument = {
    id: '', loan_contract_id: id, version: 0, issued_at: '', signature_status: 'unsigned',
    creditor_snapshot: { name: profile.fullName, business_name: profile.businessName, document: profile.document ?? '', address: profile.address ?? '', phone: profile.phone },
    debtor_snapshot: { name: customer.name, document: customer.document ?? '', address: customer.address ?? '', phone: customer.phone },
    financial_snapshot: { contract_number: id, start_date: loan.startDate, principal_amount: loan.principal, interest_type: loan.interestType, interest_rate: loan.interestRate, interest_amount: loan.interestAmount, total_amount: loan.total, installments_count: loan.installmentsCount, installments: loan.installments.map((i) => ({ number: i.number, amount: i.originalValue, due_date: i.dueDate })) },
    terms_snapshot: { notes: loan.notes },
  };
  const doc = stored ?? draft;
  const validDocument = (value: string | null) => !!value && /^[0-9./-]+$/.test(value) && [11, 14].includes(value.replace(/\D/g, '').length);
  const missing = [
    !profile.fullName && 'nome do credor', !validDocument(profile.document) && 'CPF/CNPJ do credor', !profile.address && 'endereço do credor',
    !customer.name && 'nome do devedor', !validDocument(customer.document) && 'CPF/CNPJ do devedor', !customer.address && 'endereço do devedor',
  ].filter(Boolean) as string[];
  const c = doc.creditor_snapshot;
  const d = doc.debtor_snapshot;
  const f = doc.financial_snapshot;
  const shown = (value: string | null | undefined) => value?.trim() || 'Não informado';

  return <div className="mx-auto max-w-3xl">
    <div className="print:hidden"><PageHeader title="Contrato de empréstimo" back={`/app/emprestimos/${id}`} /></div>
    {missing.length ? <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100 print:hidden">Faltam dados para completar o contrato: {missing.join(', ')}. Complete o <Link href="/app/conta" className="underline">perfil</Link> e o <Link href={`/app/clientes/${loan.customerId}/editar`} className="underline">cadastro do cliente</Link>.</p> : null}
    {!stored ? <p className="mb-4 rounded-xl border border-sky-400/30 bg-sky-500/10 p-4 text-sky-100 print:hidden">Prévia com dados atuais. Emita o contrato para guardar uma versão que não muda com edições futuras.</p> : null}
    <LoanDocumentActions loanId={id} issued={!!stored} canIssue={missing.length === 0} version={stored?.version} />
    {latestVersion > 1 ? <div className="mt-3 flex flex-wrap gap-2 text-sm print:hidden">Versões: {versionsResult.data?.map((v) => <Link key={v.version} href={`?version=${v.version}`} className="text-emerald-300 underline">{v.version}</Link>)}</div> : null}

    <article className="contract-document mt-6 rounded-xl bg-white p-7 text-slate-900 shadow-lg sm:p-10">
      <h1 className="text-xl font-bold uppercase tracking-wide">Instrumento operacional de empréstimo</h1>
      <p className="mt-2 text-sm">Contrato {f.contract_number} · {stored ? `Versão ${doc.version} · Emitido em ${formatDate(doc.issued_at)}` : 'Prévia não emitida'}</p>
      <Block title="Credor"><p>{shown(c.name)}{c.business_name ? ` · ${c.business_name}` : ''}</p><p>CPF/CNPJ: {shown(c.document)}</p><p>Endereço: {shown(c.address)}</p></Block>
      <Block title="Devedor"><p>{shown(d.name)}</p><p>CPF/CNPJ: {shown(d.document)}</p><p>Endereço: {shown(d.address)}</p></Block>
      <Block title="Valores e juros"><p>Data do empréstimo: {formatDate(f.start_date)}</p><p>Valor principal: {formatBRL(Number(f.principal_amount))}</p><p>Juros: {interestDescription(f)} · {formatBRL(Number(f.interest_amount))}</p><p className="font-bold">Total a pagar: {formatBRL(Number(f.total_amount))}</p></Block>
      <Block title="Forma de pagamento"><p>{f.installments_count} {f.installments_count === 1 ? 'parcela' : 'parcelas'}:</p><ol className="mt-2 list-inside list-decimal">{f.installments.map((i) => <li key={i.number}>{formatDate(i.due_date)} · {formatBRL(Number(i.amount))}</li>)}</ol></Block>
      <Block title="Termos e observações"><p className="whitespace-pre-line">{doc.terms_snapshot.notes?.trim() || 'Sem observações adicionais.'}</p></Block>
      <div className="mt-20 grid grid-cols-2 gap-8 text-center text-sm"><div className="border-t border-slate-600 pt-2">{shown(c.name)}<br />Credor</div><div className="border-t border-slate-600 pt-2">{shown(d.name)}<br />Devedor</div></div>
      <p className="mt-8 text-xs text-slate-500">Documento operacional. Assinatura eletrônica não integrada.</p>
    </article>
  </div>;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-7 break-inside-avoid"><h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold uppercase tracking-wide">{title}</h2><div className="space-y-1 text-sm">{children}</div></section>;
}
