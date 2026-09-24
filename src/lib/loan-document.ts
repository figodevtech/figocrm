import type { SupabaseClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatBRL, formatDate } from '@/lib/format';

export interface LoanDocument {
  id: string;
  loan_contract_id: string;
  version: number;
  issued_at: string;
  creditor_snapshot: { name: string; business_name?: string | null; document: string; address: string; phone?: string | null };
  debtor_snapshot: { name: string; document: string; address: string; phone?: string | null };
  financial_snapshot: {
    contract_number: string;
    start_date: string;
    principal_amount: number;
    interest_type: string;
    interest_rate: number | null;
    interest_amount: number;
    total_amount: number;
    installments_count: number;
    installments: Array<{ number: number; amount: number; due_date: string }>;
  };
  terms_snapshot: { notes: string | null };
  signature_status: string;
}

export async function getLoanDocument(client: SupabaseClient, userId: string, loanId: string, version?: number): Promise<LoanDocument | null> {
  let query = client.from('loan_contract_documents').select('*').eq('user_id', userId).eq('loan_contract_id', loanId);
  if (version) query = query.eq('version', version);
  const { data, error } = await query.order('version', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Falha ao consultar contrato: ${error.message}`);
  return data as LoanDocument | null;
}

export function interestDescription(financial: LoanDocument['financial_snapshot']): string {
  if (financial.interest_type === 'fixed_amount') return financial.interest_amount ? 'Valor fixo' : 'Sem juros';
  const rate = String(financial.interest_rate ?? 0).replace('.', ',');
  return financial.interest_type === 'percent_monthly' ? `${rate}% ao mês` : `${rate}% sobre o principal`;
}

function safePdfText(value: unknown): string {
  return String(value ?? 'Não informado')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');
}

/** PDF A4 gerado no servidor a partir do snapshot imutável. */
export async function renderLoanDocumentPdf(document: LoanDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const margin = 52;
  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - margin;

  const newPage = () => { page = pdf.addPage([width, height]); y = height - margin; };
  const ensure = (needed: number) => { if (y - needed < margin + 35) newPage(); };
  const line = (value: unknown, font: PDFFont = regular, size = 10, gap = 16) => {
    const raw = safePdfText(value);
    const maxWidth = width - 2 * margin;
    const words = raw.split(/\s+/);
    let current = '';
    const draw = (text: string) => {
      ensure(gap);
      page.drawText(text || ' ', { x: margin, y, font, size, color: rgb(0.1, 0.15, 0.2) });
      y -= gap;
    };
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) { draw(current); current = word; }
      else current = candidate;
    }
    if (current) draw(current);
  };
  const section = (title: string) => { ensure(34); y -= 12; line(title, bold, 11, 20); };
  const f = document.financial_snapshot;
  const c = document.creditor_snapshot;
  const d = document.debtor_snapshot;

  line('INSTRUMENTO OPERACIONAL DE EMPRÉSTIMO', bold, 15, 25);
  line(`Contrato ${f.contract_number}  |  Versão ${document.version}  |  Emitido em ${formatDate(document.issued_at)}`, regular, 9);
  section('CREDOR');
  line(c.business_name ? `${c.name} - ${c.business_name}` : c.name);
  line(`CPF/CNPJ: ${c.document}`);
  line(`Endereço: ${c.address}`);
  section('DEVEDOR');
  line(d.name);
  line(`CPF/CNPJ: ${d.document}`);
  line(`Endereço: ${d.address}`);
  section('VALORES E JUROS');
  line(`Data do empréstimo: ${formatDate(f.start_date)}`);
  line(`Valor principal: ${formatBRL(Number(f.principal_amount))}`);
  line(`Juros: ${interestDescription(f)} - ${formatBRL(Number(f.interest_amount))}`);
  line(`Total a pagar: ${formatBRL(Number(f.total_amount))}`, bold);
  section('FORMA DE PAGAMENTO');
  line(`${f.installments_count} ${f.installments_count === 1 ? 'parcela' : 'parcelas'}:`);
  for (const installment of f.installments) {
    line(`${installment.number}. ${formatDate(installment.due_date)} - ${formatBRL(Number(installment.amount))}`);
  }
  section('TERMOS E OBSERVAÇÕES');
  line(document.terms_snapshot.notes?.trim() || 'Sem observações adicionais.');
  y -= 25;
  ensure(100);
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 210, y }, thickness: 0.6 });
  page.drawLine({ start: { x: width - margin - 210, y }, end: { x: width - margin, y }, thickness: 0.6 });
  y -= 15;
  page.drawText(safePdfText(c.name), { x: margin, y, size: 9, font: regular });
  page.drawText(safePdfText(d.name), { x: width - margin - 210, y, size: 9, font: regular });

  pdf.getPages().forEach((p, index) => p.drawText(`${index + 1} / ${pdf.getPageCount()}`, {
    x: width - margin - 35, y: 28, size: 8, font: regular, color: rgb(0.4, 0.45, 0.5),
  }));
  pdf.setTitle(`Contrato de empréstimo ${f.contract_number} - versão ${document.version}`);
  return pdf.save();
}
