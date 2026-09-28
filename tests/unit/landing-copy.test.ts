import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from '../../src/app/page';

const html = renderToStaticMarkup(createElement(LandingPage));
const copy = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

for (const oldClaim of [/R\$\s*24\s*[,\.]\s*(?:90|50)/i, /Plano Único/i, /Comandos de voz ilimitados/i, /83 centavos/i]) {
  assert.doesNotMatch(copy, oldClaim);
}

for (const claim of [
  /CRM Voz/,
  /Free/,
  /R\$ 0/,
  /10 clientes/,
  /20 comandos de voz\/mês/,
  /Pro/,
  /R\$ 39,90/,
  /300 comandos de voz\/mês/,
  /Pro Mais/,
  /R\$ 89,90/,
  /1000 comandos de voz\/mês/,
]) {
  assert.match(copy, claim);
}

assert.equal((html.match(/<article\b/g) ?? []).length, 3);
console.log('Landing copy OK');
