const { Pool, Client } = require("pg");
const { tierForActiveMembers } = require("./communityTiers");
const nodeCrypto = require("crypto");

// Código do link de indicação de um afiliado: nome sem acento/símbolos + 4
// caracteres aleatórios ("jhonatas-k3x9"). O sufixo aleatório evita que
// alguém adivinhe/forje o link de outro afiliado só sabendo o nome dele.
function generateAffiliateRefCode(name) {
  const slug =
    String(name || "afiliado")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "afiliado";
  const suffix = nodeCrypto.randomBytes(3).toString("hex").slice(0, 4);
  return `${slug}-${suffix}`;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Planos de venda do ScoutX — 3 planos fixos, não precisa ser configurável
// pelo admin. maxOperations/maxCompetitors em Infinity = sem limite
// (Enterprise). Se um dia mudar preço/limite, é troca de constante aqui, não
// de schema. As CHAVES (solo/pro/agencia) são só o identificador interno,
// gravado em organizations.plan — não mudam com o rebrand dos nomes de
// venda (Solo → Standard, Pro → Pro, Agência → Enterprise), só o "label"
// exibido pra pessoa muda.
//
// maxUsers é sempre 1 nos três planos — decisão de negócio: cada conta é de
// UMA equipe (1 login), não de N colaboradores dividindo uma assinatura;
// o que muda de plano pra plano é só o número de países/concorrentes.
// Fixo em 1 (não uma constante à parte) de propósito, pra não sobrar
// nenhuma trilha de "plano X permite N usuários" pra reintroduzir sem querer.
const PLAN_LIMITS = {
  solo: { label: "Standard", maxUsers: 1, maxOperations: 1, maxCompetitors: 50 },
  pro: { label: "Pro", maxUsers: 1, maxOperations: 3, maxCompetitors: 250 },
  agencia: { label: "Enterprise", maxUsers: 1, maxOperations: Infinity, maxCompetitors: Infinity },
};
const BILLING_CYCLE_DAYS = { mensal: 30, trimestral: 90, anual: 365 };

// O backend Python do Mega Minerador precisa do próprio banco, separado das
// tabelas deste app. Em vez de pedir pra alguém criar isso manualmente no
// mesmo servidor Postgres, criamos aqui no boot (idempotente — não faz nada
// se já existir). MINERADOR_DB_NAME é só o nome lógico do banco; a URL final
// pros serviços Python é a mesma do Postgres trocando o nome do banco no fim.
const MINERADOR_DB_NAME = "minerador_intel";

async function ensureMineradorDatabase() {
  if (!process.env.DATABASE_URL) return;
  const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [MINERADOR_DB_NAME]);
  if (exists.rows.length > 0) return;

  // CREATE DATABASE não pode rodar dentro de uma transação nem via pool
  // (o driver às vezes agrupa em transação implícita) — usamos um Client
  // solto, direto.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${MINERADOR_DB_NAME}`);
    console.log(`Banco "${MINERADOR_DB_NAME}" criado para o Mega Minerador.`);
  } catch (err) {
    if (err.code !== "42P04") throw err; // 42P04 = database already exists (corrida com outro boot)
  } finally {
    await client.end();
  }
}

async function migrate() {
  // A tabela anterior guardava usuários pelo login OAuth do pm-board (schema
  // diferente, sem email/senha). Trocamos pra login próprio — como ainda não
  // tinha nenhum usuário real usando aquele fluxo, recriamos do zero.
  const hasOldSchema = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'pmboard_user_id'
  `);
  if (hasOldSchema.rows.length > 0) {
    await pool.query("DROP TABLE IF EXISTS search_logs");
    await pool.query("DROP TABLE IF EXISTS app_users");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'collaborator',
      can_view_history BOOLEAN NOT NULL DEFAULT false,
      can_access_minerador BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_access_minerador BOOLEAN NOT NULL DEFAULT false;`);
  // Bloqueio de login escalonado (revisão de segurança) — ver
  // failedLoginAttempt/checkLoginLock em server.js.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;`);
  // Revisão de segurança: sessão hoje é só um cookie assinado com validade
  // de 30 dias, sem nenhuma lista de revogação — trocar a senha não
  // invalidava sessões já abertas em outro lugar (nem uma sessão roubada).
  // token_version vai dentro do cookie no login (auth.js/setSessionCookie);
  // toda troca de senha incrementa esse número (updateUserPassword, abaixo)
  // — qualquer cookie assinado com o número antigo passa a ser rejeitado
  // (requireAuth), mesmo com assinatura válida e prazo não vencido.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;`);
  // Suspensão reversível — diferente de excluir: bloqueia login na hora
  // (checado em /login) sem apagar histórico/permissões, útil pra investigar
  // algo suspeito sem perder o usuário. role_changed_by_id/at é auditoria de
  // quem promoveu/rebaixou quem admin — dar admin é a ação mais sensível da
  // tela e antes disso não ficava registrado em lugar nenhum.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;`);
  // Foto de perfil (Minha Conta) — guardada como data URI já redimensionada
  // no navegador (~256px, JPEG) antes de subir, então cabe tranquilo num
  // TEXT do Postgres sem precisar de storage de arquivo (S3 etc.) só pra
  // isso. TEXT sem limite de tamanho fixo — o teto de verdade é aplicado no
  // PATCH /api/me/avatar (server.js), não aqui.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role_changed_by_id INTEGER;`);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role_changed_at TIMESTAMPTZ;`);
  // Conta criada pelo webhook da Cakto nasce com uma senha aleatória que
  // NINGUÉM sabe (nem a gente guarda em lugar nenhum) — essa flag marca
  // que ela ainda precisa passar por /registrar (a pessoa prova que é dona
  // da compra digitando o mesmo email, e escolhe a própria senha ali,
  // ver POST /registrar em server.js). Evita depender de correlacionar um
  // refId entre o redirect da Cakto e o webhook, que na prática não bateu
  // certo no teste real (ver HANDOFF.md).
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS needs_password_setup BOOLEAN NOT NULL DEFAULT false;`);
  // "Última vez visto" (pedido do admin, 2026-08-31) — diferente de
  // last_login_at (login_events, só marca QUANDO logou): essa coluna
  // acompanha uso de verdade, atualizada a cada request autenticada. Pra
  // não pesar o app com um UPDATE em TODA requisição, requireAuth
  // (server.js) só escreve se fizer mais de 5 minutos desde o valor já
  // carregado em memória — na prática um UPDATE bem esparso por usuário
  // ativo, não por request.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS search_logs (
      id SERIAL PRIMARY KEY,
      app_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      domain TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_search_logs_user ON search_logs(app_user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_events (
      id SERIAL PRIMARY KEY,
      app_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      ip TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(app_user_id);`);

  // Log de auditoria administrativa — pedido do usuário pra rastrear quem
  // fez o quê entre vários admins (promoveu, suspendeu, resetou senha,
  // excluiu). actor/target_name são um SNAPSHOT do nome no momento da ação
  // (não FK) de propósito: um usuário excluído não pode deixar o log
  // ilegível ("Usuário #47 excluiu Usuário #52") só porque uma das duas
  // pontas sumiu depois.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER,
      actor_name TEXT NOT NULL,
      target_id INTEGER,
      target_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);`);

  // Programa de afiliados feito por dentro do app (2026-08-31) — a Cakto só
  // suporta UMA comissão fixa por produto, não uma taxa pra primeira venda e
  // outra pra recorrência (achado ao vivo, conferido no painel dela). O link
  // de afiliado em si continua sendo o da Cakto (é ela quem rastreia clique/
  // cookie); a gente só usa a API deles (ver caktoApi.js) pra descobrir QUEM
  // é o afiliado de cada pedido (campo commissions[].type === "affiliate"),
  // casando pelo email, e calculamos/guardamos a comissão com as NOSSAS
  // taxas aqui.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      cakto_email TEXT NOT NULL UNIQUE,
      pix_key TEXT,
      first_sale_percentage NUMERIC(5,2) NOT NULL,
      recurring_percentage NUMERIC(5,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Uma linha por comissão gerada (1ª venda de um cliente novo, ou cada
  // renovação depois) — cakto_order_id é o `data.id` do webhook/API da
  // Cakto, UNIQUE pra nunca gerar comissão em dobro se o mesmo evento vier
  // de novo (Cakto reenvia webhook em caso de timeout, ver cakto.js).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      cakto_order_id TEXT NOT NULL UNIQUE,
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      sale_amount NUMERIC(10,2) NOT NULL,
      commission_type TEXT NOT NULL, -- 'first_sale' | 'recurring'
      commission_percentage NUMERIC(5,2) NOT NULL,
      commission_value NUMERIC(10,2) NOT NULL,
      paid BOOLEAN NOT NULL DEFAULT false,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate ON affiliate_commissions(affiliate_id);`);

  // Assinantes trazidos por um afiliado que ainda estão em PERÍODO DE TESTE
  // (pedido do Samuel, 2026-09-18): nenhuma comissão de fato existe ainda
  // (não houve cobrança), então NÃO é uma linha em affiliate_commissions —
  // é só uma projeção ("previsto a receber", se o teste virar cobrança de
  // verdade). Alimentada pelo webhook "subscription_created" da Cakto (ver
  // cakto.js handleSubscriptionCreated) quando `data.subscription.status`
  // vem "trial". cakto_subscription_id é o id DA ASSINATURA (não do pedido
  // — uma assinatura tem vários pedidos ao longo do tempo, um por ciclo),
  // UNIQUE pra um reenvio de webhook não duplicar a linha; a linha some
  // (DELETE, ver deleteAffiliateTrialReferral) assim que o teste vira
  // cobrança de verdade (purchase_approved/subscription_renewed pra essa
  // assinatura, quando a comissão real passa a existir em
  // affiliate_commissions) ou é cancelado antes de cobrar.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliate_trial_referrals (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      cakto_subscription_id TEXT NOT NULL UNIQUE,
      customer_email TEXT,
      customer_name TEXT,
      subscription_amount NUMERIC(10,2) NOT NULL,
      commission_percentage NUMERIC(5,2) NOT NULL,
      projected_commission_value NUMERIC(10,2) NOT NULL,
      trial_ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_affiliate_trial_referrals_affiliate ON affiliate_trial_referrals(affiliate_id);`);

  // Indicação (2026-09-10) — programa separado do de afiliados acima:
  // aqui é o PRÓPRIO CLIENTE que pede o cupom (self-service, dentro do
  // app), não um afiliado externo cadastrado manualmente pelo admin. Cada
  // app_user só pode ter UM cupom na vida (UNIQUE em user_id) — pedir de
  // novo com um já existente só devolve o que já tem, ver
  // createReferralCouponRequest. `coupon_code` fica null enquanto
  // "requested": o cupom em si é criado à mão no painel da Cakto (não tem
  // API pública pra isso, conferido na doc oficial) e o admin cola o
  // código aqui pra ativar.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_coupons (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
      coupon_code TEXT UNIQUE,
      pix_key TEXT,
      whatsapp TEXT,
      status TEXT NOT NULL DEFAULT 'requested', -- 'requested' | 'active' | 'disabled'
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      activated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Uma linha por venda em que o couponCode da compra bateu com um cupom de
  // indicação ativo — sempre comissão de "primeira venda" (decisão do
  // usuário: só a compra inicial do indicado gera comissão, não
  // renovações). Mesma idempotência/estorno que affiliate_commissions
  // acima (cakto_order_id UNIQUE, apagada em reembolso/chargeback).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_commissions (
      id SERIAL PRIMARY KEY,
      referral_coupon_id INTEGER NOT NULL REFERENCES referral_coupons(id) ON DELETE CASCADE,
      cakto_order_id TEXT NOT NULL UNIQUE,
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      sale_amount NUMERIC(10,2) NOT NULL,
      commission_percentage NUMERIC(5,2) NOT NULL,
      commission_value NUMERIC(10,2) NOT NULL,
      paid BOOLEAN NOT NULL DEFAULT false,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_referral_commissions_coupon ON referral_commissions(referral_coupon_id);`);

  // Planos de venda — cada organização agrupa N logins (app_users) sob um
  // plano/ciclo/validade só. expires_at vencido bloqueia login de TODO
  // mundo da organização (checado em requireAuth/login, ver server.js).
  // notes é texto livre do admin (valor pago, canal de venda) — sem campo
  // estruturado de preço nessa fase (ativação ainda é manual).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);

  // País/operação que a conta escolheu na primeira vez que abriu o app —
  // até aqui isso só vivia no localStorage do NAVEGADOR (ver
  // OperationContext.jsx no React), então trocar de dispositivo/navegador,
  // ou até só limpar os dados do site, fazia perguntar de novo pra sempre.
  // NULL = essa organização ainda nunca escolheu (mostra o seletor
  // inicial); depois de escolhida uma vez, fica valendo pra sempre, mesmo
  // trocando de plano — não é a mesma coisa que "qual país está sendo
  // visto agora" (isso continua livre, ver seletor no menu lateral).
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_operation TEXT;`);

  // Automação Cakto: cakto_purchase_id/cakto_customer_email identificam qual
  // organização veio de qual compra, pra um evento de cancelamento/reembolso
  // futuro (que só traz o ID da compra ou o email do comprador) achar a
  // organização certa pra suspender. NULL pras organizações criadas
  // manualmente pelo admin (a maioria hoje).
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cakto_purchase_id TEXT;`);
  // Atribuição MANUAL de um cliente a um afiliado (cliente que veio "pelo
  // fulano" mas se cadastrou sem passar pelo link rastreado da Cakto, ex.:
  // teste grátis criado por /free-trial). Quando a Cakto não reporta
  // afiliado no pedido, cakto.js cai nesse campo pra creditar a comissão.
  await pool.query(
    `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referred_by_affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE SET NULL;`
  );
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cakto_customer_email TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_organizations_cakto_purchase ON organizations(cakto_purchase_id) WHERE cakto_purchase_id IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_organizations_cakto_email ON organizations(cakto_customer_email) WHERE cakto_customer_email IS NOT NULL;`);

  // Teste grátis de 7 dias (2026-09-17) — true entre o "subscription_created"
  // (cartão salvo, teste começou) e a primeira cobrança de verdade passar.
  // renewOrganization sempre zera isso pra false (qualquer renovação bem
  // sucedida = converteu de teste pra cliente de verdade, ou já não era
  // teste); handleCancellationEvent (cakto.js) não precisa mexer aqui —
  // expires_at no passado já barra o acesso, teste convertido ou não.
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false;`);

  // /assinar em 2 passos (2026-09-17, pedido do usuário) — passo 1 (nome,
  // email, senha, WhatsApp) já salva aqui, ANTES de pedir CPF/cartão no
  // passo 2. Motivo: cartão espanta gente mesmo avisando que só cobra
  // depois de 7 dias — separar os passos deixa mais gente começar a
  // preencher, e quem abandona no meio vira um lead pra equipe de suporte
  // entrar em contato depois (em vez de só sumir sem rastro nenhum).
  // completed_at/organization_id ficam NULL até o passo 2 terminar com
  // pagamento aprovado — nunca cria organização/app_user aqui, só guarda o
  // que a pessoa já digitou.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assinar_leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT NOT NULL,
      plan_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      organization_id INTEGER REFERENCES organizations(id)
    );
  `);
  // Código do link de indicação (/free-trial?ref=CODIGO) que trouxe esse lead.
  await pool.query(`ALTER TABLE assinar_leads ADD COLUMN IF NOT EXISTS ref_code TEXT;`);

  // Cada afiliado tem um código único e automático pro link de indicação
  // dele. Afiliados que já existiam ganham um código aqui mesmo (backfill).
  await pool.query(`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS ref_code TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_ref_code ON affiliates(ref_code) WHERE ref_code IS NOT NULL;`);
  const withoutRef = await pool.query(`SELECT id, name FROM affiliates WHERE ref_code IS NULL`);
  for (const row of withoutRef.rows) {
    await pool.query(`UPDATE affiliates SET ref_code = $1 WHERE id = $2`, [generateAffiliateRefCode(row.name), row.id]);
  }

  // Idempotência do webhook: a Cakto pode reenviar o mesmo evento (timeout,
  // retry automático dela) — sem isso, um reenvio de "purchase_approved"
  // criaria uma segunda organização/usuário pra mesma compra. Chave composta
  // (id da compra + evento) porque a MESMA compra gera vários eventos ao
  // longo do tempo (aprovada, depois talvez reembolsada).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cakto_events (
      purchase_id TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (purchase_id, event)
    );
  `);

  // Backfill: todo usuário collaborator que já existia antes dessa revisão
  // (e qualquer um sem organização por algum motivo) recebe uma organização
  // própria de "Legado", plano Enterprise (sem limite) e validade 10 anos no
  // futuro — ninguém trava no dia desse deploy. O admin reorganiza quem
  // realmente compartilha uma assinatura só depois, pela tela de
  // Organizações. Contas admin (role='admin') nunca recebem organização —
  // seguem sem limite, é o modelo delas hoje.
  const orphaned = await pool.query(
    "SELECT id, name FROM app_users WHERE organization_id IS NULL AND role != 'admin'"
  );
  for (const user of orphaned.rows) {
    const org = await pool.query(
      `INSERT INTO organizations (name, plan, billing_cycle, expires_at, notes)
       VALUES ($1, 'agencia', 'anual', now() + interval '10 years', 'Criada automaticamente na migração de planos — reorganizar se necessário')
       RETURNING id`,
      [`Legado — ${user.name}`]
    );
    await pool.query("UPDATE app_users SET organization_id = $1 WHERE id = $2", [org.rows[0].id, user.id]);
  }

  // Comunidade de embaixadores (2026-09-10) — extensão do programa de
  // afiliados acima: cada afiliado pode virar "dono" de uma comunidade
  // fechada. Fica ligada em `affiliates`, não em `app_users`, porque quem
  // já existe como afiliado hoje não tem login nenhum no ScoutX — quando a
  // pessoa loga, a gente reconhece que ela é embaixadora comparando o email
  // dela com `affiliates.cakto_email` (mesmo truque que
  // recordAffiliateCommissionIfAny em cakto.js já usa), sem precisar de
  // coluna nova de vínculo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS communities (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER NOT NULL UNIQUE REFERENCES affiliates(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Colunas adicionadas depois da criação original da tabela — SEMPRE via
  // ALTER TABLE ADD COLUMN IF NOT EXISTS (nunca editando o CREATE TABLE
  // acima direto): CREATE TABLE IF NOT EXISTS não faz nada numa tabela que
  // já existe, então uma coluna nova só entraria aqui num banco que nunca
  // rodou essa tabela antes. Mesmo padrão já usado em organizations.* mais
  // abaixo neste arquivo.
  await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS banner_url TEXT;`);
  await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT 'blue';`); // identidade visual do embaixador (ver ACCENT_COLORS no frontend)
  // Categorias/"tags" (2026-09-11): pedido do Samuel pra tirar da tela
  // (2026-09-18) — coluna fica pra trás sem uso em vez de apagada (convenção
  // deste arquivo pra evolução de schema). O formulário/exibição não usam
  // mais esse campo; qualquer valor antigo salvo aqui é zerado sozinho na
  // próxima vez que o embaixador editar a comunidade (PATCH /api/community/:id
  // sempre grava `tags = null` quando o corpo não manda o campo).
  await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS tags TEXT;`);
  await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS instagram_url TEXT;`);
  await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS youtube_url TEXT;`);
  await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS website_url TEXT;`);

  // organization_id UNIQUE: uma organização só entra em UMA comunidade pra
  // sempre (decisão do usuário — não é possível trocar de comunidade,
  // mesmo cancelando e reativando a assinatura depois, já que a
  // organização não é recriada numa renovação).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_members (
      id SERIAL PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_members_community ON community_members(community_id);`);

  // Moderação do embaixador (pedido do Samuel, 2026-09-18): "silenciar" tira
  // a capacidade de comentar/curtir/votar/salvar SEM avisar a pessoa (ela só
  // percebe se tentar interagir e não conseguir) — ela continua lendo tudo
  // normalmente. "Expulsar" é mais forte, ver removeCommunityMember abaixo:
  // apaga a LINHA de community_members (não é esse boolean), pra liberar de
  // vez o organization_id UNIQUE dessa tabela (ver comentário lá em cima —
  // por padrão uma organização nunca troca de comunidade sozinha; expulsão é
  // a única forma de "resetar" isso, decisão explícita do admin, não
  // self-service).
  await pool.query(`ALTER TABLE community_members ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;`);

  // De onde veio esse membro (pedido do Samuel, 2026-09-19): "affiliate" =
  // entrou pelo link de afiliado do embaixador (auto-join em
  // cakto.js:autoJoinCommunityIfAny, é ele quem trouxe essa venda de
  // verdade); "directory" = achou o ScoutX sozinho (divulgação da própria
  // plataforma, sem link de ninguém) e escolheu essa comunidade navegando
  // no diretório (POST /api/community/join). Sem isso, o embaixador ganhava
  // comissão de recorrência (ver communityTiers.js) até de gente que ele
  // nunca trouxe — quem estaria perdendo dinheiro nesse caso é a própria
  // plataforma, não faz sentido. A partir de agora só membros "affiliate"
  // contam pro nível/comissão do embaixador (ver
  // countActiveReferredCommunityMembers e cakto.js
  // recordCommunityCommissionIfAny); "directory" continua contando no
  // tamanho/engajamento GERAL da comunidade (countActiveCommunityMembers,
  // sem mudança), só não gera comissão nenhuma pro embaixador.
  await pool.query(`ALTER TABLE community_members ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'directory';`);

  // Canais (2026-09-10, pedido do usuário pra parecer mais um fórum de
  // verdade tipo Circle/Skool): uma comunidade tem N canais, só o
  // embaixador dono cria/remove. `position` decide a ordem exibida na
  // barra lateral — sempre inserido no fim (MAX(position)+1), sem
  // reordenação por enquanto.
  // group_name (2026-09-11): agrupa canais em seções com cabeçalho na
  // barra lateral (tipo "TOP Fornecedores" reunindo vários canais na
  // referência que o usuário mandou) — null cai num grupo "Canais" genérico
  // no front. Não é uma tabela própria de propósito: só um rótulo de texto
  // livre, mais simples que modelar categoria como entidade separada.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_channels (
      id SERIAL PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      group_name TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_channels_community ON community_channels(community_id);`);

  // community_id fica denormalizado aqui (além de channel_id) de propósito
  // — mesmo padrão de snapshot já usado em outras tabelas deste arquivo:
  // deixa consultas que só precisam "todos os posts da comunidade" (sem
  // se importar com canal) simples, sem JOIN extra. `pinned` fixa o post
  // no topo do canal (embaixador decide, tipo o post "Como funciona" fixado
  // na referência que o usuário mandou).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id SERIAL PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      image_url TEXT,
      pinned BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_posts_community ON community_posts(community_id);`);
  // Agendamento (2026-09-18) — NULL = publicado na hora (comportamento de
  // sempre); preenchido = só aparece no feed depois dessa data (ver filtro
  // em listCommunityPostsByChannel). Sem cron/job nenhum: o "publicar na
  // hora certa" é só um filtro de leitura (WHERE scheduled_at <= now()),
  // não precisa de worker rodando em background pra isso funcionar.
  await pool.query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;`);
  // Índice SEM condição parcial de propósito — achado testando esta
  // feature: um índice parcial (`WHERE scheduled_at IS NOT NULL`) aqui
  // corrompe silenciosamente qualquer SELECT seguinte que filtre por essa
  // coluna no pg-mem (devolve 0 linhas mesmo com dado batendo), limitação
  // do simulador na mesma categoria das já documentadas no HANDOFF.md
  // (GROUP BY entre tabelas, `= ANY($1::int[])`). Nunca usar índice parcial
  // neste arquivo — index cheio não tem esse problema e cobre o mesmo caso.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_posts_scheduled ON community_posts(scheduled_at);`);

  // Enquete (2026-09-18): 1 pra 1 com o post (community_posts.body vira a
  // pergunta) — sem tabela "community_polls" própria de propósito, um post
  // só pode ter 0 ou 1 enquete, então as opções já referenciam post_id
  // direto. Voto é único por (post, usuário): votar de novo só troca a
  // opção (ver upsertCommunityPollVote), não acumula.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_poll_options (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_poll_options_post ON community_poll_options(post_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_poll_votes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES community_poll_options(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (post_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_poll_votes_option ON community_poll_votes(option_id);`);

  // XP (2026-09-18) — ledger append-only de pontos por ação real detectável
  // (comentar, votar numa enquete, concluir um conteúdo). "Ajudar outro
  // membro" do briefing original ficou de fora de propósito: não tem como
  // detectar isso automaticamente sem um sistema de "marcar resposta como
  // útil" que não existe ainda. Ledger em vez de só um contador na tabela
  // de membro pra dar auditoria (por que fulano tem X XP? soma os eventos).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_xp_events (
      id SERIAL PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- 'comment' | 'poll_vote' | 'resource_completed'
      amount INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_xp_events_user ON community_xp_events(community_id, user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_posts_channel ON community_posts(channel_id);`);

  // Curtida: par (post, quem curtiu) único — clicar de novo tira a
  // curtida (toggle), não acumula.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_post_likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (post_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_post_likes_post ON community_post_likes(post_id);`);

  // Salvar post (bookmark) — mesmo padrão de curtida, toggle por (post,
  // usuário). Feature separada de like de propósito (like é público/conta
  // pro post, salvar é uma lista pessoal só de quem salvou).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_post_saves (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (post_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_post_saves_post ON community_post_saves(post_id);`);

  // author_user_id cobre TANTO membro comum QUANTO o próprio embaixador
  // (ele também loga como app_user normal, ver comentário em `communities`
  // acima) — is_ambassador só marca visualmente quem respondeu como dono
  // da comunidade. author_name é um SNAPSHOT (mesmo padrão de
  // admin_audit_log): comentário antigo continua legível mesmo se a conta
  // for excluída depois.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      author_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      is_ambassador BOOLEAN NOT NULL DEFAULT false,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id);`);

  // Uma linha por renovação de QUALQUER membro ativo da comunidade —
  // calculada no momento do webhook (ver cakto.js:
  // recordCommunityCommissionIfAny), nunca por um job agendado. Guarda
  // member_count_at_time/tier pra auditoria (se o admin questionar por que
  // uma comissão saiu com % X, dá pra ver exatamente quantos membros
  // ativos a comunidade tinha naquele instante).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_commissions (
      id SERIAL PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cakto_order_id TEXT NOT NULL UNIQUE,
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      sale_amount NUMERIC(10,2) NOT NULL,
      member_count_at_time INTEGER NOT NULL,
      tier TEXT NOT NULL,
      commission_percentage NUMERIC(5,2) NOT NULL,
      commission_value NUMERIC(10,2) NOT NULL,
      paid BOOLEAN NOT NULL DEFAULT false,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_commissions_community ON community_commissions(community_id);`);

  // Central de Conteúdo Educacional (2026-09-11, pedido do usuário): lista
  // de aulas/artigos/vídeos que o embaixador cadastra pros membros, à parte
  // do feed de posts (esse é conteúdo "de referência" que fica fixo numa
  // aba própria, não rola pro fundo do feed com o tempo). `url` é opcional
  // de propósito: um recurso pode ser só texto (ex: um resumo curto sem
  // link nenhum), daí `body` carrega o conteúdo em vez de apontar pra fora.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_resources (
      id SERIAL PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'article', -- 'video' | 'article' | 'course' | 'link'
      title TEXT NOT NULL,
      body TEXT,
      url TEXT,
      duration_label TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_resources_community ON community_resources(community_id);`);

  // Progresso do assinante num conteúdo (seção "Continue de onde parou" /
  // "Central de Conhecimento" do briefing) — uma linha por (recurso,
  // usuário), só existe depois que a pessoa abre/marca o conteúdo pela
  // primeira vez. completed_at NULL = "em andamento", preenchido = "concluído".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_resource_progress (
      id SERIAL PRIMARY KEY,
      resource_id INTEGER NOT NULL REFERENCES community_resources(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (resource_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_resource_progress_user ON community_resource_progress(user_id);`);

  // Notificações (seção 12 do briefing) — fan-out na escrita: quando um
  // evento relevante acontece (post novo, conteúdo novo, comentário no post
  // do embaixador), uma linha é criada aqui PRA CADA destinatário. Simples
  // de consultar (um SELECT por usuário, sem calcular "quem deveria ver o
  // quê" na hora da leitura) e funciona bem no tamanho de comunidade que
  // esse produto tem hoje (dezenas de membros, não milhares).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_notifications (
      id SERIAL PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      recipient_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- 'new_post' | 'new_resource' | 'new_comment' | 'announcement'
      message TEXT NOT NULL,
      post_id INTEGER REFERENCES community_posts(id) ON DELETE CASCADE,
      resource_id INTEGER REFERENCES community_resources(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_community_notifications_recipient ON community_notifications(recipient_user_id, created_at DESC);`);
}

// Só grava se ainda não tinha nada (NULL) — a primeira escolha da conta
// vale pra sempre, tentar chamar de novo depois não sobrescreve (evita uma
// chamada maliciosa/acidental de outro dispositivo "resetando" o país já
// decidido). Devolve a organização atualizada, com o valor que realmente
// ficou valendo (pode não ser o `value` passado, se já tinha outro antes).
async function setOrgDefaultOperationIfUnset(organizationId, value) {
  const res = await pool.query(
    `UPDATE organizations SET default_operation = $1 WHERE id = $2 AND default_operation IS NULL RETURNING *`,
    [value, organizationId]
  );
  if (res.rows[0]) return res.rows[0];
  return await getOrganizationById(organizationId);
}

// Sobrescreve incondicionalmente (ao contrário da versão acima, que só
// grava se ainda for NULL) — usado quando a pessoa EXCLUI o país que era o
// padrão da conta (ver removeOperation em OperationContext.jsx): sem isso,
// o valor antigo (já apagado da lista local) voltava sozinho a cada
// refresh/dispositivo novo, porque o servidor continuava devolvendo ele em
// GET /api/me. value null limpa de vez (conta sem nenhum país mais).
async function setOrgDefaultOperation(organizationId, value) {
  const res = await pool.query(`UPDATE organizations SET default_operation = $1 WHERE id = $2 RETURNING *`, [
    value,
    organizationId,
  ]);
  return res.rows[0];
}

async function countUsers() {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM app_users");
  return res.rows[0].n;
}

// Admin suspenso não conta — senão "o último admin ATIVO" ficaria escondido
// atrás de um admin que já nem consegue logar, e a trava deixaria de
// proteger contra o cenário real (ninguém com acesso de fato).
async function countActiveAdmins() {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin' AND suspended = false");
  return res.rows[0].n;
}

async function createUser({ name, email, passwordHash, role, createdById, organizationId, needsPasswordSetup }) {
  const isAdmin = role === "admin";
  // Colaborador preso a uma organização é cliente pagante — ScoutX é o
  // PRÓPRIO produto vendido, não faz sentido nascer sem acesso a ele e
  // depender do admin lembrar de destravar depois manualmente (bug real:
  // usuário do plano Standard criado sem conseguir nem ver o app até alguém
  // notar e mexer no toggle). Admin continua sem esse campo fazer sentido
  // (já tem acesso total por ser admin).
  const canAccessMinerador = !isAdmin && !!organizationId;
  const res = await pool.query(
    `INSERT INTO app_users (name, email, password_hash, role, role_changed_by_id, role_changed_at, organization_id, can_access_minerador, needs_password_setup)
     VALUES ($1, $2, $3, $4, $5, ${isAdmin ? "now()" : "NULL"}, $6, $7, $8) RETURNING *`,
    [
      name,
      email.toLowerCase().trim(),
      passwordHash,
      role || "collaborator",
      isAdmin ? createdById || null : null,
      isAdmin ? null : organizationId || null,
      canAccessMinerador,
      !!needsPasswordSetup,
    ]
  );
  return res.rows[0];
}

// Usado só por POST /registrar (server.js) — a pessoa prova que é dona da
// compra digitando o mesmo email que usou na Cakto, escolhe a própria
// senha, e essa flag nunca mais volta a true pra essa conta.
async function completePasswordSetup(id, passwordHash) {
  const res = await pool.query(
    `UPDATE app_users SET password_hash = $1, needs_password_setup = false,
       failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1
     WHERE id = $2 RETURNING *`,
    [passwordHash, id]
  );
  return res.rows[0];
}

// org_plan/org_expires_at vêm junto (LEFT JOIN) porque requireAuth e /login
// checam o vencimento do plano a cada request — sem isso seria uma query a
// mais em todo request autenticado só pra saber se o plano venceu.
const USER_WITH_ORG_SELECT = `
  SELECT u.*, o.plan AS org_plan, o.expires_at AS org_expires_at, o.name AS org_name,
         o.default_operation AS org_default_operation, o.is_trial AS org_is_trial,
         o.cakto_purchase_id AS org_cakto_purchase_id
  FROM app_users u
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

async function findUserByEmail(email) {
  const res = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.email = $1`, [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

// Fire-and-forget de propósito (ver requireAuth em server.js — chamado sem
// await, com .catch silencioso) — atualizar "última vez visto" nunca deve
// atrasar nem quebrar a requisição real da pessoa.
async function touchLastSeen(userId) {
  await pool.query("UPDATE app_users SET last_seen_at = now() WHERE id = $1", [userId]);
}

async function getAppUserById(id) {
  const res = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.id = $1`, [id]);
  return res.rows[0] || null;
}

async function listUsersWithCounts() {
  // all_ips/last_login_at: admin pedia pra ver QUAL IP, não só "⚠️ N IPs" —
  // manda a lista inteira de uma vez (tabela de admin é pequena, não compensa
  // 1 request por usuário só pra popular isso na tela principal).
  const res = await pool.query(`
    SELECT u.id, u.name, u.email, u.role, u.can_access_minerador, u.created_at,
           u.failed_login_attempts, u.locked_until, u.suspended, u.role_changed_at, u.last_seen_at,
           u.organization_id, o.name AS organization_name, o.plan AS organization_plan,
           o.expires_at AS organization_expires_at,
           (SELECT c.name FROM app_users c WHERE c.id = u.role_changed_by_id) AS role_changed_by_name,
           COUNT(DISTINCT s.id)::int AS search_count,
           COUNT(DISTINCT l.ip)::int AS ip_count,
           (
             SELECT le.ip FROM login_events le
             WHERE le.app_user_id = u.id
             ORDER BY le.created_at DESC
             LIMIT 1
           ) AS last_ip,
           (
             SELECT le.created_at FROM login_events le
             WHERE le.app_user_id = u.id
             ORDER BY le.created_at DESC
             LIMIT 1
           ) AS last_login_at,
           (
             SELECT array_agg(DISTINCT le.ip) FROM login_events le WHERE le.app_user_id = u.id
           ) AS all_ips
    FROM app_users u
    LEFT JOIN search_logs s ON s.app_user_id = u.id
    LEFT JOIN login_events l ON l.app_user_id = u.id
    LEFT JOIN organizations o ON o.id = u.organization_id
    GROUP BY u.id, o.name, o.plan, o.expires_at
    ORDER BY u.created_at ASC
  `);
  return res.rows;
}

async function logLogin(appUserId, ip) {
  await pool.query("INSERT INTO login_events (app_user_id, ip) VALUES ($1, $2)", [appUserId, ip || "desconhecido"]);
}

async function ipSummaryForUser(appUserId) {
  const res = await pool.query(
    `SELECT ip, COUNT(*)::int AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
     FROM login_events
     WHERE app_user_id = $1
     GROUP BY ip
     ORDER BY last_at DESC`,
    [appUserId]
  );
  return res.rows;
}

async function updateUserPermissions(id, { role, canAccessMinerador, suspended, changedById, organizationId }) {
  const fields = [];
  const values = [];
  let i = 1;
  if (role !== undefined) {
    fields.push(`role = $${i++}`);
    values.push(role);
    // Auditoria: quem promoveu/rebaixou quem, e quando — mostrado na tabela
    // de Usuários pro admin saber depois "quem deu admin pra fulano".
    fields.push(`role_changed_by_id = $${i++}`);
    values.push(changedById || null);
    fields.push(`role_changed_at = now()`);
  }
  // organizationId: null explícito tira o usuário de qualquer organização
  // (admin não pertence a nenhuma) — undefined significa "não mexer nisso".
  // A checagem de limite de usuários do plano/organização de destino já foi
  // feita antes de chamar isto, em server.js (mesma regra do POST /api/admin/users).
  if (organizationId !== undefined) {
    fields.push(`organization_id = $${i++}`);
    values.push(organizationId);
  }
  if (canAccessMinerador !== undefined) {
    fields.push(`can_access_minerador = $${i++}`);
    values.push(canAccessMinerador);
  }
  if (suspended !== undefined) {
    fields.push(`suspended = $${i++}`);
    values.push(suspended);
    if (suspended) {
      // Mesmo mecanismo da troca de senha: mata qualquer sessão já aberta
      // na hora, senão o cookie já emitido (válido por até 30 dias) seguiria
      // funcionando normalmente apesar da suspensão.
      fields.push(`token_version = token_version + 1`);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE app_users SET ${fields.join(", ")} WHERE id = $${i}`, values);
}

// Bloqueio de login escalonado — pedido explícito do usuário, 3 níveis:
// 3 erros seguidos → 5 min de bloqueio; +2 erros (5 no total) → 10 min;
// +1 erro (6 no total) → bloqueado até um admin redefinir a senha (sem
// fluxo de email — decisão junto com o usuário, ver conversa). O contador só
// avança quando a pessoa TENTA de verdade (login.js só chama isso fora de
// um bloqueio ativo), então "+2 tentativas" e "+1 tentativa" são exatamente
// as tentativas que sobram depois de cada bloqueio expirar.
const LOGIN_LOCK_TIERS = [
  { attempts: 6, minutes: null }, // null = bloqueio permanente (até reset de senha)
  { attempts: 5, minutes: 10 },
  { attempts: 3, minutes: 5 },
];

async function recordFailedLogin(userId) {
  const res = await pool.query(
    "UPDATE app_users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1 RETURNING failed_login_attempts",
    [userId]
  );
  const attempts = res.rows[0].failed_login_attempts;
  const tier = LOGIN_LOCK_TIERS.find((t) => attempts === t.attempts || (t.minutes === null && attempts >= t.attempts));
  if (!tier) return { attempts, lockedUntil: null, permanent: false };

  const permanent = tier.minutes === null;
  // "Permanente" = trava bem longe no futuro — updateUserPassword (reset de
  // admin ou autoatendimento) é o único jeito de zerar isso de verdade.
  const lockedUntil = permanent ? new Date("9999-01-01T00:00:00Z") : new Date(Date.now() + tier.minutes * 60 * 1000);
  await pool.query("UPDATE app_users SET locked_until = $1 WHERE id = $2", [lockedUntil, userId]);
  return { attempts, lockedUntil, permanent };
}

async function resetFailedLogins(userId) {
  await pool.query("UPDATE app_users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1", [userId]);
}

async function updateUserPassword(id, passwordHash) {
  // Redefinir a senha (admin OU a própria pessoa) sempre destrava a conta —
  // é o "escape hatch" do bloqueio permanente, ver LOGIN_LOCK_TIERS acima.
  // token_version +1 invalida toda sessão aberta em outro lugar (ou
  // roubada) na hora — ver nota em migrate() sobre isso. Devolve a versão
  // nova pra quem chamou poder emitir um cookie novo válido pra sessão
  // ATUAL (autoatendimento não pode deslogar a própria pessoa que acabou
  // de trocar a senha com sucesso).
  const res = await pool.query(
    "UPDATE app_users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = $2 RETURNING token_version",
    [passwordHash, id]
  );
  return res.rows[0].token_version;
}

async function deleteUser(id) {
  await pool.query("DELETE FROM app_users WHERE id = $1", [id]);
}

async function updateUserAvatar(id, avatarUrl) {
  const res = await pool.query("UPDATE app_users SET avatar_url = $1 WHERE id = $2 RETURNING avatar_url", [
    avatarUrl,
    id,
  ]);
  return res.rows[0]?.avatar_url ?? null;
}

async function updateUserName(id, name) {
  const res = await pool.query("UPDATE app_users SET name = $1 WHERE id = $2 RETURNING name", [name, id]);
  return res.rows[0]?.name ?? null;
}

async function logSearch(appUserId, tool, domain, url) {
  await pool.query("INSERT INTO search_logs (app_user_id, tool, domain, url) VALUES ($1, $2, $3, $4)", [
    appUserId,
    tool,
    domain,
    url,
  ]);
}

async function logAdminAction(actorId, actorName, targetId, targetName, action, details) {
  await pool.query(
    "INSERT INTO admin_audit_log (actor_id, actor_name, target_id, target_name, action, details) VALUES ($1, $2, $3, $4, $5, $6)",
    [actorId, actorName, targetId, targetName, action, details || null]
  );
}

async function listAdminAuditLog(limit = 100) {
  const res = await pool.query("SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT $1", [limit]);
  return res.rows;
}

// ---------- Afiliados ----------

async function listAffiliates() {
  const res = await pool.query("SELECT * FROM affiliates ORDER BY created_at DESC");
  return res.rows;
}

async function findAffiliateByCaktoEmail(email) {
  const res = await pool.query("SELECT * FROM affiliates WHERE cakto_email = $1", [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

async function createAffiliate({ name, caktoEmail, pixKey, firstSalePercentage, recurringPercentage }) {
  const res = await pool.query(
    `INSERT INTO affiliates (name, cakto_email, pix_key, first_sale_percentage, recurring_percentage, ref_code)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, caktoEmail.toLowerCase().trim(), pixKey || null, firstSalePercentage, recurringPercentage, generateAffiliateRefCode(name)]
  );
  return res.rows[0];
}

async function findAffiliateByRefCode(refCode) {
  const code = String(refCode || "").trim().toLowerCase();
  if (!code) return null;
  const res = await pool.query("SELECT * FROM affiliates WHERE ref_code = $1", [code]);
  return res.rows[0] || null;
}

async function deleteAffiliate(id) {
  await pool.query("DELETE FROM affiliates WHERE id = $1", [id]);
}

// ON CONFLICT DO NOTHING (cakto_order_id é UNIQUE): idempotente de propósito
// — se o mesmo evento de webhook chegar de novo (reenvio da Cakto por
// timeout, ver cakto.js), não gera comissão em dobro pro mesmo pedido.
// Devolve null quando já existia (nada foi inserido), pra quem chama saber
// que não precisa notificar de novo.
async function createAffiliateCommission({
  affiliateId,
  caktoOrderId,
  customerEmail,
  customerName,
  saleAmount,
  commissionType,
  commissionPercentage,
  commissionValue,
}) {
  const res = await pool.query(
    `INSERT INTO affiliate_commissions
       (affiliate_id, cakto_order_id, customer_email, customer_name, sale_amount, commission_type, commission_percentage, commission_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (cakto_order_id) DO NOTHING
     RETURNING *`,
    [affiliateId, caktoOrderId, customerEmail, customerName || null, saleAmount, commissionType, commissionPercentage, commissionValue]
  );
  return res.rows[0] || null;
}

async function setOrganizationAffiliate(orgId, affiliateId) {
  const res = await pool.query(
    "UPDATE organizations SET referred_by_affiliate_id = $2 WHERE id = $1 RETURNING *",
    [orgId, affiliateId]
  );
  return res.rows[0] || null;
}

async function getAffiliateById(id) {
  const res = await pool.query("SELECT * FROM affiliates WHERE id = $1", [id]);
  return res.rows[0] || null;
}

// Quantas comissões desse afiliado já existem pra esse cliente — usado pra
// decidir se a cobrança que acabou de chegar é a "primeira venda" (0) ou uma
// renovação (>0) na atribuição manual.
async function countAffiliateCommissionsForCustomer(affiliateId, customerEmail) {
  const res = await pool.query(
    "SELECT COUNT(*)::int AS n FROM affiliate_commissions WHERE affiliate_id = $1 AND customer_email = $2",
    [affiliateId, customerEmail]
  );
  return res.rows[0].n;
}

// Corrige o valor de uma comissão que ainda NÃO foi paga (nunca mexe numa já
// marcada como paga — aí o valor já foi combinado/depositado). Devolve true
// só se algo realmente mudou.
async function correctUnpaidAffiliateCommission(caktoOrderId, saleAmount, commissionValue) {
  const res = await pool.query(
    `UPDATE affiliate_commissions
     SET sale_amount = $2, commission_value = $3
     WHERE cakto_order_id = $1 AND paid = false
       AND (commission_value <> $3 OR sale_amount <> $2)
     RETURNING id`,
    [caktoOrderId, saleAmount, commissionValue]
  );
  return res.rowCount > 0;
}

// Organizações criadas por uma compra real na Cakto (não teste grátis, não
// criadas na mão) — base do "buscar vendas antigas" de um afiliado que só
// foi cadastrado DEPOIS da venda acontecer.
async function listPaidCaktoOrganizations() {
  const res = await pool.query(
    `SELECT id, name, cakto_purchase_id, cakto_customer_email, referred_by_affiliate_id
     FROM organizations
     WHERE cakto_purchase_id IS NOT NULL AND is_trial = false
     ORDER BY created_at DESC`
  );
  return res.rows;
}

// Organizações que o admin/link atribuiu a um afiliado, com o motivo de ainda
// não poderem gerar comissão (usado só pra explicar um backfill que veio zerado).
async function listOrganizationsAttributedToAffiliate(affiliateId) {
  const res = await pool.query(
    `SELECT id, name, is_trial, cakto_purchase_id, expires_at FROM organizations WHERE referred_by_affiliate_id = $1`,
    [affiliateId]
  );
  return res.rows;
}

async function listAffiliateCommissions() {
  const res = await pool.query(`
    SELECT c.*, a.name AS affiliate_name, a.cakto_email AS affiliate_email, a.pix_key AS affiliate_pix_key
    FROM affiliate_commissions c
    JOIN affiliates a ON a.id = c.affiliate_id
    ORDER BY c.created_at DESC
  `);
  return res.rows;
}

// Visão do PRÓPRIO afiliado/embaixador sobre os próprios ganhos (pedido do
// Samuel, 2026-09-18: hoje esse dado só existe na tela admin de Afiliados,
// sem nenhuma rota "minhas comissões" — ver COMUNIDADE_SPEC.md). Escopado
// por affiliate_id, diferente de listAffiliateCommissions() acima que
// devolve de TODOS os afiliados (uso exclusivo do admin).
async function listAffiliateCommissionsForAffiliate(affiliateId, limit = 20) {
  const res = await pool.query(
    `SELECT * FROM affiliate_commissions WHERE affiliate_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [affiliateId, limit]
  );
  return res.rows;
}

async function getAffiliateEarningsSummary(affiliateId) {
  const res = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN paid THEN commission_value ELSE 0 END), 0)::numeric AS total_received,
       COALESCE(SUM(CASE WHEN NOT paid THEN commission_value ELSE 0 END), 0)::numeric AS total_pending,
       COUNT(DISTINCT customer_email)::int AS referred_customers,
       COUNT(*)::int AS commission_count
     FROM affiliate_commissions WHERE affiliate_id = $1`,
    [affiliateId]
  );
  const row = res.rows[0];
  return {
    totalReceived: Number(row.total_received),
    totalPending: Number(row.total_pending),
    referredCustomers: row.referred_customers,
    commissionCount: row.commission_count,
  };
}

async function markAffiliateCommissionPaid(id, paid) {
  const res = await pool.query(
    "UPDATE affiliate_commissions SET paid = $1, paid_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2 RETURNING *",
    [paid, id]
  );
  return res.rows[0] || null;
}

// Chamado em reembolso/chargeback/cancelamento (ver cakto.js:
// handleCancellationEvent) — pedido do usuário: uma comissão nunca pode
// aparecer "a pagar" pra uma venda que acabou não se confirmando. Se ainda
// não foi paga, apaga na hora (nunca chega a aparecer pro admin). Se JÁ
// tinha sido paga (afiliado recebeu antes do cliente cancelar), não dá pra
// desfazer sozinho — devolve a linha pra quem chamar decidir o que avisar.
async function voidAffiliateCommission(caktoOrderId) {
  const existing = await pool.query("SELECT * FROM affiliate_commissions WHERE cakto_order_id = $1", [caktoOrderId]);
  const commission = existing.rows[0];
  if (!commission) return null;
  if (commission.paid) return commission;
  await pool.query("DELETE FROM affiliate_commissions WHERE id = $1", [commission.id]);
  return commission;
}

// ---------- Assinantes em período de teste (afiliado) ----------

// ON CONFLICT (cakto_subscription_id): idempotente pra reenvio de webhook,
// igual createAffiliateCommission acima — mas aqui é UPDATE em vez de DO
// NOTHING porque o valor/data do teste pode ter vindo diferente num reenvio
// (ex: a Cakto reprocessar o mesmo evento com dado corrigido).
async function upsertAffiliateTrialReferral({
  affiliateId,
  caktoSubscriptionId,
  customerEmail,
  customerName,
  subscriptionAmount,
  commissionPercentage,
  projectedCommissionValue,
  trialEndsAt,
}) {
  const res = await pool.query(
    `INSERT INTO affiliate_trial_referrals
       (affiliate_id, cakto_subscription_id, customer_email, customer_name, subscription_amount, commission_percentage, projected_commission_value, trial_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (cakto_subscription_id) DO UPDATE SET
       customer_email = EXCLUDED.customer_email,
       customer_name = EXCLUDED.customer_name,
       subscription_amount = EXCLUDED.subscription_amount,
       commission_percentage = EXCLUDED.commission_percentage,
       projected_commission_value = EXCLUDED.projected_commission_value,
       trial_ends_at = EXCLUDED.trial_ends_at
     RETURNING *`,
    [
      affiliateId,
      caktoSubscriptionId,
      customerEmail || null,
      customerName || null,
      subscriptionAmount,
      commissionPercentage,
      projectedCommissionValue,
      trialEndsAt || null,
    ]
  );
  return res.rows[0];
}

// Chamado quando o teste vira cobrança de verdade (a comissão real já foi
// criada em affiliate_commissions nesse ponto) ou quando é cancelado antes
// de cobrar — nos dois casos a projeção deixa de fazer sentido.
async function deleteAffiliateTrialReferral(caktoSubscriptionId) {
  if (!caktoSubscriptionId) return null;
  const res = await pool.query("DELETE FROM affiliate_trial_referrals WHERE cakto_subscription_id = $1 RETURNING *", [
    caktoSubscriptionId,
  ]);
  return res.rows[0] || null;
}

// Visão ADMIN (todos os afiliados juntos), igual listAffiliateCommissions()
// acima — usada em GET /api/admin/affiliate-trial-referrals.
// `trial_ends_at IS NULL OR trial_ends_at >= now()` filtra fora teste que
// já devia ter acabado (data passou) e nunca chegou nenhum webhook de
// conversão nem de cancelamento pra apagar a linha (ver aviso em
// handleSubscriptionCreated no cakto.js — não é garantido que a Cakto
// sempre mande um evento quando um teste simplesmente expira sem
// converter). Sem esse filtro, um teste "esquecido" ficaria mostrando
// "em teste até <data no passado>" pro embaixador pra sempre, parecendo
// quebrado. A linha não é apagada (só escondida) pra não perder o registro
// caso um webhook atrasado ainda chegue depois.
// Preço mensal de cada plano, usado só pra PROJETAR a comissão de quem está
// em teste e ainda não tem valor vindo da Cakto (teste atribuído por link de
// indicação ou marcação manual). Mesmos valores das ofertas de teste.
const TRIAL_PLAN_MONTHLY_PRICE = { solo: 127, pro: 187, agencia: 397 };

// "Galera do teste grátis" de um afiliado (ou de todos, se affiliateId for
// null). Junta DUAS fontes, sem contar a mesma pessoa duas vezes:
//  1) affiliate_trial_referrals — projeção que o webhook cria quando o
//     afiliado foi rastreado pelo link da Cakto (tem o valor real da assinatura);
//  2) organizações em teste (is_trial) atribuídas ao afiliado por link de
//     indicação (/free-trial?ref=) ou marcação manual — projeta pela % de 1ª
//     venda dele em cima do preço do plano.
// Teste vencido (data passou sem cobrança/cancelamento) fica escondido, igual
// antes — a linha não é apagada.
async function collectTrialReferrals(affiliateId) {
  const params = affiliateId ? [affiliateId] : [];
  const affFilter = affiliateId ? "AND a.id = $1" : "";
  const table = await pool.query(
    `SELECT t.*, a.name AS affiliate_name, a.cakto_email AS affiliate_email
     FROM affiliate_trial_referrals t
     JOIN affiliates a ON a.id = t.affiliate_id
     WHERE (t.trial_ends_at IS NULL OR t.trial_ends_at >= now()) ${affFilter}`,
    params
  );
  const orgs = await pool.query(
    `SELECT o.id AS org_id, o.plan, o.expires_at, o.cakto_customer_email,
            a.id AS affiliate_id, a.name AS affiliate_name, a.cakto_email AS affiliate_email, a.first_sale_percentage,
            (SELECT u.name FROM app_users u WHERE u.organization_id = o.id ORDER BY u.id LIMIT 1) AS user_name,
            (SELECT u.email FROM app_users u WHERE u.organization_id = o.id ORDER BY u.id LIMIT 1) AS user_email
     FROM organizations o
     JOIN affiliates a ON a.id = o.referred_by_affiliate_id
     WHERE o.is_trial = true AND o.expires_at >= now() ${affFilter}`,
    params
  );
  const rows = [...table.rows];
  const seen = new Set(rows.map((r) => `${r.affiliate_id}|${String(r.customer_email || "").toLowerCase()}`));
  for (const o of orgs.rows) {
    const email = String(o.cakto_customer_email || o.user_email || "").toLowerCase();
    if (email && seen.has(`${o.affiliate_id}|${email}`)) continue; // já veio pela projeção da Cakto
    const price = TRIAL_PLAN_MONTHLY_PRICE[o.plan] || 0;
    const pct = Number(o.first_sale_percentage);
    rows.push({
      id: `org-${o.org_id}`,
      affiliate_id: o.affiliate_id,
      affiliate_name: o.affiliate_name,
      affiliate_email: o.affiliate_email,
      customer_email: email || null,
      customer_name: o.user_name || null,
      subscription_amount: price,
      commission_percentage: pct,
      projected_commission_value: Math.round(price * (pct / 100) * 100) / 100,
      trial_ends_at: o.expires_at,
    });
  }
  rows.sort((a, b) => {
    const ta = a.trial_ends_at ? new Date(a.trial_ends_at).getTime() : Infinity;
    const tb = b.trial_ends_at ? new Date(b.trial_ends_at).getTime() : Infinity;
    return ta - tb;
  });
  return rows;
}

async function listAllAffiliateTrialReferrals() {
  return collectTrialReferrals(null);
}

async function listAffiliateTrialReferrals(affiliateId) {
  return collectTrialReferrals(affiliateId);
}

async function getAffiliateTrialSummary(affiliateId) {
  const rows = await collectTrialReferrals(affiliateId);
  return {
    trialCount: rows.length,
    projectedTrialTotal: Math.round(rows.reduce((s, r) => s + Number(r.projected_commission_value || 0), 0) * 100) / 100,
  };
}

// ---------- Indicação (cupom de cliente) ----------

async function getReferralCouponByUserId(userId) {
  const res = await pool.query("SELECT * FROM referral_coupons WHERE user_id = $1", [userId]);
  return res.rows[0] || null;
}

async function findReferralCouponByCode(code) {
  // lower() dos dois lados: o cupom criado na Cakto pode ser minúsculo
  // ("luanoff") e o webhook trazer maiúsculo ("LUANOFF") ou o contrário.
  const res = await pool.query(
    "SELECT * FROM referral_coupons WHERE lower(coupon_code) = lower($1) AND status = 'active'",
    [String(code).trim()]
  );
  return res.rows[0] || null;
}

// Idempotente de propósito (ON CONFLICT DO NOTHING + SELECT de volta): se a
// pessoa clicar "Solicitar cupom" de novo (recarregou a página, clicou 2x),
// não cria uma segunda linha nem apaga o pix_key que já tinha preenchido —
// só devolve o pedido que já existe.
async function createReferralCouponRequest(userId, pixKey, whatsapp) {
  await pool.query(
    `INSERT INTO referral_coupons (user_id, pix_key, whatsapp) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
    [userId, pixKey || null, whatsapp || null]
  );
  return getReferralCouponByUserId(userId);
}

async function updateReferralCouponPix(userId, pixKey) {
  const res = await pool.query("UPDATE referral_coupons SET pix_key = $1 WHERE user_id = $2 RETURNING *", [
    pixKey || null,
    userId,
  ]);
  return res.rows[0] || null;
}

async function updateReferralCouponWhatsapp(userId, whatsapp) {
  const res = await pool.query("UPDATE referral_coupons SET whatsapp = $1 WHERE user_id = $2 RETURNING *", [
    whatsapp || null,
    userId,
  ]);
  return res.rows[0] || null;
}

async function listReferralCoupons() {
  const res = await pool.query(`
    SELECT rc.*, u.name AS user_name, u.email AS user_email
    FROM referral_coupons rc
    JOIN app_users u ON u.id = rc.user_id
    ORDER BY rc.requested_at DESC
  `);
  return res.rows;
}

// Admin cola o código criado manualmente no painel da Cakto — é isso que
// libera o cupom pra pessoa ver/compartilhar (ver POST
// /api/admin/referrals/:id/activate em server.js).
async function activateReferralCoupon(id, couponCode) {
  const res = await pool.query(
    `UPDATE referral_coupons SET coupon_code = $1, status = 'active', activated_at = now() WHERE id = $2 RETURNING *`,
    [String(couponCode).trim(), id]
  );
  return res.rows[0] || null;
}

async function createReferralCommission({
  referralCouponId,
  caktoOrderId,
  customerEmail,
  customerName,
  saleAmount,
  commissionPercentage,
  commissionValue,
}) {
  const res = await pool.query(
    `INSERT INTO referral_commissions
       (referral_coupon_id, cakto_order_id, customer_email, customer_name, sale_amount, commission_percentage, commission_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (cakto_order_id) DO NOTHING
     RETURNING *`,
    [referralCouponId, caktoOrderId, customerEmail, customerName || null, saleAmount, commissionPercentage, commissionValue]
  );
  return res.rows[0] || null;
}

async function listReferralCommissionsByUserId(userId) {
  const res = await pool.query(
    `SELECT rc.* FROM referral_commissions rc
     JOIN referral_coupons c ON c.id = rc.referral_coupon_id
     WHERE c.user_id = $1
     ORDER BY rc.created_at DESC`,
    [userId]
  );
  return res.rows;
}

async function listReferralCommissions() {
  const res = await pool.query(`
    SELECT rc.*, c.coupon_code, c.pix_key, u.name AS referrer_name, u.email AS referrer_email
    FROM referral_commissions rc
    JOIN referral_coupons c ON c.id = rc.referral_coupon_id
    JOIN app_users u ON u.id = c.user_id
    ORDER BY rc.created_at DESC
  `);
  return res.rows;
}

async function markReferralCommissionPaid(id, paid) {
  const res = await pool.query(
    "UPDATE referral_commissions SET paid = $1, paid_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2 RETURNING *",
    [paid, id]
  );
  return res.rows[0] || null;
}

// Mesma lógica de voidAffiliateCommission (ver acima): reembolso/chargeback/
// cancelamento nunca pode deixar comissão de indicação "a pagar" por uma
// venda que se desfez.
async function voidReferralCommission(caktoOrderId) {
  const existing = await pool.query("SELECT * FROM referral_commissions WHERE cakto_order_id = $1", [caktoOrderId]);
  const commission = existing.rows[0];
  if (!commission) return null;
  if (commission.paid) return commission;
  await pool.query("DELETE FROM referral_commissions WHERE id = $1", [commission.id]);
  return commission;
}

// ---------- Comunidade de embaixadores ----------

async function getCommunityByAffiliateId(affiliateId) {
  const res = await pool.query("SELECT * FROM communities WHERE affiliate_id = $1", [affiliateId]);
  return res.rows[0] || null;
}

async function getCommunityById(id) {
  const res = await pool.query("SELECT * FROM communities WHERE id = $1", [id]);
  return res.rows[0] || null;
}

// Cria a comunidade JÁ com um canal "Geral" (uma comunidade sem canal
// nenhum não tem onde postar) — o embaixador cria canais extras depois
// pela própria tela.
async function createCommunity(affiliateId, name, photoUrl) {
  const res = await pool.query(
    `INSERT INTO communities (affiliate_id, name, photo_url) VALUES ($1, $2, $3)
     ON CONFLICT (affiliate_id) DO NOTHING RETURNING *`,
    [affiliateId, name, photoUrl || null]
  );
  const community = res.rows[0] || (await getCommunityByAffiliateId(affiliateId));
  if (res.rows[0]) {
    await pool.query("INSERT INTO community_channels (community_id, name, position) VALUES ($1, 'Geral', 0)", [community.id]);
    // Comunidade nova nasce já com os clientes que esse afiliado JÁ trouxe
    // (ex.: quem comprou pelo link dele antes da comunidade existir).
    await joinAffiliateReferredOrgsToCommunity(affiliateId, community.id);
  }
  return community;
}

// Coloca na comunidade (source='affiliate') toda organização que esse
// afiliado trouxe: marcada como "afiliado responsável", ou dona de uma
// venda já registrada em affiliate_commissions pra ele. Quem já está em
// QUALQUER comunidade fica onde está (joinCommunity nunca troca alguém de
// comunidade). Devolve quantas entraram agora.
async function joinAffiliateReferredOrgsToCommunity(affiliateId, communityId) {
  const res = await pool.query(
    `SELECT DISTINCT o.id FROM organizations o
     WHERE o.referred_by_affiliate_id = $1
        OR o.cakto_purchase_id IN (SELECT cakto_order_id FROM affiliate_commissions WHERE affiliate_id = $1)
        OR o.cakto_customer_email IN (SELECT customer_email FROM affiliate_commissions WHERE affiliate_id = $1)`,
    [affiliateId]
  );
  let joined = 0;
  for (const row of res.rows) {
    if (await getCommunityMembershipByOrgId(row.id)) continue;
    await joinCommunity(communityId, row.id, "affiliate");
    joined += 1;
  }
  return joined;
}

// Atribui a organização a um afiliado e, se ele já tem comunidade, já coloca
// a organização nela (source='affiliate'). Remover a atribuição (null) NÃO
// tira ninguém da comunidade.
async function attributeOrganizationToAffiliate(orgId, affiliateId) {
  await setOrganizationAffiliate(orgId, affiliateId);
  if (affiliateId) {
    const community = await getCommunityByAffiliateId(affiliateId);
    if (community && !(await getCommunityMembershipByOrgId(orgId))) {
      await joinCommunity(community.id, orgId, "affiliate");
    }
  }
}

async function updateCommunityDetails(id, { name, description, photoUrl, bannerUrl, accentColor, tags, instagramUrl, youtubeUrl, websiteUrl }) {
  const res = await pool.query(
    `UPDATE communities SET
       name = COALESCE($1, name),
       description = $2,
       photo_url = COALESCE($3, photo_url),
       banner_url = COALESCE($4, banner_url),
       accent_color = COALESCE($5, accent_color),
       tags = $6,
       instagram_url = $7,
       youtube_url = $8,
       website_url = $9
     WHERE id = $10 RETURNING *`,
    [
      name || null,
      description ?? null,
      photoUrl || null,
      bannerUrl || null,
      accentColor || null,
      tags ?? null,
      instagramUrl ?? null,
      youtubeUrl ?? null,
      websiteUrl ?? null,
      id,
    ]
  );
  return res.rows[0] || null;
}

// ---------- Canais ----------

async function listCommunityChannels(communityId) {
  const res = await pool.query("SELECT * FROM community_channels WHERE community_id = $1 ORDER BY position ASC, id ASC", [
    communityId,
  ]);
  return res.rows;
}

async function getCommunityChannelById(id) {
  const res = await pool.query("SELECT * FROM community_channels WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function createCommunityChannel(communityId, name, groupName) {
  const maxPos = await pool.query("SELECT COALESCE(MAX(position), -1) AS max_pos FROM community_channels WHERE community_id = $1", [
    communityId,
  ]);
  const res = await pool.query(
    "INSERT INTO community_channels (community_id, name, group_name, position) VALUES ($1, $2, $3, $4) RETURNING *",
    [communityId, name, groupName || null, maxPos.rows[0].max_pos + 1]
  );
  return res.rows[0];
}

async function renameCommunityChannel(id, name) {
  const res = await pool.query("UPDATE community_channels SET name = $1 WHERE id = $2 RETURNING *", [name, id]);
  return res.rows[0] || null;
}

// Não deixa apagar o último canal restante — sem isso a comunidade fica
// sem lugar nenhum pra postar.
async function deleteCommunityChannel(id) {
  const channel = await getCommunityChannelById(id);
  if (!channel) return null;
  const remaining = await pool.query("SELECT COUNT(*)::int AS count FROM community_channels WHERE community_id = $1", [
    channel.community_id,
  ]);
  if (remaining.rows[0].count <= 1) {
    throw new Error("Não é possível apagar o último canal da comunidade.");
  }
  await pool.query("DELETE FROM community_channels WHERE id = $1", [id]);
  return channel;
}

// Uma organização só pode estar numa comunidade na vida (organization_id é
// UNIQUE) — null quer dizer "ainda não entrou em nenhuma".
async function getCommunityMembershipByOrgId(organizationId) {
  const res = await pool.query("SELECT * FROM community_members WHERE organization_id = $1", [organizationId]);
  return res.rows[0] || null;
}

// Idempotente (ON CONFLICT DO NOTHING): tanto pro reenvio de webhook (join
// automático via link de afiliado) quanto pra evitar corrida se a pessoa
// clicar "Participar" duas vezes.
async function joinCommunity(communityId, organizationId, source = "directory") {
  await pool.query(
    `INSERT INTO community_members (community_id, organization_id, source) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id) DO NOTHING`,
    [communityId, organizationId, source]
  );
  return getCommunityMembershipByOrgId(organizationId);
}

// "Ativo" = organização não vencida — mesma definição que já bloqueia login
// em requireAuth (server.js), não um conceito novo. Conta TODO MUNDO
// (affiliate + directory) — usada pra tamanho/engajamento geral da
// comunidade (StatPill do cabeçalho, taxa de engajamento), NUNCA pra
// decidir comissão (ver countActiveReferredCommunityMembers abaixo pra
// isso).
async function countActiveCommunityMembers(communityId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM community_members cm
     JOIN organizations o ON o.id = cm.organization_id
     WHERE cm.community_id = $1 AND o.expires_at > now()`,
    [communityId]
  );
  return res.rows[0].count;
}

// Só os membros que o embaixador REALMENTE trouxe (source='affiliate') —
// essa é a contagem que decide o nível/percentual dele (ver
// communityTiers.js e cakto.js:recordCommunityCommissionIfAny), diferente
// de countActiveCommunityMembers acima (que conta todo mundo, só pra
// mostrar o tamanho da comunidade).
async function countActiveReferredCommunityMembers(communityId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM community_members cm
     JOIN organizations o ON o.id = cm.organization_id
     WHERE cm.community_id = $1 AND cm.source = 'affiliate' AND o.expires_at > now()`,
    [communityId]
  );
  return res.rows[0].count;
}

// Lista pra tela de "participar de uma comunidade" — só comunidades
// existentes, com quantos membros ativos cada uma já tem (prova social) e
// quem é o embaixador dono.
async function listCommunitiesDirectory() {
  // Contagem agregada num subquery À PARTE (não um GROUP BY que misture
  // communities.name e affiliates.name na mesma consulta) — sem isso
  // esbarra num bug do pg-mem que confunde os dois "name" de tabelas
  // diferentes no agrupamento (nunca aconteceria no Postgres real, mas sem
  // reescrever assim não dava pra testar essa tela localmente).
  const res = await pool.query(`
    SELECT c.id, c.name AS community_name, c.description, c.photo_url, a.name AS ambassador_name,
      COALESCE(m.active_member_count, 0)::int AS active_member_count
    FROM communities c
    JOIN affiliates a ON a.id = c.affiliate_id
    LEFT JOIN (
      SELECT cm.community_id, SUM(CASE WHEN o.expires_at > now() THEN 1 ELSE 0 END) AS active_member_count
      FROM community_members cm
      JOIN organizations o ON o.id = cm.organization_id
      GROUP BY cm.community_id
    ) m ON m.community_id = c.id
    ORDER BY active_member_count DESC, c.created_at ASC
  `);
  return res.rows;
}

// Totais pra cabeçalho da comunidade (estilo banner de rede social: "N
// posts", "N curtidas", "N comentários") — soma TODOS os canais, diferente
// de listCommunityPostsByChannel que é só do canal ativo. 3 subqueries
// separadas (em vez de JOIN + GROUP BY numa query só) pelo mesmo motivo já
// documentado em listCommunitiesDirectory: evita o bug do pg-mem com
// GROUP BY misturando colunas de tabelas diferentes.
async function getCommunityContentStats(communityId) {
  const [posts, likes, comments] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM community_posts WHERE community_id = $1", [communityId]),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM community_post_likes l
       JOIN community_posts p ON p.id = l.post_id WHERE p.community_id = $1`,
      [communityId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM community_comments c
       JOIN community_posts p ON p.id = c.post_id WHERE p.community_id = $1`,
      [communityId]
    ),
  ]);
  return { postCount: posts.rows[0].count, likeCount: likes.rows[0].count, commentCount: comments.rows[0].count };
}

// Membros individuais (pessoas de verdade, não organizações) pra tela de
// "Membros" — uma organização pode ter N app_users, então isso pode
// devolver mais linhas que countActiveCommunityMembers (que conta
// organizações). `active` reflete a mesma regra de sempre (expires_at no
// futuro).
async function listCommunityMembersDetailed(communityId) {
  const res = await pool.query(
    `SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email,
            o.id AS organization_id, o.name AS organization_name, o.expires_at,
            cm.joined_at, cm.muted, cm.source, o.is_trial
     FROM community_members cm
     JOIN organizations o ON o.id = cm.organization_id
     JOIN app_users u ON u.organization_id = o.id
     WHERE cm.community_id = $1
     ORDER BY cm.joined_at ASC, u.name ASC`,
    [communityId]
  );
  return res.rows.map((r) => ({ ...r, active: new Date(r.expires_at) > new Date() }));
}

// Silenciar/dessilenciar (ver comentário na migration acima) — devolve null
// se essa organização não é membro dessa comunidade (evita silenciar à toa
// alguém de outra comunidade por engano de id).
async function setCommunityMemberMuted(communityId, organizationId, muted) {
  const res = await pool.query(
    "UPDATE community_members SET muted = $1 WHERE community_id = $2 AND organization_id = $3 RETURNING *",
    [muted, communityId, organizationId]
  );
  return res.rows[0] || null;
}

// Expulsar (ver comentário na migration acima): apaga a linha de
// community_members de vez — a pessoa perde o acesso na próxima requisição
// (communityIfAllowed não acha mais a membership) e o organization_id fica
// livre de novo pra entrar em OUTRA comunidade depois pelo diretório
// (GET /api/community/directory + POST /api/community/join). Não mexe na
// assinatura ScoutX da organização nem em comentários/curtidas que ela já
// tinha feito (fica como histórico, igual qualquer outro post apagado por
// alguém que saiu). Devolve a linha removida, ou null se não era membro.
async function removeCommunityMember(communityId, organizationId) {
  const res = await pool.query(
    "DELETE FROM community_members WHERE community_id = $1 AND organization_id = $2 RETURNING *",
    [communityId, organizationId]
  );
  return res.rows[0] || null;
}

// Ranking de "membros mais ativos" por engajamento real (comentários +
// curtidas dados dentro DESSA comunidade) — cada contagem é uma subquery
// agrupada numa única tabela, depois unidas por LEFT JOIN (mesmo padrão já
// usado em listCommunitiesDirectory, pelo bug de GROUP BY do pg-mem
// documentado no HANDOFF). Não inclui posts do embaixador (ele não
// "engaja", ele publica) nem pontuação inventada, só o que dá pra contar.
async function listCommunityTopContributors(communityId, limit = 10) {
  const res = await pool.query(
    `SELECT u.id AS user_id, u.name AS user_name,
            COALESCE(c.comment_count, 0)::int AS comment_count,
            COALESCE(l.like_count, 0)::int AS like_count,
            (COALESCE(c.comment_count, 0) + COALESCE(l.like_count, 0))::int AS score
     FROM app_users u
     JOIN organizations o ON o.id = u.organization_id
     JOIN community_members cm ON cm.organization_id = o.id AND cm.community_id = $1
     LEFT JOIN (
       SELECT cc.author_user_id, COUNT(*) AS comment_count
       FROM community_comments cc
       JOIN community_posts p ON p.id = cc.post_id
       WHERE p.community_id = $1
       GROUP BY cc.author_user_id
     ) c ON c.author_user_id = u.id
     LEFT JOIN (
       SELECT l.user_id, COUNT(*) AS like_count
       FROM community_post_likes l
       JOIN community_posts p ON p.id = l.post_id
       WHERE p.community_id = $1
       GROUP BY l.user_id
     ) l ON l.user_id = u.id
     WHERE COALESCE(c.comment_count, 0) + COALESCE(l.like_count, 0) > 0
     ORDER BY score DESC
     LIMIT $2`,
    [communityId, limit]
  );
  return res.rows;
}

// Resumo financeiro pra aba Membros do embaixador (pedido do Samuel,
// 2026-09-14): "já recebido" e "a receber" são somas REAIS de
// community_commissions (paid=true / paid=false), nada inventado. A
// "estimativa por ciclo" já É especulativa por natureza (ninguém sabe se
// todo mundo vai renovar) — usa a média histórica de comissão por
// renovação DESSA comunidade (sale_amount × percentual do tier na hora,
// já embutido em commission_value) multiplicada pelos membros ativos
// hoje. Sem histórico nenhum ainda, devolve null em vez de chutar um
// número sem base (nunca assume um "preço de plano" que não existe no
// schema — ver comentário em `organizations` sobre não ter preço
// estruturado).
async function getCommunityEarningsSummary(communityId) {
  const [totals, activeMemberCount] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN paid THEN commission_value ELSE 0 END), 0)::numeric AS total_received,
         COALESCE(SUM(CASE WHEN NOT paid THEN commission_value ELSE 0 END), 0)::numeric AS total_pending,
         COALESCE(AVG(commission_value), 0)::numeric AS avg_commission_value,
         COUNT(*)::int AS commission_count
       FROM community_commissions
       WHERE community_id = $1`,
      [communityId]
    ),
    // Referido, não total — só quem o embaixador trouxe de verdade é que
    // pode virar comissão numa renovação (ver comentário na migration de
    // community_members.source). Usar o total aqui inflaria a estimativa
    // com gente que nunca vai gerar comissão nenhuma.
    countActiveReferredCommunityMembers(communityId),
  ]);
  const row = totals.rows[0];
  const avgCommissionValue = Number(row.avg_commission_value);
  const hasHistory = row.commission_count > 0;
  let projectedNextCycle = hasHistory ? avgCommissionValue * activeMemberCount : null;
  if (!hasHistory && activeMemberCount > 0) {
    // Sem nenhuma comissão paga ainda: estima pelo preço mensal do plano de
    // cada membro trazido pelo embaixador x % do nível atual (nível conta
    // a comunidade inteira, igual ao cálculo real em cakto.js).
    const plans = await pool.query(
      `SELECT o.plan FROM community_members cm
       JOIN organizations o ON o.id = cm.organization_id
       WHERE cm.community_id = $1 AND cm.source = 'affiliate' AND o.expires_at > now()`,
      [communityId]
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS count FROM community_members cm
       JOIN organizations o ON o.id = cm.organization_id
       WHERE cm.community_id = $1 AND o.expires_at > now()`,
      [communityId]
    );
    const pct = tierForActiveMembers(total.rows[0].count).percentage;
    const gross = plans.rows.reduce((s, r) => s + (TRIAL_PLAN_MONTHLY_PRICE[r.plan] || 0), 0);
    projectedNextCycle = gross > 0 ? Math.round(gross * (pct / 100) * 100) / 100 : null;
  }
  return {
    totalReceived: Number(row.total_received),
    totalPending: Number(row.total_pending),
    activeMemberCount,
    projectedNextCycle,
    avgCommissionValue: hasHistory ? avgCommissionValue : null,
  };
}

// Feed de "atividade recente" (widget da referência) com dado 100% real:
// junta os 3 tipos de evento que já existem (comentário, curtida, entrada
// na comunidade) numa lista só, ordenada por data — sem inventar métrica
// de sessão/pageview que o app não rastreia. Cada tipo é uma query própria
// (nunca UNION misturando tabelas diferentes, mesmo motivo de sempre: mais
// simples de auditar e evita o bug de GROUP BY do pg-mem documentado no
// HANDOFF), a junção e ordenação final acontece em JS.
async function listCommunityRecentActivity(communityId, limit = 8) {
  const [comments, likes, joins] = await Promise.all([
    pool.query(
      `SELECT cc.author_name AS actor_name, cc.created_at, 'comment' AS type
       FROM community_comments cc
       JOIN community_posts p ON p.id = cc.post_id
       WHERE p.community_id = $1
       ORDER BY cc.created_at DESC LIMIT $2`,
      [communityId, limit]
    ),
    pool.query(
      `SELECT u.name AS actor_name, l.created_at, 'like' AS type
       FROM community_post_likes l
       JOIN community_posts p ON p.id = l.post_id
       JOIN app_users u ON u.id = l.user_id
       WHERE p.community_id = $1
       ORDER BY l.created_at DESC LIMIT $2`,
      [communityId, limit]
    ),
    pool.query(
      `SELECT u.name AS actor_name, cm.joined_at AS created_at, 'join' AS type
       FROM community_members cm
       JOIN organizations o ON o.id = cm.organization_id
       JOIN app_users u ON u.organization_id = o.id
       WHERE cm.community_id = $1
       ORDER BY cm.joined_at DESC LIMIT $2`,
      [communityId, limit]
    ),
  ]);
  return [...comments.rows, ...likes.rows, ...joins.rows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

// ---------- Home do assinante ----------

// Posts de TODOS os canais (não só o ativo) ordenados por data — usado só
// na Home ("Últimas publicações"), diferente de listCommunityPostsByChannel
// que é escopado a um canal.
async function listCommunityRecentPosts(communityId, limit = 5) {
  const res = await pool.query(
    `SELECT p.*, COALESCE(l.like_count, 0)::int AS like_count
     FROM community_posts p
     LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM community_post_likes GROUP BY post_id) l ON l.post_id = p.id
     WHERE p.community_id = $1 AND (p.scheduled_at IS NULL OR p.scheduled_at <= now())
     ORDER BY p.created_at DESC LIMIT $2`,
    [communityId, limit]
  );
  return res.rows;
}

// "Avisos importantes" da Home = posts fixados em QUALQUER canal (reusa o
// campo `pinned` que já existe, em vez de criar uma flag nova de "aviso
// global" — um post fixado já É a forma que o embaixador tem hoje de
// destacar algo importante).
async function listCommunityAnnouncements(communityId, limit = 5) {
  const res = await pool.query(
    `SELECT p.* FROM community_posts p WHERE p.community_id = $1 AND p.pinned = true AND (p.scheduled_at IS NULL OR p.scheduled_at <= now()) ORDER BY p.created_at DESC LIMIT $2`,
    [communityId, limit]
  );
  return res.rows;
}

async function getCommunityResourceProgress(resourceId, userId) {
  const res = await pool.query("SELECT * FROM community_resource_progress WHERE resource_id = $1 AND user_id = $2", [
    resourceId,
    userId,
  ]);
  return res.rows[0] || null;
}

async function upsertCommunityResourceProgress(resourceId, userId, completed) {
  const res = await pool.query(
    `INSERT INTO community_resource_progress (resource_id, user_id, completed_at, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (resource_id, user_id) DO UPDATE SET completed_at = $3, updated_at = now()
     RETURNING *`,
    [resourceId, userId, completed ? new Date() : null]
  );
  return res.rows[0];
}

// Devolve o progresso de TODOS os recursos da comunidade pro usuário
// (join LEFT pra recurso sem linha nenhuma ainda contar como "não
// iniciado") — a Home usa isso pra montar "continue de onde parou" (tem
// progresso, não concluído) e "novos conteúdos" (sem nenhuma linha, criado
// recentemente).
async function listCommunityResourcesWithProgress(communityId, userId) {
  const res = await pool.query(
    `SELECT r.*, rp.completed_at, rp.updated_at AS progress_updated_at
     FROM community_resources r
     LEFT JOIN community_resource_progress rp ON rp.resource_id = r.id AND rp.user_id = $2
     WHERE r.community_id = $1
     ORDER BY r.position ASC, r.id ASC`,
    [communityId, userId]
  );
  return res.rows;
}

// ---------- Notificações ----------

async function createNotification({ communityId, recipientUserId, type, message, postId, resourceId }) {
  await pool.query(
    `INSERT INTO community_notifications (community_id, recipient_user_id, type, message, post_id, resource_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [communityId, recipientUserId, type, message, postId || null, resourceId || null]
  );
}

// Fan-out: uma linha por destinatário, decidido na hora da escrita (não no
// momento da leitura) — ver comentário na criação da tabela em migrate().
async function notifyCommunityMembers(communityId, { type, message, postId, resourceId }) {
  const members = await listCommunityMembersDetailed(communityId);
  const uniqueUserIds = [...new Set(members.map((m) => m.user_id))];
  for (const userId of uniqueUserIds) {
    await createNotification({ communityId, recipientUserId: userId, type, message, postId, resourceId });
  }
}

async function listNotificationsForUser(communityId, userId, limit = 20) {
  const res = await pool.query(
    `SELECT * FROM community_notifications WHERE community_id = $1 AND recipient_user_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [communityId, userId, limit]
  );
  return res.rows;
}

async function countUnreadNotifications(communityId, userId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM community_notifications
     WHERE community_id = $1 AND recipient_user_id = $2 AND read_at IS NULL`,
    [communityId, userId]
  );
  return res.rows[0].count;
}

async function markNotificationRead(id, userId) {
  await pool.query(
    "UPDATE community_notifications SET read_at = now() WHERE id = $1 AND recipient_user_id = $2 AND read_at IS NULL",
    [id, userId]
  );
}

async function markAllNotificationsRead(communityId, userId) {
  await pool.query(
    "UPDATE community_notifications SET read_at = now() WHERE community_id = $1 AND recipient_user_id = $2 AND read_at IS NULL",
    [communityId, userId]
  );
}

async function listCommunityResources(communityId) {
  const res = await pool.query(
    "SELECT * FROM community_resources WHERE community_id = $1 ORDER BY position ASC, id ASC",
    [communityId]
  );
  return res.rows;
}

async function getCommunityResourceById(id) {
  const res = await pool.query("SELECT * FROM community_resources WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function createCommunityResource({ communityId, kind, title, body, url, durationLabel }) {
  const maxPos = await pool.query("SELECT COALESCE(MAX(position), -1) AS max_pos FROM community_resources WHERE community_id = $1", [
    communityId,
  ]);
  const res = await pool.query(
    `INSERT INTO community_resources (community_id, kind, title, body, url, duration_label, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [communityId, kind, title, body || null, url || null, durationLabel || null, maxPos.rows[0].max_pos + 1]
  );
  return res.rows[0];
}

async function updateCommunityResource(id, { kind, title, body, url, durationLabel }) {
  const res = await pool.query(
    `UPDATE community_resources SET kind = $1, title = $2, body = $3, url = $4, duration_label = $5 WHERE id = $6 RETURNING *`,
    [kind, title, body || null, url || null, durationLabel || null, id]
  );
  return res.rows[0] || null;
}

async function deleteCommunityResource(id) {
  await pool.query("DELETE FROM community_resources WHERE id = $1", [id]);
}

async function createCommunityPost({ communityId, channelId, body, imageUrl, scheduledAt }) {
  const res = await pool.query(
    `INSERT INTO community_posts (community_id, channel_id, body, image_url, scheduled_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [communityId, channelId, body, imageUrl || null, scheduledAt || null]
  );
  return res.rows[0];
}

// Curtida agregada em subquery à parte (mesmo motivo do directory acima:
// evita qualquer GROUP BY que possa esbarrar em limitação do pg-mem) +
// LEFT JOIN da curtida do PRÓPRIO usuário pra saber se ele já curtiu, sem
// usar `EXISTS`/subquery correlacionada no SELECT (não testado contra
// pg-mem, mas esse padrão de JOIN já é comprovado seguro aqui). Fixado
// sempre primeiro, depois ordena por data ou por curtidas conforme pedido.
// scheduled_at no futuro = post ainda não "publicou" pra quem só acompanha
// o feed (o embaixador vê o próprio rascunho agendado na área dedicada,
// ver listScheduledCommunityPosts, não misturado aqui no feed normal).
async function listCommunityPostsByChannel(channelId, viewerUserId, sort = "recent") {
  const orderBy = sort === "likes" ? "p.pinned DESC, like_count DESC, p.created_at DESC" : "p.pinned DESC, p.created_at DESC";
  const res = await pool.query(
    `SELECT p.*, COALESCE(l.like_count, 0)::int AS like_count, (ul.id IS NOT NULL) AS liked_by_me, (us.id IS NOT NULL) AS saved_by_me
     FROM community_posts p
     LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM community_post_likes GROUP BY post_id) l ON l.post_id = p.id
     LEFT JOIN community_post_likes ul ON ul.post_id = p.id AND ul.user_id = $2
     LEFT JOIN community_post_saves us ON us.post_id = p.id AND us.user_id = $2
     WHERE p.channel_id = $1 AND (p.scheduled_at IS NULL OR p.scheduled_at <= now())
     ORDER BY ${orderBy}`,
    [channelId, viewerUserId]
  );
  return res.rows;
}

// Opções + contagem de votos de TODAS as enquetes de um canal, numa
// query só (evita N+1 e evita `= ANY($1::int[])`, que o pg-mem não lida
// bem — ver limitação documentada no HANDOFF.md). O servidor agrupa por
// post_id depois em JS.
async function getPollOptionsForChannel(channelId, viewerUserId) {
  const res = await pool.query(
    `SELECT po.id, po.post_id, po.label, po.position,
            COALESCE(v.vote_count, 0)::int AS vote_count,
            (mv.id IS NOT NULL) AS voted_by_me
     FROM community_poll_options po
     JOIN community_posts p ON p.id = po.post_id
     LEFT JOIN (SELECT option_id, COUNT(*) AS vote_count FROM community_poll_votes GROUP BY option_id) v ON v.option_id = po.id
     LEFT JOIN community_poll_votes mv ON mv.option_id = po.id AND mv.user_id = $2
     WHERE p.channel_id = $1
     ORDER BY po.post_id ASC, po.position ASC`,
    [channelId, viewerUserId]
  );
  return res.rows;
}

async function createPollOptions(postId, labels) {
  for (let i = 0; i < labels.length; i++) {
    await pool.query("INSERT INTO community_poll_options (post_id, label, position) VALUES ($1, $2, $3)", [postId, labels[i], i]);
  }
}

// Um voto por (post, usuário) — votar de novo troca a opção em vez de
// acumular (mesma UNIQUE constraint usada em curtidas/salvos deste arquivo).
async function getCommunityPollVote(postId, userId) {
  const res = await pool.query("SELECT * FROM community_poll_votes WHERE post_id = $1 AND user_id = $2", [postId, userId]);
  return res.rows[0] || null;
}

async function upsertCommunityPollVote(postId, userId, optionId) {
  await pool.query(
    `INSERT INTO community_poll_votes (post_id, option_id, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (post_id, user_id) DO UPDATE SET option_id = $2`,
    [postId, optionId, userId]
  );
}

// Área "Publicações agendadas" (só o embaixador vê) — posts com
// scheduled_at no futuro, em QUALQUER canal da comunidade.
async function listScheduledCommunityPosts(communityId) {
  const res = await pool.query(
    `SELECT p.*, c.name AS channel_name FROM community_posts p
     JOIN community_channels c ON c.id = p.channel_id
     WHERE p.community_id = $1 AND p.scheduled_at IS NOT NULL AND p.scheduled_at > now()
     ORDER BY p.scheduled_at ASC`,
    [communityId]
  );
  return res.rows;
}

async function publishCommunityPostNow(id) {
  const res = await pool.query("UPDATE community_posts SET scheduled_at = NULL WHERE id = $1 RETURNING *", [id]);
  return res.rows[0] || null;
}

// ---------- XP ----------

const XP_AMOUNTS = { comment: 10, poll_vote: 20, resource_completed: 50 };

async function recordXpEvent(communityId, userId, type) {
  await pool.query(`INSERT INTO community_xp_events (community_id, user_id, type, amount) VALUES ($1, $2, $3, $4)`, [
    communityId,
    userId,
    type,
    XP_AMOUNTS[type],
  ]);
}

// Subquery agregada numa tabela só (community_xp_events) antes do JOIN com
// app_users, mesmo padrão defensivo já usado no resto do arquivo pra evitar
// o bug de GROUP BY entre tabelas do pg-mem.
async function listCommunityXpLeaderboard(communityId, limit = 10) {
  const res = await pool.query(
    `SELECT u.id AS user_id, u.name AS user_name, x.xp
     FROM app_users u
     JOIN (
       SELECT user_id, SUM(amount)::int AS xp
       FROM community_xp_events
       WHERE community_id = $1
       GROUP BY user_id
     ) x ON x.user_id = u.id
     ORDER BY x.xp DESC
     LIMIT $2`,
    [communityId, limit]
  );
  return res.rows;
}

async function getUserXpTotal(communityId, userId) {
  const res = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS xp FROM community_xp_events WHERE community_id = $1 AND user_id = $2`,
    [communityId, userId]
  );
  return res.rows[0].xp;
}

// ---------- Analytics ----------

// "Posts mais engajados" (seção 18 do briefing) — curtidas+comentários por
// post, subqueries agregadas separadas (mesmo motivo de sempre) unidas por
// LEFT JOIN.
async function listTopEngagedPosts(communityId, limit = 5) {
  const res = await pool.query(
    `SELECT p.id, p.body, p.created_at,
            COALESCE(l.like_count, 0)::int AS like_count,
            COALESCE(c.comment_count, 0)::int AS comment_count,
            (COALESCE(l.like_count, 0) + COALESCE(c.comment_count, 0))::int AS engagement
     FROM community_posts p
     LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM community_post_likes GROUP BY post_id) l ON l.post_id = p.id
     LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM community_comments GROUP BY post_id) c ON c.post_id = p.id
     WHERE p.community_id = $1 AND (p.scheduled_at IS NULL OR p.scheduled_at <= now())
     ORDER BY engagement DESC, p.created_at DESC
     LIMIT $2`,
    [communityId, limit]
  );
  return res.rows;
}

// "Conteúdos mais concluídos" (seção 18) — usa community_resource_progress
// que já existe pra "Continue de onde parou" da Home.
async function listTopCompletedResources(communityId, limit = 5) {
  const res = await pool.query(
    `SELECT r.id, r.title, r.kind, COALESCE(cp.completed_count, 0)::int AS completed_count
     FROM community_resources r
     LEFT JOIN (
       SELECT resource_id, COUNT(*) AS completed_count
       FROM community_resource_progress
       WHERE completed_at IS NOT NULL
       GROUP BY resource_id
     ) cp ON cp.resource_id = r.id
     WHERE r.community_id = $1
     ORDER BY completed_count DESC, r.id ASC
     LIMIT $2`,
    [communityId, limit]
  );
  return res.rows;
}

// Toggle: se já curtiu, remove; se não, adiciona. Devolve o novo estado
// ({liked: bool}) pra UI atualizar sem precisar recarregar o post inteiro.
async function toggleCommunityPostLike(postId, userId) {
  const existing = await pool.query("SELECT id FROM community_post_likes WHERE post_id = $1 AND user_id = $2", [
    postId,
    userId,
  ]);
  if (existing.rows[0]) {
    await pool.query("DELETE FROM community_post_likes WHERE id = $1", [existing.rows[0].id]);
    return { liked: false };
  }
  await pool.query("INSERT INTO community_post_likes (post_id, user_id) VALUES ($1, $2)", [postId, userId]);
  return { liked: true };
}

async function toggleCommunityPostSave(postId, userId) {
  const existing = await pool.query("SELECT id FROM community_post_saves WHERE post_id = $1 AND user_id = $2", [
    postId,
    userId,
  ]);
  if (existing.rows[0]) {
    await pool.query("DELETE FROM community_post_saves WHERE id = $1", [existing.rows[0].id]);
    return { saved: false };
  }
  await pool.query("INSERT INTO community_post_saves (post_id, user_id) VALUES ($1, $2)", [postId, userId]);
  return { saved: true };
}

async function getCommunityPostById(id) {
  const res = await pool.query("SELECT * FROM community_posts WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function updateCommunityPost(id, { body, imageUrl, scheduledAt }) {
  const res = await pool.query(
    "UPDATE community_posts SET body = $1, image_url = $2, scheduled_at = $3 WHERE id = $4 RETURNING *",
    [body, imageUrl ?? null, scheduledAt ?? null, id]
  );
  return res.rows[0] || null;
}

async function deleteCommunityPost(id) {
  await pool.query("DELETE FROM community_posts WHERE id = $1", [id]);
}

async function toggleCommunityPostPin(id) {
  const res = await pool.query("UPDATE community_posts SET pinned = NOT pinned WHERE id = $1 RETURNING *", [id]);
  return res.rows[0] || null;
}

async function createCommunityComment({ postId, authorUserId, authorName, isAmbassador, body }) {
  const res = await pool.query(
    `INSERT INTO community_comments (post_id, author_user_id, author_name, is_ambassador, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [postId, authorUserId, authorName, isAmbassador, body]
  );
  return res.rows[0];
}

// Busca via JOIN em community_posts filtrando por community_id, em vez de
// receber uma lista de IDs de post e usar `= ANY($1::int[])` — achado
// testando localmente: esse operador com array de parâmetro devolve vazio
// no pg-mem (bug do simulador, não reproduzido isolado; provável limitação
// dele com esse padrão específico de bind). JOIN direto é tão simples
// quanto e não depende de nenhum comportamento exótico do driver.
// author_member_since alimenta o selo de antiguidade no frontend (ver
// MEMBER_LEVELS em Comunidade.jsx) — data em que a ORGANIZAÇÃO do autor
// entrou NESSA comunidade (não a data de criação da conta). Fica null pro
// embaixador (ele não é uma linha em community_members, é o dono) e pra
// comentário de conta já excluída (author_user_id vira null).
// Comentário + community_id do post dele (pra checar dono antes de apagar).
async function getCommunityCommentById(id) {
  const res = await pool.query(
    `SELECT cc.*, p.community_id FROM community_comments cc JOIN community_posts p ON p.id = cc.post_id WHERE cc.id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

async function deleteCommunityComment(id) {
  await pool.query("DELETE FROM community_comments WHERE id = $1", [id]);
}

async function listCommunityCommentsForCommunity(communityId) {
  const res = await pool.query(
    `SELECT cc.*, cm.joined_at AS author_member_since
     FROM community_comments cc
     JOIN community_posts cp ON cp.id = cc.post_id
     LEFT JOIN app_users u ON u.id = cc.author_user_id
     LEFT JOIN community_members cm ON cm.organization_id = u.organization_id AND cm.community_id = cp.community_id
     WHERE cp.community_id = $1
     ORDER BY cc.created_at ASC`,
    [communityId]
  );
  return res.rows;
}

// ON CONFLICT DO NOTHING (cakto_order_id UNIQUE): mesmo motivo dos outros
// dois sistemas de comissão — reenvio de webhook não pode gerar comissão
// em dobro pro mesmo pedido.
async function createCommunityCommission({
  communityId,
  organizationId,
  caktoOrderId,
  customerEmail,
  customerName,
  saleAmount,
  memberCountAtTime,
  tier,
  commissionPercentage,
  commissionValue,
}) {
  const res = await pool.query(
    `INSERT INTO community_commissions
       (community_id, organization_id, cakto_order_id, customer_email, customer_name, sale_amount, member_count_at_time, tier, commission_percentage, commission_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (cakto_order_id) DO NOTHING
     RETURNING *`,
    [communityId, organizationId, caktoOrderId, customerEmail, customerName || null, saleAmount, memberCountAtTime, tier, commissionPercentage, commissionValue]
  );
  return res.rows[0] || null;
}

async function listCommunityCommissions() {
  const res = await pool.query(`
    SELECT cc.*, c.name AS community_name, a.name AS ambassador_name, a.pix_key AS ambassador_pix_key
    FROM community_commissions cc
    JOIN communities c ON c.id = cc.community_id
    JOIN affiliates a ON a.id = c.affiliate_id
    ORDER BY cc.created_at DESC
  `);
  return res.rows;
}

async function markCommunityCommissionPaid(id, paid) {
  const res = await pool.query(
    "UPDATE community_commissions SET paid = $1, paid_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2 RETURNING *",
    [paid, id]
  );
  return res.rows[0] || null;
}

async function voidCommunityCommission(caktoOrderId) {
  const existing = await pool.query("SELECT * FROM community_commissions WHERE cakto_order_id = $1", [caktoOrderId]);
  const commission = existing.rows[0];
  if (!commission) return null;
  if (commission.paid) return commission;
  await pool.query("DELETE FROM community_commissions WHERE id = $1", [commission.id]);
  return commission;
}

// Visão geral pro admin (aba Comunidades): uma linha por comunidade
// existente, já com contagem de membros ativos e total pendente/pago —
// mesmo formato que Afiliados/Indicações já usam.
async function listCommunitiesAdminOverview() {
  // Mesmo ajuste de listCommunitiesDirectory acima (subquery à parte pra
  // não misturar communities.name e affiliates.name num GROUP BY só).
  const res = await pool.query(`
    SELECT c.id, c.affiliate_id, c.name AS community_name, c.photo_url, c.created_at,
      a.name AS ambassador_name, a.cakto_email AS ambassador_email, a.pix_key AS ambassador_pix_key,
      COALESCE(m.active_member_count, 0)::int AS active_member_count
    FROM communities c
    JOIN affiliates a ON a.id = c.affiliate_id
    LEFT JOIN (
      SELECT cm.community_id, SUM(CASE WHEN o.expires_at > now() THEN 1 ELSE 0 END) AS active_member_count
      FROM community_members cm
      JOIN organizations o ON o.id = cm.organization_id
      GROUP BY cm.community_id
    ) m ON m.community_id = c.id
    ORDER BY active_member_count DESC
  `);
  return res.rows;
}

function planLimitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.solo;
}

async function createOrganization({ name, plan, billingCycle, notes }) {
  const days = BILLING_CYCLE_DAYS[billingCycle];
  const res = await pool.query(
    `INSERT INTO organizations (name, plan, billing_cycle, expires_at, notes)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5) RETURNING *`,
    [name, plan, billingCycle, days, notes || null]
  );
  return res.rows[0];
}

// Mesmo formato de createOrganization, mas grava a referência da compra
// Cakto que originou essa organização (ver colunas cakto_* em migrate()) —
// é o que permite um evento de cancelamento/reembolso futuro achar essa
// organização de volta.
async function createOrganizationFromCakto({
  name,
  plan,
  billingCycle,
  notes,
  purchaseId,
  customerEmail,
  isTrial = false,
  expiresAt = null,
}) {
  // `expiresAt` explícito (teste grátis, ver cakto.js:handleSubscriptionCreated)
  // sobrepõe o cálculo padrão por billingCycle — o teste dura os dias que a
  // própria Cakto mandou no webhook (data.subscription.next_payment_date),
  // não o ciclo de cobrança que só vale depois de virar cliente de verdade.
  const days = BILLING_CYCLE_DAYS[billingCycle];
  const res = await pool.query(
    `INSERT INTO organizations (name, plan, billing_cycle, expires_at, notes, cakto_purchase_id, cakto_customer_email, is_trial)
     VALUES ($1, $2, $3, COALESCE($4, now() + ($5 || ' days')::interval), $6, $7, $8, $9) RETURNING *`,
    [name, plan, billingCycle, expiresAt, days, notes || null, purchaseId, customerEmail, isTrial]
  );
  return res.rows[0];
}

// upsert: retomar o passo 1 com o mesmo email (ex: fechou a aba e voltou
// depois) atualiza os dados em vez de duplicar — mas só se ainda não tiver
// completado o passo 2 (completed_at IS NULL). Se já completou, o UPDATE
// simplesmente não roda (WHERE barra) e quem chamou trata como "já existe
// conta" do mesmo jeito que já faz pra email repetido em app_users.
async function upsertAssinarLead({ name, email, passwordHash, phone, refCode }) {
  const res = await pool.query(
    `INSERT INTO assinar_leads (name, email, password_hash, phone, ref_code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, phone = EXCLUDED.phone,
           ref_code = COALESCE(EXCLUDED.ref_code, assinar_leads.ref_code), updated_at = now()
       WHERE assinar_leads.completed_at IS NULL
     RETURNING *`,
    [name, email.toLowerCase().trim(), passwordHash, phone, refCode || null]
  );
  return res.rows[0] || null; // null = email já tinha lead COMPLETO (WHERE do ON CONFLICT barrou)
}

async function getAssinarLeadByEmail(email) {
  const res = await pool.query("SELECT * FROM assinar_leads WHERE email = $1", [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

async function markAssinarLeadCompleted(email, organizationId, planKey) {
  await pool.query(
    "UPDATE assinar_leads SET completed_at = now(), organization_id = $1, plan_key = $2 WHERE email = $3",
    [organizationId, planKey, email.toLowerCase().trim()]
  );
}

// Admin (aba Usuários) — quem começou o passo 1 mas nunca completou o
// passo 2, pra equipe de suporte entrar em contato e ajudar a fechar.
async function listAbandonedAssinarLeads() {
  const res = await pool.query(
    "SELECT id, name, email, phone, plan_key, created_at, updated_at FROM assinar_leads WHERE completed_at IS NULL ORDER BY updated_at DESC"
  );
  return res.rows;
}

async function findOrganizationByCaktoPurchaseId(purchaseId) {
  const res = await pool.query("SELECT * FROM organizations WHERE cakto_purchase_id = $1", [purchaseId]);
  return res.rows[0] || null;
}

// Fallback pra quando o evento de cancelamento/reembolso não referencia o
// mesmo purchase_id da compra original (ex: é o ID da assinatura, não da
// transação) — busca pelo email do comprador. Mais de uma organização pode
// bater (ex: reembolso parcial num histórico antigo) — devolve a mais
// recente, quem chama decide se faz sentido.
async function findOrganizationByCaktoEmail(email) {
  const res = await pool.query(
    "SELECT * FROM organizations WHERE cakto_customer_email = $1 ORDER BY created_at DESC LIMIT 1",
    [email.toLowerCase().trim()]
  );
  return res.rows[0] || null;
}

// Idempotência: devolve true só na primeira vez que esse (purchase_id, event)
// é visto — reenvios da Cakto (retry automático dela) batem no
// ON CONFLICT DO NOTHING e voltam false, sinal pra quem chamou responder
// 200 sem reprocessar (criar organização/usuário duplicado).
async function recordCaktoEvent(purchaseId, event) {
  const res = await pool.query(
    `INSERT INTO cakto_events (purchase_id, event) VALUES ($1, $2)
     ON CONFLICT (purchase_id, event) DO NOTHING RETURNING purchase_id`,
    [purchaseId, event]
  );
  return res.rows.length > 0;
}

async function updateCaktoEventStatus(purchaseId, event, status, detail) {
  await pool.query(
    "UPDATE cakto_events SET status = $1, detail = $2 WHERE purchase_id = $3 AND event = $4",
    [status, detail || null, purchaseId, event]
  );
}

async function getOrganizationById(id) {
  const res = await pool.query("SELECT * FROM organizations WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function countUsersInOrg(organizationId) {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM app_users WHERE organization_id = $1", [
    organizationId,
  ]);
  return res.rows[0].n;
}

async function getOrgMemberIds(organizationId) {
  const res = await pool.query("SELECT id FROM app_users WHERE organization_id = $1", [organizationId]);
  return res.rows.map((r) => r.id);
}

async function listOrganizationsWithCounts() {
  const res = await pool.query(`
    SELECT o.*, COUNT(u.id)::int AS user_count,
      (SELECT a.name FROM affiliate_commissions c JOIN affiliates a ON a.id = c.affiliate_id
        WHERE c.customer_email = o.cakto_customer_email
        ORDER BY c.created_at ASC LIMIT 1) AS credited_affiliate_name
    FROM organizations o
    LEFT JOIN app_users u ON u.organization_id = o.id
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `);
  return res.rows;
}

// Renovar ANTES de vencer estende a partir da validade atual (não perde o
// tempo que ainda restava); renovar DEPOIS de vencer (relapso) conta a
// partir de agora (não empilha em cima de uma data já bem no passado).
// Também é o caminho usado pra trocar de plano — muda plano+ciclo junto,
// nunca separado, pra não deixar uma combinação plano-A/ciclo-B inconsistente.
async function renewOrganization(id, plan, billingCycle) {
  const org = await getOrganizationById(id);
  if (!org) return null;
  const days = BILLING_CYCLE_DAYS[billingCycle];
  const base = new Date(org.expires_at) > new Date() ? "expires_at" : "now()";
  // is_trial sempre vira false aqui — qualquer renovação bem sucedida quer
  // dizer que ou converteu de teste grátis pra cliente de verdade, ou já não
  // era teste (não custa nada zerar de novo nesse segundo caso).
  const res = await pool.query(
    `UPDATE organizations SET plan = $1, billing_cycle = $2, expires_at = ${base} + ($3 || ' days')::interval, is_trial = false
     WHERE id = $4 RETURNING *`,
    [plan, billingCycle, days, id]
  );
  return res.rows[0];
}

// Upgrade/downgrade de plano SEM mexer na validade — diferente de
// renewOrganization: usado quando o cliente já pagou a diferença fora do
// app (ex: upgrade no meio do ciclo) e não deve ganhar dias extras de
// brinde nem perder o que já pagou só porque trocou de plano.
async function changeOrganizationPlan(id, plan, billingCycle) {
  const res = await pool.query(
    `UPDATE organizations SET plan = $1, billing_cycle = $2 WHERE id = $3 RETURNING *`,
    [plan, billingCycle, id]
  );
  return res.rows[0];
}

// Escape-hatch manual — cortesia de renovação, correção, ou cancelamento
// antecipado (setar pro passado bloqueia o login na hora, mesmo sem
// cancelamento formal).
async function updateOrganizationExpiry(id, expiresAt) {
  const res = await pool.query("UPDATE organizations SET expires_at = $1 WHERE id = $2 RETURNING *", [
    expiresAt,
    id,
  ]);
  return res.rows[0];
}

// Exclui a organização. Só chega aqui depois do servidor confirmar que
// nenhum app_user aponta mais pra ela (ver checagem em server.js) — a
// própria coluna organization_id em app_users é REFERENCES organizations(id)
// sem ON DELETE, então o Postgres já recusaria sozinho se sobrasse algum
// usuário, mas o servidor confere ANTES pra devolver uma mensagem clara em
// vez de deixar estourar um erro de constraint cru pro admin.
async function deleteOrganization(id) {
  await pool.query("DELETE FROM organizations WHERE id = $1", [id]);
}

async function updateOrganizationDetails(id, { name, notes }) {
  const fields = [];
  const values = [];
  let i = 1;
  if (name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(name);
  }
  if (notes !== undefined) {
    fields.push(`notes = $${i++}`);
    values.push(notes);
  }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE organizations SET ${fields.join(", ")} WHERE id = $${i}`, values);
}

async function historySummaryForUser(appUserId) {
  const res = await pool.query(
    `SELECT domain, tool, COUNT(*)::int AS count, MAX(created_at) AS last_at
     FROM search_logs
     WHERE app_user_id = $1
     GROUP BY domain, tool
     ORDER BY count DESC, last_at DESC`,
    [appUserId]
  );
  return res.rows;
}

module.exports = {
  pool,
  PLAN_LIMITS,
  BILLING_CYCLE_DAYS,
  planLimitsFor,
  migrate,
  ensureMineradorDatabase,
  countUsers,
  countActiveAdmins,
  createUser,
  findUserByEmail,
  getAppUserById,
  touchLastSeen,
  listUsersWithCounts,
  updateUserPermissions,
  updateUserPassword,
  recordFailedLogin,
  resetFailedLogins,
  deleteUser,
  updateUserAvatar,
  updateUserName,
  logSearch,
  historySummaryForUser,
  logLogin,
  ipSummaryForUser,
  logAdminAction,
  listAdminAuditLog,
  listAffiliates,
  findAffiliateByCaktoEmail,
  createAffiliate,
  deleteAffiliate,
  createAffiliateCommission,
  listPaidCaktoOrganizations,
  listOrganizationsAttributedToAffiliate,
  renameCommunityChannel,
  correctUnpaidAffiliateCommission,
  setOrganizationAffiliate,
  attributeOrganizationToAffiliate,
  joinAffiliateReferredOrgsToCommunity,
  findAffiliateByRefCode,
  getAffiliateById,
  countAffiliateCommissionsForCustomer,
  listAffiliateCommissions,
  listAffiliateCommissionsForAffiliate,
  getAffiliateEarningsSummary,
  markAffiliateCommissionPaid,
  voidAffiliateCommission,
  upsertAffiliateTrialReferral,
  deleteAffiliateTrialReferral,
  listAffiliateTrialReferrals,
  listAllAffiliateTrialReferrals,
  getAffiliateTrialSummary,
  getReferralCouponByUserId,
  findReferralCouponByCode,
  createReferralCouponRequest,
  updateReferralCouponPix,
  updateReferralCouponWhatsapp,
  listReferralCoupons,
  activateReferralCoupon,
  createReferralCommission,
  listReferralCommissionsByUserId,
  listReferralCommissions,
  markReferralCommissionPaid,
  voidReferralCommission,
  getCommunityByAffiliateId,
  getCommunityById,
  createCommunity,
  updateCommunityDetails,
  listCommunityChannels,
  getCommunityChannelById,
  createCommunityChannel,
  deleteCommunityChannel,
  getCommunityMembershipByOrgId,
  joinCommunity,
  countActiveCommunityMembers,
  countActiveReferredCommunityMembers,
  listCommunitiesDirectory,
  getCommunityContentStats,
  listCommunityMembersDetailed,
  setCommunityMemberMuted,
  removeCommunityMember,
  listCommunityTopContributors,
  getCommunityEarningsSummary,
  listCommunityRecentActivity,
  toggleCommunityPostSave,
  getPollOptionsForChannel,
  createPollOptions,
  upsertCommunityPollVote,
  getCommunityPollVote,
  listScheduledCommunityPosts,
  publishCommunityPostNow,
  getCommunityResourceProgress,
  recordXpEvent,
  listCommunityXpLeaderboard,
  getUserXpTotal,
  listTopEngagedPosts,
  listTopCompletedResources,
  listCommunityRecentPosts,
  listCommunityAnnouncements,
  upsertCommunityResourceProgress,
  listCommunityResourcesWithProgress,
  createNotification,
  notifyCommunityMembers,
  listNotificationsForUser,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listCommunityResources,
  getCommunityResourceById,
  createCommunityResource,
  updateCommunityResource,
  deleteCommunityResource,
  createCommunityPost,
  listCommunityPostsByChannel,
  toggleCommunityPostLike,
  getCommunityPostById,
  updateCommunityPost,
  deleteCommunityPost,
  getCommunityCommentById,
  deleteCommunityComment,
  toggleCommunityPostPin,
  createCommunityComment,
  listCommunityCommentsForCommunity,
  createCommunityCommission,
  listCommunityCommissions,
  markCommunityCommissionPaid,
  voidCommunityCommission,
  listCommunitiesAdminOverview,
  createOrganization,
  createOrganizationFromCakto,
  findOrganizationByCaktoPurchaseId,
  findOrganizationByCaktoEmail,
  upsertAssinarLead,
  getAssinarLeadByEmail,
  markAssinarLeadCompleted,
  listAbandonedAssinarLeads,
  recordCaktoEvent,
  updateCaktoEventStatus,
  completePasswordSetup,
  getOrganizationById,
  countUsersInOrg,
  getOrgMemberIds,
  listOrganizationsWithCounts,
  renewOrganization,
  changeOrganizationPlan,
  setOrgDefaultOperationIfUnset,
  setOrgDefaultOperation,
  updateOrganizationExpiry,
  updateOrganizationDetails,
  deleteOrganization,
};
