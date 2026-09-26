import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Termos de Uso' };

export default function TermsPage() {
  return <main className="mx-auto max-w-3xl px-5 py-12 text-slate-200">
    <Link href="/" className="text-emerald-300 hover:underline">← FigoCRM</Link>
    <h1 className="mt-8 text-3xl font-bold text-white">Termos de Uso</h1>
    <p className="mt-3 text-sm text-slate-400">Versão de 26 de setembro de 2026. Texto sujeito a revisão jurídica antes do beta público.</p>
    <div className="mt-8 space-y-7 leading-relaxed">
      <section><h2 className="text-xl font-semibold text-white">1. Serviço</h2><p>O FigoCRM ajuda vendedores e revendedores a registrar clientes, estoque, negócios, pagamentos e empréstimos. O usuário confere os dados e decide como usar os registros. O serviço não substitui contabilidade, assessoria financeira ou jurídica.</p></section>
      <section><h2 className="text-xl font-semibold text-white">2. Conta e dados</h2><p>Você deve informar dados corretos, proteger sua senha e ter autorização para cadastrar informações de terceiros. Você é responsável por revisar valores, contratos, vencimentos e resultados antes de tomar decisões ou compartilhar documentos.</p></section>
      <section><h2 className="text-xl font-semibold text-white">3. Planos e cobranças</h2><p>O Free custa R$ 0 e inclui até 10 clientes e 20 comandos de voz por mês. O Pro custa R$ 39,90 por mês, com clientes ilimitados e 300 comandos de voz por mês. O Pro Mais custa R$ 89,90 por mês, com clientes ilimitados e 1.000 comandos de voz por mês. Os preços e limites aplicáveis são exibidos antes da contratação.</p><p className="mt-2">Planos pagos têm cobrança recorrente mensal pelo Asaas. A renovação ocorre conforme a data informada no checkout. Você pode cancelar a renovação na área Conta; o acesso pago permanece até o fim do período já pago. Um plano antigo com preço contratado diferente pode manter suas condições até uma alteração aceita pelo usuário.</p></section>
      <section><h2 className="text-xl font-semibold text-white">4. Disponibilidade e IA</h2><p>Trabalhamos para manter o serviço disponível, mas podem ocorrer interrupções para manutenção ou por falhas de infraestrutura. Comandos de voz e recursos de IA podem interpretar informações de modo incorreto. Confirme nomes, quantias, datas e ações antes de salvar.</p></section>
      <section><h2 className="text-xl font-semibold text-white">5. Responsabilidade</h2><p>O FigoCRM não garante resultados comerciais, recebimentos ou validade jurídica de contratos gerados. Na extensão permitida pela lei aplicável, não respondemos por prejuízos decorrentes de dados incorretos fornecidos pelo usuário ou de decisões tomadas sem conferir os registros. Direitos legais do consumidor permanecem preservados.</p></section>
      <section><h2 className="text-xl font-semibold text-white">6. Encerramento e alterações</h2><p>Você pode solicitar o encerramento da conta na área Conta. Alguns registros poderão ser retidos pelo prazo necessário para obrigações legais, prevenção de fraude e resolução de disputas, conforme a Política de Privacidade. Podemos atualizar estes termos; mudanças relevantes serão comunicadas pelo serviço ou e-mail antes de entrarem em vigor quando exigido.</p></section>
      <section><h2 className="text-xl font-semibold text-white">7. Contato</h2><p>Para dúvidas, use a <Link href="/suporte" className="text-emerald-300 underline">página de suporte</Link>. Consulte também a <Link href="/privacidade" className="text-emerald-300 underline">Política de Privacidade</Link>.</p></section>
    </div>
  </main>;
}
