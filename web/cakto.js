const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");

// offer.id (link de pagamento) → plano interno + ciclo de cobrança. Vem dos
// 9 links que o Samuel mandou (3 planos × 3 ciclos). O slug do "Standard
// Mensal" tem um sufixo diferente dos outros 8 (assinatura em vez de
// pagamento único?) — ainda não confirmado contra um payload real, ver
// aviso em CAKTO_OFFER_ID_NEEDS_CONFIRMATION abaixo.
const CAKTO_OFFER_PLAN_MAP = {
  n9nmo5z: { plan: "agencia", billingCycle: "anual", label: "Enterprise Anual" },
  i34oc79: { plan: "pro", billingCycle: "anual", label: "PRO Anual" },
  zfj4e84: { plan: "solo", billingCycle: "anual", label: "Standard Anual" },
  "39f359d": { plan: "pro", billingCycle: "trimestral", label: "PRO Trimestral" },
  w4vvcev: { plan: "solo", billingCycle: "trimestral", label: "Standard Trimestral" },
  "3do9zbx": { plan: "agencia", billingCycle: "trimestral", label: "Enterprise Trimestral" },
  "3gx6bit": { plan: "agencia", billingCycle: "mensal", label: "Enterprise Mensal" },
  t9c4v6c: { plan: "pro", billingCycle: "mensal", label: "PRO Mensal" },
  "52ytvd7": { plan: "solo", billingCycle: "mensal", label: "Standard Mensal" },
};

// Nomes confirmados na documentação oficial da Cakto
// (docs.cakto.com.br/conceitos/webhooks.md, lido em 2026-08-24) — não são
// mais chute, mas TAMBÉM nunca foram testados contra um payload real de
// cada um (só o "purchase_approved" veio de uma compra de teste de
// verdade). Antes de confiar 100%, dispare um "Evento de Teste" de cada um
// desses no painel da Cakto (Integrações → Webhooks → seu webhook → testar)
// e confira no log do Railway se handleCancellationEvent achou a
// organização certa. "subscription_renewal_refused" (pagamento da
// renovação recusado) fica de fora de propósito — não é bem um
// cancelamento, precisa decidir com o Samuel se isso também suspende ou só
// avisa.
const CANCELLATION_EVENTS = new Set(["refund", "chargeback", "subscription_canceled"]);

// Senha PLACEHOLDER — ninguém nunca vê esse valor, nem loga, nem entrega
// em lugar nenhum. Existe só porque password_hash é NOT NULL. A conta
// nasce com needs_password_setup=true (ver createUser abaixo); a pessoa
// escolhe a PRÓPRIA senha de verdade em POST /registrar (server.js),
// provando que é dona da compra ao digitar o mesmo email usado na Cakto.
// Longa e aleatória de propósito — mesmo sendo descartada, não custa nada
// ela ser inadivinhável enquanto existir.
function generateUnusablePlaceholderPassword() {
  return crypto.randomBytes(32).toString("base64url");
}

// Compara o secret do corpo do webhook contra CAKTO_WEBHOOK_SECRET.
// timingSafeEqual exige buffers do mesmo tamanho — se o secret recebido tem
// tamanho diferente do configurado já não bate mesmo, então cai direto no
// "false" sem chamar timingSafeEqual (que lançaria erro no length mismatch).
function isValidSecret(received) {
  const expected = process.env.CAKTO_WEBHOOK_SECRET;
  if (!expected || !received || typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handlePurchaseApproved(data) {
  const email = String(data.customer?.email || "").trim().toLowerCase();
  const name = String(data.customer?.name || "").trim();
  const offerId = data.offer?.id;
  if (!email || !name || !offerId) {
    throw new Error(`payload incompleto pra criar organização (email=${email || "?"}, name=${name || "?"}, offerId=${offerId || "?"})`);
  }

  const mapping = CAKTO_OFFER_PLAN_MAP[offerId];
  if (!mapping) {
    throw new Error(
      `offer.id "${offerId}" não está mapeado em CAKTO_OFFER_PLAN_MAP (web/cakto.js) — compra ${data.id} de ${email} NÃO gerou acesso, mapeie manualmente ou adicione essa oferta no código`
    );
  }

  const planLabel = db.planLimitsFor(mapping.plan).label;

  const existing = await db.findUserByEmail(email);
  if (existing) {
    // Já existe usuário com esse email. Se a organização dele já veio de
    // uma compra Cakto anterior, tratamos como renovação (mesma pessoa
    // comprando de novo no ciclo seguinte) — estende o plano em vez de
    // tentar criar tudo de novo. Se não veio da Cakto (conta criada
    // manualmente pelo admin, ou de outra organização), não sabemos o que
    // fazer com segurança — melhor falhar alto (fica visível no log e no
    // painel da Cakto) do que silenciosamente ignorar uma compra paga.
    const org = existing.organization_id ? await db.getOrganizationById(existing.organization_id) : null;
    if (org && org.cakto_purchase_id) {
      await db.renewOrganization(org.id, mapping.plan, mapping.billingCycle);
      await db.logAdminAction(
        null,
        "Cakto (automático)",
        existing.id,
        existing.name,
        "org_renewed",
        `Plano ${planLabel} · ${mapping.billingCycle} · renovação via Cakto, compra ${data.id}`
      );
      console.log(`Webhook Cakto: organização "${org.name}" renovada (${planLabel}/${mapping.billingCycle}) a partir da compra ${data.id}.`);
      return;
    }
    throw new Error(
      `já existe um usuário com o email ${email} (id ${existing.id}) que não veio da Cakto — compra ${data.id} não foi processada automaticamente, revise manualmente`
    );
  }

  const passwordHash = await bcrypt.hash(generateUnusablePlaceholderPassword(), 10);
  const org = await db.createOrganizationFromCakto({
    name: `${name} (Cakto)`,
    plan: mapping.plan,
    billingCycle: mapping.billingCycle,
    notes: `Criado automaticamente via webhook Cakto, compra ${data.id}, oferta "${mapping.label}"`,
    purchaseId: data.id,
    customerEmail: email,
  });
  const user = await db.createUser({
    name,
    email,
    passwordHash,
    role: "collaborator",
    organizationId: org.id,
    needsPasswordSetup: true,
  });
  await db.logAdminAction(
    null,
    "Cakto (automático)",
    user.id,
    user.name,
    "created",
    `Plano ${planLabel} · ${mapping.billingCycle} · compra Cakto ${data.id}`
  );
  console.log(`Webhook Cakto: organização "${org.name}" e usuário ${email} criados (${planLabel}/${mapping.billingCycle}) a partir da compra ${data.id}.`);
}

async function handleCancellationEvent(data, eventName) {
  const email = String(data.customer?.email || "").trim().toLowerCase();
  let org = data.id ? await db.findOrganizationByCaktoPurchaseId(data.id) : null;
  if (!org && email) org = await db.findOrganizationByCaktoEmail(email);
  if (!org) {
    throw new Error(
      `evento "${eventName}" (compra ${data.id}, email ${email || "?"}) não achou nenhuma organização Cakto pra suspender — revise manualmente`
    );
  }
  await db.updateOrganizationExpiry(org.id, new Date());
  await db.logAdminAction(
    null,
    "Cakto (automático)",
    null,
    org.name,
    "org_renewed",
    `Acesso suspenso automaticamente (evento Cakto "${eventName}", compra ${data.id})`
  );
  console.log(`Webhook Cakto: organização "${org.name}" suspensa (evento "${eventName}", compra ${data.id}).`);
}

// "subscription_renewed": renovação de assinatura recorrente — diferente
// do fallback de renovação dentro de handlePurchaseApproved (que cobre o
// caso de a Cakto reenviar "purchase_approved" a cada ciclo). Ainda não
// testado contra um payload real, então não sabemos se data.offer vem
// preenchido aqui — se não vier, mantém o plano/ciclo que a organização já
// tinha (só estende a validade).
async function handleSubscriptionRenewed(data) {
  const email = String(data.customer?.email || "").trim().toLowerCase();
  let org = data.id ? await db.findOrganizationByCaktoPurchaseId(data.id) : null;
  if (!org && email) org = await db.findOrganizationByCaktoEmail(email);
  if (!org) {
    throw new Error(
      `evento "subscription_renewed" (compra ${data.id}, email ${email || "?"}) não achou organização Cakto pra renovar — revise manualmente`
    );
  }
  const mapping = data.offer?.id ? CAKTO_OFFER_PLAN_MAP[data.offer.id] : null;
  const plan = mapping ? mapping.plan : org.plan;
  const billingCycle = mapping ? mapping.billingCycle : org.billing_cycle;
  await db.renewOrganization(org.id, plan, billingCycle);
  await db.logAdminAction(
    null,
    "Cakto (automático)",
    null,
    org.name,
    "org_renewed",
    `Renovação automática via Cakto (evento subscription_renewed, compra ${data.id})`
  );
  console.log(`Webhook Cakto: organização "${org.name}" renovada (evento subscription_renewed, compra ${data.id}).`);
}

// Handler principal, chamado pela rota POST /api/webhooks/cakto em
// server.js. Devolve { status, body } em vez de mexer em req/res
// diretamente, só pra ficar fácil de testar isolado se um dia precisar.
async function handleCaktoWebhook(body) {
  if (!isValidSecret(body?.secret)) {
    console.error("Webhook Cakto: secret inválido ou CAKTO_WEBHOOK_SECRET não configurado.");
    return { status: 401, body: { error: "unauthorized" } };
  }

  const event = body?.event;
  const data = body?.data;
  if (!event || !data?.id) {
    return { status: 400, body: { error: "payload inválido, faltando event ou data.id" } };
  }

  // BUG CORRIGIDO (derrubou o app em produção, 2026-08-25): essa chamada
  // ficava FORA do try/catch abaixo. Qualquer falha aqui (ex: soluço de
  // conexão com o Postgres) virava uma promise rejeitada sem ninguém pra
  // pegar — como não tem handler de unhandledRejection nesse processo,
  // o Node inteiro cai, derrubando o app pra todo mundo, não só essa rota.
  // Por isso TUDO que faz await nesta função (webhook inteiro) precisa
  // estar dentro do try. Nunca deixe um await solto aqui de novo.
  try {
    const isNew = await db.recordCaktoEvent(data.id, event);
    if (!isNew) {
      // Reenvio da Cakto (retry dela) do mesmo evento — já processamos,
      // responde 200 sem fazer nada de novo (idempotência).
      return { status: 200, body: { ok: true, duplicate: true } };
    }

    if (event === "purchase_approved") {
      await handlePurchaseApproved(data);
    } else if (CANCELLATION_EVENTS.has(event)) {
      await handleCancellationEvent(data, event);
    } else if (event === "subscription_renewed") {
      await handleSubscriptionRenewed(data);
    } else {
      console.warn(`Webhook Cakto: evento "${event}" recebido (compra ${data.id}) mas ainda não é tratado automaticamente — só logado.`);
      await db.updateCaktoEventStatus(data.id, event, "ignored_event");
      return { status: 200, body: { ok: true, handled: false } };
    }
    await db.updateCaktoEventStatus(data.id, event, "processed");
    return { status: 200, body: { ok: true } };
  } catch (err) {
    console.error(`Webhook Cakto: erro processando evento "${event}" (compra ${data.id}):`, err.message);
    // Best-effort: se o banco já tava com problema (motivo mais provável de
    // termos caído no catch em primeiro lugar), essa segunda query pode
    // falhar de novo — não deixa isso derrubar o processo, só loga.
    try {
      await db.updateCaktoEventStatus(data.id, event, "error", err.message);
    } catch (innerErr) {
      console.error(`Webhook Cakto: falha ao registrar status de erro do evento (compra ${data.id}):`, innerErr.message);
    }
    return { status: 500, body: { error: "internal error" } };
  }
}

module.exports = { handleCaktoWebhook, CAKTO_OFFER_PLAN_MAP, CANCELLATION_EVENTS };
