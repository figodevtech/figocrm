import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const baseUrl = process.env.ASAAS_API_BASE_URL;
const apiKey = process.env.ASAAS_API_KEY;
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
const webhookReady = Boolean(webhookToken && !/^(?:your[-_]|replace[-_]|placeholder|changeme)/i.test(webhookToken));

if (baseUrl !== 'https://api-sandbox.asaas.com/v3') {
  console.error('Asaas: verificação permitida somente no sandbox.');
  process.exitCode = 1;
} else if (!apiKey || !apiKey.startsWith('$aact_hmlg_')) {
  console.error(apiKey?.startsWith('$aact_prod_')
    ? 'Asaas: a chave configurada é de produção; o sandbox exige uma chave própria ($aact_hmlg_).'
    : 'Asaas: chave de sandbox ausente ou com formato inesperado.');
  console.log(`Webhook: token ${webhookReady ? 'configurado' : 'ausente ou provisório'}.`);
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`${baseUrl}/myAccount/accountNumber`, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FigoCRM/1.0 (Node.js; sandbox)',
        access_token: apiKey,
      },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    console.log(`Asaas sandbox: autenticação ${response.ok ? 'aceita' : 'rejeitada'} (HTTP ${response.status}).`);
    console.log(`Webhook: token ${webhookReady ? 'configurado' : 'ausente ou provisório'}.`);
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Asaas sandbox: conexão falhou (${error instanceof Error ? error.name : 'erro'}).`);
    process.exitCode = 1;
  }
}
