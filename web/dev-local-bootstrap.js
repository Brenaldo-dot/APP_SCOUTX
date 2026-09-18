// Sobe o ScoutX (web) LOCAL contra um Postgres real em memória (pg-mem), sem
// precisar de Docker/Postgres instalado na máquina — só pra revisão visual
// das telas novas (Indicação), não é ambiente de produção nem persiste nada
// entre reinícios. Roda o server.js/db.js DE VERDADE, sem reescrever a
// lógica: intercepta só o `require("pg")` pra devolver o Pool/Client
// fake do pg-mem em vez do driver real.
//
// Limitação conhecida (achada testando as queries de Indicação): pg-mem não
// reproduz certinho `ON CONFLICT ... DO NOTHING RETURNING` (devolve a linha
// conflitante em vez de vazio) — só afeta a idempotência de reenvio de
// webhook da Cakto, que não é testável aqui mesmo (não temos requisição real
// da Cakto local). Não afeta nada do que dá pra clicar na tela.
const Module = require("module");
const { newDb } = require("pg-mem");

const mem = newDb({ autoCreateForeignKeyIndices: true });
mem.public.registerFunction({ name: "now", returns: "timestamp", implementation: () => new Date() });
const fakePg = mem.adapters.createPg();

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "pg") return fakePg;
  return originalLoad.apply(this, arguments);
};

process.env.APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3001";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "dev-local-only-session-secret-nao-usar-em-producao";
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "dev-local-only-internal-secret";
process.env.CAKTO_WEBHOOK_SECRET = process.env.CAKTO_WEBHOOK_SECRET || "dev-local-only-cakto-secret";
// DATABASE_URL de propósito NÃO setada — db.js.ensureMineradorDatabase()
// pula inteiro quando não existe (ver db.js), o que é o certo aqui: pg-mem
// não suporta CREATE DATABASE/pg_database.
// MINERADOR_API_URL de propósito não setada — telas que dependem do FastAPI
// (Concorrentes, Produtos, etc.) vão dar erro de proxy se você navegar até
// elas, mas Indicação/Suporte/Minha Conta/Afiliados não precisam disso.

// NÃO usar `require("./server.js")` puro: o auto-start ali dentro só roda
// se `require.main === module` (rodando `node server.js` direto), o que
// nunca é verdade quando é OUTRO arquivo (este) que dá o require nele —
// então chama startServer() explicitamente aqui.
const bcrypt = require("bcryptjs");
const db = require("./db.js");
const { startServer } = require("./server.js");

// Seed de conta admin pra dev local (pedido do Samuel, 2026-09-11): pg-mem
// zera tudo a cada restart do processo, então sem isso toda mudança no
// server.js/db.js que exige reiniciar o node fazia cair de novo no /setup.
// Credenciais fixas SÓ PARA ESTE BOOTSTRAP LOCAL (nunca usar em produção).
const DEV_ADMIN_NAME = "Samuel";
const DEV_ADMIN_EMAIL = "samuelslaviero@hotmail.com";
const DEV_ADMIN_PASSWORD = "samu1234567@";

async function seedDevAdmin() {
  const existing = await db.countUsers();
  if (existing > 0) return;
  const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);
  await db.createUser({ name: DEV_ADMIN_NAME, email: DEV_ADMIN_EMAIL, passwordHash, role: "admin" });
  console.log(`Conta admin de dev criada automaticamente: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`);
}

// Seed da Comunidade (pedido do Samuel: ver o design pronto sem repetir
// setup manual a cada restart). Cadastra o próprio DEV_ADMIN_EMAIL como
// afiliado/embaixador (mesmo truque que o app usa em produção: comparar
// email da sessão com affiliates.cakto_email) e já cria a comunidade dele
// com um post de exemplo, pra abrir a aba Comunidade direto com conteúdo.
async function seedDevCommunity() {
  const existingAffiliate = await db.findAffiliateByCaktoEmail(DEV_ADMIN_EMAIL);
  if (existingAffiliate) return;
  const affiliate = await db.createAffiliate({
    name: DEV_ADMIN_NAME,
    caktoEmail: DEV_ADMIN_EMAIL,
    pixKey: null,
    // Mesmos valores padrão do formulário de cadastro (ver emptyForm em
    // Afiliados.jsx) — usar outro número aqui só pra dev mascarava o real
    // (o Samuel viu "50%/0%" na tela achando que era a regra de verdade).
    firstSalePercentage: 40,
    recurringPercentage: 25,
  });
  const community = await db.createCommunity(affiliate.id, "Comunidade do Samuel", null);
  await db.updateCommunityDetails(community.id, { accentColor: "blue" });
  const channels = await db.listCommunityChannels(community.id);
  await db.createCommunityPost({
    communityId: community.id,
    channelId: channels[0].id,
    body: "Bem-vindo à comunidade! Esse é um post de exemplo criado automaticamente pro ambiente de dev local.",
    imageUrl: null,
  });
  await db.createCommunityResource({
    communityId: community.id,
    kind: "video",
    title: "Como encontrar produtos vencedores",
    body: null,
    url: null,
    durationLabel: "12 min",
  });
  // Membro de demonstração, já com alguns meses de "antiguidade" (pra ver o
  // selo de nível do membro renderizado de cara, ver MEMBER_LEVELS no
  // frontend) — sem isso o único jeito de ver o selo era criar uma segunda
  // conta manualmente, logar como ela e comentar, o que não dá pra fazer
  // aqui (nunca digitamos senha pelo assistente).
  const demoOrg = await db.createOrganization({ name: "Organização Demo", plan: "solo", billingCycle: "mensal", notes: "Seed de dev" });
  const demoPasswordHash = await bcrypt.hash("demo-nao-usar-em-producao", 10);
  const demoUser = await db.createUser({
    name: "Maria Exemplo",
    email: "maria.exemplo@dev.local",
    passwordHash: demoPasswordHash,
    role: "collaborator",
    organizationId: demoOrg.id,
  });
  await db.joinCommunity(community.id, demoOrg.id);
  const demoPool = new fakePg.Pool();
  const joinedFiveMonthsAgo = new Date();
  joinedFiveMonthsAgo.setMonth(joinedFiveMonthsAgo.getMonth() - 5);
  await demoPool.query("UPDATE community_members SET joined_at = $1 WHERE organization_id = $2", [joinedFiveMonthsAgo, demoOrg.id]);
  const [firstPost] = await db.listCommunityRecentPosts(community.id, 1);
  if (firstPost) {
    await db.createCommunityComment({
      postId: firstPost.id,
      authorUserId: demoUser.id,
      authorName: demoUser.name,
      isAmbassador: false,
      body: "Adorei o conteúdo, obrigada!",
    });
    // XP de exemplo (pra aba Membros abrir já com o ranking visível) — o
    // comentário acima foi criado direto por db.createCommunityComment,
    // sem passar pela rota HTTP que normalmente registra o evento de XP.
    await db.recordXpEvent(community.id, demoUser.id, "comment");
  }
  // Assinante de exemplo em período de teste (pra ver a seção "previsto a
  // receber" renderizada sem precisar de um webhook real da Cakto — ver
  // handleSubscriptionCreated em web/cakto.js).
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 7);
  await db.upsertAffiliateTrialReferral({
    affiliateId: affiliate.id,
    caktoSubscriptionId: "dev-seed-trial-sub-1",
    customerEmail: "joao.teste@dev.local",
    customerName: "João Teste",
    subscriptionAmount: 197,
    commissionPercentage: affiliate.first_sale_percentage,
    projectedCommissionValue: Math.round(197 * (affiliate.first_sale_percentage / 100) * 100) / 100,
    trialEndsAt,
  });
  console.log(`Comunidade de dev criada automaticamente pro embaixador ${DEV_ADMIN_EMAIL}.`);
}

startServer(process.env.PORT || 3001)
  .then(async ({ port }) => {
    await seedDevAdmin();
    await seedDevCommunity();
    console.log(`ScoutX (web) rodando em http://localhost:${port} — DEV LOCAL, pg-mem em memória, nada persiste.`);
  })
  .catch((err) => {
    console.error("Falha ao subir o ScoutX local:", err);
    process.exit(1);
  });
