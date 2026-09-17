// Cobrança direta pela API da Cakto (Módulo de Assinatura, 2026-09-17) —
// diferente de cakto.js (que só RECEBE webhooks de compras feitas no
// checkout deles): aqui é o NOSSO servidor que inicia a cobrança, a partir
// da tela /assinar (SDK deles no navegador tokeniza o cartão + autentica
// 3DS, a gente só recebe o token e fecha a cobrança). Documentação seguida
// à risca: docs.cakto.com.br/sdk/3ds.md, seção "No seu backend".
//
// Credenciais SEPARADAS das do webhook (CAKTO_WEBHOOK_SECRET) — essa aqui é
// uma chave de API de verdade (client_id/client_secret, escopo Pagamentos),
// só existe como variável de ambiente no Railway, nunca no código nem no git.

const CAKTO_API_BASE = "https://api.cakto.com.br";

let cachedToken = null; // { accessToken, expiresAt (epoch ms) }

async function getBearerToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }
  const clientId = process.env.CAKTO_API_CLIENT_ID;
  const clientSecret = process.env.CAKTO_API_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("CAKTO_API_CLIENT_ID/CAKTO_API_CLIENT_SECRET não configurados no ambiente.");
  }
  const resp = await fetch(`${CAKTO_API_BASE}/public_api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!resp.ok) {
    throw new Error(`Falha ao autenticar na API da Cakto (HTTP ${resp.status}).`);
  }
  const data = await resp.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in || 0) * 1000 };
  return cachedToken.accessToken;
}

// `idempotencyKey` (a Cakto exige, ver docs.cakto.com.br/api-reference/
// payments/create) — usamos o email normalizado + offerId, então um duplo
// clique/retry do mesmo formulário não cria duas cobranças pro mesmo email
// na mesma oferta (a Cakto devolve a MESMA resposta de antes por até 24h
// pra chave repetida, em vez de cobrar duas vezes).
async function createTrialPayment({ offerId, customer, address, cardToken, threeDSecure, antifraudReference, idempotencyKey }) {
  const token = await getBearerToken();
  const resp = await fetch(`${CAKTO_API_BASE}/public_api/payments/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      paymentMethod: "threeDs",
      customer,
      address,
      items: [{ offerId }],
      card: { token: cardToken },
      threeDSecure,
      antifraud_profiling_attempt_reference: antifraudReference,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = data?.detail || `Pagamento recusado (HTTP ${resp.status}).`;
    const err = new Error(detail);
    err.status = resp.status;
    err.caktoDetail = data;
    throw err;
  }
  return data; // { id, status, offer: {...}, ... } — ver api-reference/payments/create
}

module.exports = { createTrialPayment };
