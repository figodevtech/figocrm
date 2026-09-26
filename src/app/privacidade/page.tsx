import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Política de Privacidade' };

export default function PrivacyPage() {
  return <main className="mx-auto max-w-3xl px-5 py-12 text-slate-200">
    <Link href="/" className="text-emerald-300 hover:underline">← FigoCRM</Link>
    <h1 className="mt-8 text-3xl font-bold text-white">Política de Privacidade</h1>
    <p className="mt-3 text-sm text-slate-400">Versão de 26/09/2026. Texto sujeito a revisão jurídica antes do beta público.</p>
    <div className="mt-8 space-y-7 leading-relaxed">
      <section><h2 className="text-xl font-semibold text-white">Dados tratados</h2><p>Coletamos dados de cadastro e contato, informações que você registra sobre clientes, itens, negócios, pagamentos e empréstimos, dados de uso necessários para operar limites do plano e registros técnicos de segurança e diagnóstico. Não armazenamos dados completos de cartão; o checkout é operado pelo Asaas.</p></section>
      <section><h2 className="text-xl font-semibold text-white">Finalidades</h2><p>Usamos esses dados para criar e proteger a conta, executar as funções do CRM, processar assinatura, atender suporte, prevenir abuso e cumprir obrigações legais. Os registros de clientes e negócios inseridos por você são usados para oferecer as funções que você solicitou.</p></section>
      <section><h2 className="text-xl font-semibold text-white">Serviços terceiros</h2><p>O Supabase hospeda autenticação e banco de dados; a Vercel hospeda a aplicação; o Asaas processa cobranças; a OpenAI pode processar conteúdo enviado aos recursos de voz e IA. Compartilhamos com cada serviço apenas os dados necessários à finalidade correspondente, sujeitos às condições e medidas de segurança desses fornecedores.</p></section>
      <section><h2 className="text-xl font-semibold text-white">Retenção e segurança</h2><p>Os dados ficam disponíveis enquanto a conta estiver ativa. Após pedido de encerramento, avaliamos exclusão ou anonimização conforme obrigações legais, financeiras, prevenção de fraude e disputas. Usamos controles de acesso por conta, autenticação e transporte criptografado. Nenhum sistema oferece segurança absoluta.</p></section>
      <section><h2 className="text-xl font-semibold text-white">Seus direitos</h2><p>Você pode corrigir dados do perfil, exportar os dados da conta e solicitar seu encerramento na área Conta. Para acesso, correção, exclusão ou outras solicitações previstas na LGPD, entre em contato pelo <Link href="/suporte" className="text-emerald-300 underline">suporte</Link>. Podemos pedir confirmação de identidade antes de atender.</p></section>
      <section><h2 className="text-xl font-semibold text-white">Mudanças e contato</h2><p>Podemos atualizar esta política e informaremos mudanças relevantes. Para questões de privacidade, use a <Link href="/suporte" className="text-emerald-300 underline">página de suporte</Link>. Veja também os <Link href="/termos" className="text-emerald-300 underline">Termos de Uso</Link>.</p></section>
    </div>
  </main>;
}
