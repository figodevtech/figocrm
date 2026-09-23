// scripts/generate_realworld_cases.mjs
// Gera tests/voice-benchmark/cases_realworld.json: frases novas e variadas de linguagem real
// (ruído, autocorreção, nomes parecidos, valores falados, gírias de troca/pagamento, ambiguidades,
// desfazer, renegociação). Determinístico (seed fixa). Os rótulos são corretos por construção.
// NÃO é para ajustar prompt caso a caso: serve para medir generalização.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let seed = 20260923;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

// ---------------------------------------------------------------- números por extenso
const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const parts = [];
  if (c) parts.push(CENTENAS[c]);
  if (r) parts.push(r < 20 ? UNIDADES[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ''));
  return parts.join(' e ');
}
function extenso(n) {
  const mil = Math.floor(n / 1000), resto = n % 1000;
  const m = mil === 0 ? '' : mil === 1 ? 'mil' : `${ate999(mil)} mil`;
  if (!resto) return m;
  return m ? `${m}${resto < 100 || resto % 100 === 0 ? ' e' : ''} ${ate999(resto)}` : ate999(resto);
}
const fmt = (n) => n.toLocaleString('pt-BR');

/** Forma falada clara de um valor (sem ambiguidade de unidade). */
function falado(v) {
  const forms = [String(v), fmt(v), `${fmt(v)} reais`, extenso(v)];
  if (v >= 1000 && v % 1000 === 0) forms.push(`${v / 1000} mil`, v === 1000 ? 'mil' : `${extenso(v / 1000)} mil`);
  return pick(forms);
}

// ---------------------------------------------------------------- vocabulário
const NOMES = ['Beto', 'Rogério', 'Juliana', 'Fabiana', 'Wesley', 'Cleiton', 'Neide', 'Vanderlei', 'Adriana', 'Robson', 'Kelly', 'Leandro', 'Patrícia', 'Tonho', 'Marquinhos', 'Edson', 'Sandra', 'Gilmar', 'Rose', 'Valdir'];
const COM_PRONOME = { 'Dona Célia': 'Célia', 'Seu Antônio': 'Antônio', 'Dona Lurdes': 'Lurdes', 'Seu Jorge': 'Jorge' };
const MOTOS = [['a', 'Titan 160'], ['a', 'CG 150'], ['a', 'Biz 125'], ['a', 'Pop 110'], ['a', 'Fazer 250'], ['a', 'Factor 150'], ['a', 'Twister 250'], ['a', 'NXR 160']];
const CELULARES = [['o', 'iPhone 12'], ['o', 'iPhone 11'], ['o', 'Galaxy S21'], ['o', 'Redmi Note 12'], ['o', 'Moto G84'], ['o', 'Galaxy A54']];
const COISAS = [['a', 'geladeira Brastemp'], ['o', 'notebook Lenovo'], ['a', 'bicicleta aro 29'], ['a', 'roçadeira Stihl'], ['o', 'PS4'], ['a', 'Smart TV'], ['a', 'motosserra'], ['o', 'fogão Atlas']];
const CARROS = [['o', 'Gol 2012'], ['o', 'Uno 2010'], ['o', 'Palio 2011'], ['o', 'Celta 2008'], ['a', 'Saveiro 2014']];
const RUIDO = ['rapaz, bota aí que ', 'pronto, foi o seguinte: ', 'anota aí: ', 'ó, ', 'é... ', 'olha só, ', 'então, ', 'deixa eu te falar, ', 'hoje cedo ', ''];
const FIM = ['', '', ' viu', ', beleza?', ', anota aí', ', pode lançar'];
const PAGTO = [['no pix', 'pix'], ['no Pix', 'pix'], ['em dinheiro', 'cash'], ['no dinheiro vivo', 'cash'], ['na transferência', 'bank_transfer'], ['no cartão', 'card'], ['à vista no pix', 'pix']];

function valorPara(tipo) {
  if (tipo === 'moto') return int(6, 19) * 1000 + pick([0, 0, 500]);
  if (tipo === 'celular') return int(8, 45) * 100;
  if (tipo === 'carro') return int(12, 35) * 1000;
  return int(3, 30) * 100;
}
function mercadoria() {
  const t = pick(['moto', 'moto', 'celular', 'celular', 'coisa', 'carro']);
  const [art, nome] = pick(t === 'moto' ? MOTOS : t === 'celular' ? CELULARES : t === 'carro' ? CARROS : COISAS);
  return { t, art, nome };
}
function cliente() {
  if (rand() < 0.2) {
    const falado = pick(Object.keys(COM_PRONOME));
    return { falado, esperado: COM_PRONOME[falado] };
  }
  const n = pick(NOMES);
  return { falado: n, esperado: n };
}
const FEMININOS = new Set(['Juliana', 'Fabiana', 'Neide', 'Adriana', 'Kelly', 'Patrícia', 'Sandra', 'Rose', 'Dona Célia', 'Dona Lurdes']);
const fem = (c) => FEMININOS.has(c.falado);
const pro = (c) => (fem(c) ? 'pra ' : 'pro ') + c.falado;
const doDa = (c) => (fem(c) ? 'da' : 'do');
const oA = (c) => (fem(c) ? 'a' : 'o');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const cases = [];
const add = (category, input, expected) => cases.push({ id: `RW_${String(cases.length + 1).padStart(3, '0')}`, category, input: cap(input.trim()), expected });

// ---------------------------------------------------------------- 1. venda à vista (ruído + variações)
for (let i = 0; i < 60; i++) {
  const m = mercadoria(), c = cliente(), v = valorPara(m.t), [pg] = pick(PAGTO);
  const tpl = pick([
    () => `${pick(RUIDO)}vendi ${m.art} ${m.nome} ${pro(c)} por ${falado(v)} ${pg}${pick(FIM)}.`,
    () => `${pick(RUIDO)}${c.falado} levou ${m.art} ${m.nome} por ${falado(v)}, pagou ${pg}.`,
    () => `${pick(RUIDO)}fechei ${m.art} ${m.nome} com ${oA(c)} ${c.falado} por ${falado(v)} ${pg}.`,
    () => `${pick(RUIDO)}saiu ${m.art} ${m.nome} ${pro(c)}, ${falado(v)} ${pg}${pick(FIM)}.`,
  ]);
  add('rw_venda_a_vista', tpl(), { intent: 'create_sale', customer: c.esperado, item: m.nome, totalValue: v, cashIn: v, requiresConfirmation: false });
}

// ---------------------------------------------------------------- 2. venda parcelada
for (let i = 0; i < 60; i++) {
  const m = mercadoria(), c = cliente();
  const n = int(2, 8), parcela = m.t === 'moto' || m.t === 'carro' ? int(5, 30) * 100 : int(1, 6) * 100;
  const entrada = m.t === 'moto' || m.t === 'carro' ? int(1, 8) * 1000 : int(2, 10) * 100;
  const total = entrada + n * parcela, dia = int(1, 28);
  const resto = pick([`${n} vezes de ${falado(parcela)}`, `${n}x de ${falado(parcela)}`, `${n} parcelas de ${falado(parcela)}`]);
  const tpl = pick([
    () => `${pick(RUIDO)}passei ${m.art} ${m.nome} ${pro(c)} por ${falado(total)}, deu ${falado(entrada)} de entrada e o resto em ${resto}.`,
    () => `${pick(RUIDO)}vendi ${m.art} ${m.nome} ${pro(c)} por ${falado(total)}: ${falado(entrada)} de entrada no pix e o restante ficou em ${resto} todo dia ${dia}.`,
    () => `${pick(RUIDO)}${c.falado} pegou ${m.art} ${m.nome} por ${falado(total)}, me deu ${falado(entrada)} agora e vai pagar ${resto}.`,
  ]);
  add('rw_venda_parcelada', tpl(), { intent: 'create_sale', customer: c.esperado, item: m.nome, totalValue: total, cashIn: entrada, receivable: n * parcela, installmentsCount: n, requiresConfirmation: false });
}

// ---------------------------------------------------------------- 3. autocorreção durante a fala
for (let i = 0; i < 40; i++) {
  const c = cliente();
  if (rand() < 0.6) {
    const m = mercadoria(), v = valorPara(m.t), errado = v + pick([-1000, 1000, -500, 500, -100, 100]), [pg] = pick(PAGTO);
    const corr = pick([`${falado(errado)}... não, ${falado(v)}`, `${falado(errado)}, quer dizer, ${falado(v)}`, `${falado(errado)}, não, foi ${falado(v)}`, `${falado(errado)}, aliás ${falado(v)}`]);
    add('rw_correcao', `${pick(RUIDO)}vendi ${m.art} ${m.nome} ${pro(c)} por ${corr} ${pg}.`, { intent: 'create_sale', customer: c.esperado, item: m.nome, totalValue: v, cashIn: v, requiresConfirmation: false });
  } else {
    const v = int(2, 30) * 100, errado = v + pick([-100, 100, 200]);
    add('rw_correcao', `${pick(RUIDO)}${c.falado} pagou ${falado(errado)}... não, ${falado(v)} no pix.`, { intent: 'register_payment', acceptIntents: ['register_partial_payment'], customer: c.esperado, amount: v, requiresConfirmation: false });
  }
}

// ---------------------------------------------------------------- 4. recebimentos coloquiais
for (let i = 0; i < 60; i++) {
  const c = cliente(), v = int(1, 40) * 100;
  const r = rand();
  if (r < 0.75) {
    const tpl = pick([
      () => `${c.falado} acertou comigo ${falado(v)}`,
      () => `${c.falado} mandou mais ${falado(v)} no pix`,
      () => `${c.falado} deu uma parte, ${falado(v)}`,
      () => `recebi ${falado(v)} ${doDa(c)} ${c.falado}`,
      () => `${c.falado} me passou ${falado(v)} no pix agora`,
      () => `${c.falado} pagou ${falado(v)} daquela conta`,
      () => `caiu ${falado(v)} do ${c.falado} aqui no pix`,
    ]);
    add('rw_recebimento', `${pick(RUIDO)}${tpl()}${pick(FIM)}.`, { intent: 'register_payment', acceptIntents: ['register_partial_payment'], customer: c.esperado, amount: v, requiresConfirmation: false });
  } else if (r < 0.9) {
    add('rw_recebimento', `${pick(RUIDO)}${pick([`${c.falado} quitou tudo`, `${c.falado} acertou o que faltava`, `${c.falado} pagou o resto da dívida`])}.`, { intent: 'register_payment', customer: c.esperado, requiresConfirmation: false });
  } else {
    add('rw_recebimento', `${pick(RUIDO)}${pick([`${c.falado} deu uma parte`, `${c.falado} mandou um dinheiro aí`, `${c.falado} pagou um pouco`])}.`, { intent: 'register_payment', acceptIntents: ['register_partial_payment', 'clarify_ambiguity'], customer: c.esperado, requiresConfirmation: true, unsafeExecutionForbidden: true });
  }
}

// ---------------------------------------------------------------- 5. trocas com gíria de volta
for (let i = 0; i < 60; i++) {
  const c = cliente(), sai = mercadoria(), entra = mercadoria();
  if (sai.nome === entra.nome) { i--; continue; }
  const b = int(2, 40) * 100, r = rand();
  const de = doDa(c);
  if (r < 0.4) {
    const tpl = pick([
      () => `peguei ${entra.art} ${entra.nome} ${de} ${c.falado} na troca ${sai.art === 'a' ? 'da minha' : 'do meu'} ${sai.nome} e ele completou ${falado(b)} no pix`,
      () => `troquei ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome} ${entra.art === 'a' ? 'na' : 'no'} ${entra.nome} ${de} ${c.falado} e peguei ${falado(b)} na volta`,
      () => `entrou ${entra.art} ${entra.nome} ${de} ${c.falado} na troca, saiu ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome}, e ele me voltou ${falado(b)} em dinheiro`,
    ]);
    add('rw_troca', `${pick(RUIDO)}${tpl()}.`, { intent: 'create_trade', customer: c.esperado, itemOut: sai.nome, itemIn: entra.nome, direction: 'inflow', tradeBalance: b, requiresConfirmation: false });
  } else if (r < 0.8) {
    const tpl = pick([
      () => `peguei ${entra.art} ${entra.nome} ${de} ${c.falado}, dei ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome} e completei ${falado(b)} no pix`,
      () => `entrou ${entra.art} ${entra.nome} na troca, saiu ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome} ${pro(c)} e eu voltei ${falado(b)}`,
      () => `troquei ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome} ${entra.art === 'a' ? 'na' : 'no'} ${entra.nome} ${de} ${c.falado} e tive que completar ${falado(b)} em dinheiro`,
    ]);
    add('rw_troca', `${pick(RUIDO)}${tpl()}.`, { intent: 'create_trade', customer: c.esperado, itemOut: sai.nome, itemIn: entra.nome, direction: 'outflow', tradeBalance: b, requiresConfirmation: false });
  } else {
    const tpl = pick([
      () => `troquei ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome} ${entra.art === 'a' ? 'na' : 'no'} ${entra.nome} ${de} ${c.falado} na troca seca`,
      () => `fiz troca seca com ${oA(c)} ${c.falado}: saiu ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome}, entrou ${entra.art} ${entra.nome}`,
      () => `troquei ${sai.art === 'a' ? 'minha' : 'meu'} ${sai.nome} ${entra.art === 'a' ? 'na' : 'no'} ${entra.nome} ${de} ${c.falado} elas por elas, ninguém voltou nada`,
    ]);
    add('rw_troca', `${pick(RUIDO)}${tpl()}.`, { intent: 'create_trade', customer: c.esperado, itemOut: sai.nome, itemIn: entra.nome, direction: 'even', tradeBalance: 0, requiresConfirmation: false });
  }
}

// ---------------------------------------------------------------- 6. abatimentos
for (let i = 0; i < 40; i++) {
  const c = cliente(), v = int(1, 25) * 100;
  const tpl = pick([
    () => `${c.falado} me deu ${pick(['uma caixa de som', 'um celular velho', 'um capacete', 'uma bateria'])} de ${falado(v)} pra abater`,
    () => `tira ${falado(v)} da conta ${doDa(c)} ${c.falado} que ele arrumou minha moto`,
    () => `abate ${falado(v)} da dívida ${doDa(c)} ${c.falado}, ficou de desconto`,
    () => `desconta ${falado(v)} ${doDa(c)} ${c.falado} pelo serviço que ele fez`,
  ]);
  add('rw_abatimento', `${pick(RUIDO)}${tpl()}.`, { intent: 'register_adjustment', customer: c.esperado, amount: v, requiresConfirmation: false });
}

// ---------------------------------------------------------------- 7. nomes parecidos / apelidos
const APELIDOS = [['João Paulo', 'João Paulo'], ['o João da XRE', 'João'], ['o Zé do Gol', 'Zé'], ['o Paulinho da oficina', 'Paulinho'], ['a Maria do salão', 'Maria'], ['o Carlos Eduardo', 'Carlos Eduardo']];
for (let i = 0; i < 30; i++) {
  const [falado_, esperado] = pick(APELIDOS), v = int(2, 30) * 100;
  add('rw_nomes', `${pick(RUIDO)}${pick([`${falado_} pagou ${falado(v)}`, `${falado_} mandou ${falado(v)} no pix`, `recebi ${falado(v)} ${falado_.startsWith('a ') ? 'da' : falado_.startsWith('o ') ? 'do' : 'do'} ${falado_.replace(/^(o|a) /, '')}`])}.`,
    { intent: 'register_payment', acceptIntents: ['register_partial_payment'], customer: esperado, amount: v, requiresConfirmation: false });
}

// ---------------------------------------------------------------- 8. valores falados (gírias e formas curtas)
for (let i = 0; i < 40; i++) {
  const c = cliente(), [pg] = pick(PAGTO), r = rand();
  if (r < 0.3) {
    const mil = int(2, 9), cem = int(2, 9) * 100;
    add('rw_valores', `${pick(RUIDO)}vendi ${pick(['o celular', 'o iPhone 11', 'a bicicleta aro 29'])} ${pro(c)} por ${extenso(mil)} e ${extenso(cem)} ${pg}.`,
      { intent: 'create_sale', customer: c.esperado, totalValue: mil * 1000 + cem, cashIn: mil * 1000 + cem, requiresConfirmation: false });
  } else if (r < 0.55) {
    const mil = int(2, 9), d = int(1, 9);
    const falaCurta = pick([`${extenso(mil)} ${extenso(d * 100)}`, `${mil} e ${d}`]);
    add('rw_valores', `${pick(RUIDO)}vendi ${pick(['o Moto G84', 'o notebook Lenovo', 'a Smart TV'])} ${pro(c)} por ${falaCurta} ${pg}.`,
      { intent: 'create_sale', acceptIntents: ['clarify_ambiguity'], customer: c.esperado, totalValue: mil * 1000 + d * 100, cashIn: mil * 1000 + d * 100, requiresConfirmation: false, allowConfirmation: true, note: 'Forma curta regional: perguntar ou executar com o valor certo são aceitáveis.' });
  } else if (r < 0.8) {
    const v = int(10, 90);
    add('rw_valores', `${pick(RUIDO)}vendi ${pick(['uma capinha', 'um carregador', 'um fone', 'uma película'])} ${pro(c)} por ${extenso(v)} conto ${pg}.`,
      { intent: 'create_sale', customer: c.esperado, totalValue: v, cashIn: v, requiresConfirmation: false });
  } else {
    const v = int(2, 15);
    add('rw_valores', `${pick(RUIDO)}${c.falado} me pagou ${extenso(v)} pau ${pg}.`,
      { intent: 'register_payment', acceptIntents: ['register_partial_payment'], customer: c.esperado, amount: v * 1000, requiresConfirmation: false });
  }
}

// ---------------------------------------------------------------- 9. ambiguidade real (tem que perguntar)
const AMBIG = [
  () => 'Ele me deu três.',
  () => `O ${pick(NOMES)} pagou uma parte.`,
  () => `Vendi ${pick(MOTOS)[1] === 'Biz 125' ? 'a Biz' : 'a moto'} pro ${pick(NOMES)}.`,
  () => `Recebi do ${pick(NOMES)}.`,
  () => `Passei o celular pro ${pick(NOMES)}, depois ele acerta.`,
  () => `Troquei com o ${pick(NOMES)} e ficou uma volta aí.`,
  () => 'Apaga tudo que eu lancei hoje.',
  () => `Ficou faltando dois do ${pick(NOMES)}.`,
  () => `O ${pick(NOMES)} mandou aquele dinheiro.`,
  () => 'Lança aquilo que eu te falei.',
];
for (let i = 0; i < 40; i++) {
  add('rw_ambiguidade', pick(AMBIG)(), { intent: 'clarify_ambiguity', acceptIntents: ['create_sale', 'create_trade', 'register_payment', 'register_partial_payment', 'unrecognized_command'], requiresConfirmation: true, unsafeExecutionForbidden: true });
}

// ---------------------------------------------------------------- 10. desfazer e renegociação
for (let i = 0; i < 30; i++) {
  const c = cliente(), v = int(2, 20) * 100, de = doDa(c);
  if (rand() < 0.5) {
    const kind = pick(['pagamento', 'abatimento']);
    add('rw_desfazer', `${pick(RUIDO)}${pick([`desfaz aquele ${kind} de ${falado(v)} ${de} ${c.falado}`, `estorna o ${kind} de ${falado(v)} ${de} ${c.falado}`, `lancei errado, desfaz o ${kind} de ${falado(v)} ${de} ${c.falado}`])}.`,
      { intent: 'reverse_operation', customer: c.esperado, amount: v, requiresConfirmation: false });
  } else {
    const n = int(2, 6), p = int(2, 10) * 100, dia = int(1, 28);
    add('rw_renegociacao', `${pick(RUIDO)}${pick([`junta as atrasadas ${de} ${c.falado} e faz em ${n} de ${falado(p)} todo dia ${dia}`, `renegocia a dívida ${de} ${c.falado} em ${n} vezes de ${falado(p)} todo dia ${dia}`, `refaz as parcelas ${de} ${c.falado}: ${n} de ${falado(p)}, vencendo dia ${dia}`])}.`,
      { intent: 'renegotiate_debt', customer: c.esperado, installmentsCount: n, installmentAmount: p, dueDay: dia, requiresConfirmation: false });
  }
}

const out = path.resolve(__dirname, '../tests/voice-benchmark/cases_realworld.json');
fs.writeFileSync(out, JSON.stringify(cases, null, 2) + '\n');
const byCat = cases.reduce((a, c) => ((a[c.category] = (a[c.category] || 0) + 1), a), {});
console.log(`${cases.length} casos gerados em ${path.relative(process.cwd(), out)}`, byCat);
