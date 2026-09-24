import { createClient } from '@/lib/supabase/server';
import { getLoanDocument, renderLoanDocumentPdf } from '@/lib/loan-document';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autenticado.', { status: 401 });
  const rawVersion = new URL(request.url).searchParams.get('version');
  const version = rawVersion ? Number(rawVersion) : undefined;
  if (rawVersion && (!Number.isInteger(version) || (version ?? 0) < 1)) return new Response('Versão inválida.', { status: 400 });
  const document = await getLoanDocument(supabase, user.id, id, version);
  if (!document) return new Response('Contrato não emitido.', { status: 404 });
  const pdf = await renderLoanDocumentPdf(document);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="contrato-${id}-v${document.version}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
