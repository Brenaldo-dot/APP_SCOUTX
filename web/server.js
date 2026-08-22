const express = require("express");
const path = require("path");
const dns = require("dns").promises;
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { analyzeStore, UnsupportedStoreError } = require("./shopify-spy");
const { sign, verify, parseCookies, serializeCookie } = require("./auth");
const db = require("./db");

const APP_BASE_URL = requireEnv("APP_BASE_URL");
const SESSION_SECRET = requireEnv("SESSION_SECRET");
// Revisão de segurança: o FastAPI (mega-minerador) confia cegamente nos
// headers X-User-Id/X-User-Is-Admin pra saber quem tá pedindo (não tem
// conexão com este banco de app_users — ver backend/app/api/deps.py). Até
// agora a única proteção era o serviço não ter domínio público — o que se
// mostrou frágil (bastou 1 comando de diagnóstico pra criar um domínio sem
// querer). Esse segredo compartilhado é a segunda camada: mesmo que o
// FastAPI volte a ficar acessível de fora por engano, ninguém de fora
// consegue forjar identidade sem conhecer ele também.
const INTERNAL_API_SECRET = requireEnv("INTERNAL_API_SECRET");
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 dias — ferramenta interna de time

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Variável de ambiente obrigatória não configurada: ${name}`);
    process.exit(1);
  }
  return value;
}

function normalizeShopifyProductUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error("URL inválida");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("URL inválida");
  }
  if (!/\/products\//.test(url.pathname)) {
    throw new Error("A URL não parece ser de um produto (esperado .../products/...)");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\.json$/, "") + ".json";
  return url.toString();
}

// Revisão de segurança: achado num teste de invasão. Buscar Fornecedor e
// Espionar Loja fazem o SERVIDOR buscar a URL que a pessoa cola — sem essa
// checagem, qualquer usuário logado (não precisa ser admin) conseguia
// colar um endereço interno (localhost, IP privado, *.railway.internal) e
// usar o app como ponte pra sondar a rede interna da infraestrutura
// (SSRF). Resolve o hostname de verdade e bloqueia qualquer IP que caia
// numa faixa privada/reservada/loopback, nas duas versões (v4 e v6).
function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const PRIVATE_IPV4_RANGES = [
  ["0.0.0.0", 8], // "esta rede"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — inclui o metadata de nuvem 169.254.169.254
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // reservado IETF
  ["192.0.2.0", 24], // documentação (TEST-NET-1)
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentação (TEST-NET-2)
  ["203.0.113.0", 24], // documentação (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado
];

function isPrivateIPv4(ip) {
  const n = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIPv6(ip) {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(v)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return true; // fc00::/7 unique local
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]); // IPv4-mapped IPv6
  return false;
}

async function assertPublicHost(hostname) {
  const host = String(hostname).toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".railway.internal")
  ) {
    throw new Error("Esse endereço não pode ser consultado.");
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Não foi possível resolver esse endereço.");
  }
  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) {
      throw new Error("Esse endereço não pode ser consultado.");
    }
  }
}

// Revisão de segurança: o bloqueio por CONTA (db.js:recordFailedLogin)
// protege contra "tentar várias senhas na MESMA conta", mas não contra
// "tentar 1 senha em VÁRIAS contas" (password spraying) — cada conta só
// vê 1 tentativa isolada, nunca bate o limite. Esse aqui é por IP,
// independente de qual email foi tentado. Em memória (não sobrevive a
// restart, não sincroniza entre múltiplas instâncias) — suficiente pro
// tamanho desse app hoje; se um dia escalar pra várias instâncias, precisa
// virar Redis.
const IP_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const IP_ATTEMPT_LIMIT = 15;
const IP_BLOCK_MS = 15 * 60 * 1000;
const ipLoginFailures = new Map();

function checkIpLoginLimit(ip) {
  const entry = ipLoginFailures.get(ip);
  if (entry && entry.blockedUntil && entry.blockedUntil > Date.now()) {
    return { blocked: true, retryAfterMinutes: Math.ceil((entry.blockedUntil - Date.now()) / 60000) };
  }
  return { blocked: false };
}

function recordIpLoginFailure(ip) {
  const now = Date.now();
  let entry = ipLoginFailures.get(ip);
  if (!entry || now - entry.windowStart > IP_ATTEMPT_WINDOW_MS) {
    entry = { count: 0, windowStart: now, blockedUntil: null };
  }
  entry.count += 1;
  if (entry.count >= IP_ATTEMPT_LIMIT) {
    entry.blockedUntil = now + IP_BLOCK_MS;
  }
  ipLoginFailures.set(ip, entry);
}

function resetIpLoginFailures(ip) {
  ipLoginFailures.delete(ip);
}

// Limpeza periódica — sem isso o Map só cresce (1 entrada por IP que já
// tentou logar errado alguma vez).
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipLoginFailures) {
    const stillBlocked = entry.blockedUntil && entry.blockedUntil > now;
    const windowActive = now - entry.windowStart <= IP_ATTEMPT_WINDOW_MS;
    if (!stillBlocked && !windowActive) ipLoginFailures.delete(ip);
  }
}, 30 * 60 * 1000).unref();

// Revisão de segurança: checa a senha nova contra o banco público de senhas
// já vazadas (Have I Been Pwned, modelo k-Anonymity) — protege contra
// "credencial reusada", uma das formas mais comuns de conta ser invadida
// sem precisar quebrar nada, só reaproveitando senha que já vazou em OUTRO
// site. Manda só os 5 primeiros caracteres do hash SHA-1 pra API — a senha
// em si, e até o hash completo, nunca saem daqui. Falha ABERTA (não
// bloqueia troca de senha) se a API estiver fora do ar ou lenta: é
// ferramenta interna de time, não vale travar o acesso de alguém por causa
// de uma dependência externa instável.
async function isPasswordPwned(password) {
  const hash = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "ScoutX-PasswordCheck" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const text = await response.text();
    return text.split("\n").some((line) => line.split(":")[0].trim() === suffix);
  } catch {
    return false;
  }
}

function extractDomain(raw) {
  try {
    return new URL(String(raw).trim()).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function looksLikeId(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v === "") return false;
  if (/\s/.test(v)) return false;
  if (/^-?\d{1,2}$/.test(v)) return false;
  return true;
}

function extractBarcode(payload) {
  const product = payload && payload.product;
  const variants = product && product.variants;
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const productTitle = typeof product.title === "string" ? product.title : undefined;
  for (const v of variants) {
    if (looksLikeId(v.barcode)) return { value: v.barcode.trim(), source: "barcode", productTitle };
  }
  for (const v of variants) {
    if (looksLikeId(v.sku)) return { value: v.sku.trim(), source: "sku", productTitle };
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function authPage({ title, subtitle, action, error, showNameField }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScoutX</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, sans-serif; background: #0a0c12; color: #f3f4f6;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;
    position: relative; overflow: hidden;
  }
  /* Glow radial no canto — mesma linguagem visual da referência (canto
     superior esquerdo, bem vívido), azul em vez de roxo. */
  body::before {
    content: ""; position: absolute; top: -15%; left: -10%;
    width: 620px; height: 620px; border-radius: 999px;
    background: radial-gradient(circle, rgba(59,130,246,0.38) 0%, rgba(59,130,246,0) 70%);
    pointer-events: none;
  }
  .card {
    position: relative; background: #12141e; border: 1px solid #262a3d; padding: 32px;
    border-radius: 16px; width: 340px; box-shadow: 0 20px 60px rgba(0,0,0,0.45);
  }
  .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 22px; }
  .brand .dot {
    width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
    background: linear-gradient(135deg, #2563eb, #60a5fa);
    box-shadow: 0 4px 14px rgba(37,99,235,0.4);
  }
  .brand span { font-weight: 700; font-size: 16px; }
  h1 { font-size: 19px; margin: 0 0 6px; }
  p.subtitle { color: #9ca3af; font-size: 13px; margin: 0 0 22px; }
  label { display: block; font-size: 13px; color: #d1d5db; margin: 0 0 5px; }
  input {
    width: 100%; padding: 11px 13px; margin-bottom: 16px; border-radius: 8px;
    border: 1px solid #262a3d; background: #0a0c12; color: #f3f4f6; font-size: 14px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  input:focus {
    outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.25);
  }
  button {
    width: 100%; padding: 13px; border-radius: 9999px; border: none;
    background: linear-gradient(90deg, #1d4ed8 0%, #3b82f6 55%, #7dd3fc 100%);
    color: #fff; font-weight: 600; font-size: 14px;
    cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 6px 24px rgba(59,130,246,0.45);
    transition: filter 0.15s, box-shadow 0.15s;
  }
  button:hover { filter: brightness(1.06); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 30px rgba(59,130,246,0.6); }
  .error {
    background: rgba(127,29,29,0.25); color: #f87171; border: 1px solid #7f1d1d;
    padding: 9px 11px; border-radius: 8px; font-size: 13px; margin-bottom: 16px;
  }
</style></head>
<body>
<div class="card">
  <div class="brand"><span class="dot"></span><span>ScoutX</span></div>
  <form method="POST" action="${action}">
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(subtitle)}</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    ${showNameField ? `<label for="name">Nome</label><input type="text" id="name" name="name" required autofocus maxlength="80">` : ""}
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required ${showNameField ? "" : "autofocus"} maxlength="200">
    <label for="password">Senha</label>
    <input type="password" id="password" name="password" required minlength="8">
    <button type="submit">${showNameField ? "Criar conta de administrador" : "Entrar"}</button>
  </form>
</div>
</body></html>`;
}

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Revisão de segurança: nenhum header de proteção do navegador vinha
  // configurado antes (achado no teste de invasão) — sem eles o app fica
  // mais exposto a clickjacking (carregar o ScoutX escondido dentro de um
  // iframe de outro site) e a downgrade de HTTPS. CSP liberado o suficiente
  // pra não quebrar nada: imagem de produto/favicon vem de domínio de
  // concorrente (arbitrário) e do Google, por isso img-src aceita qualquer
  // https; o resto (script, estilo do bundle, conexão de API) é tudo
  // same-origin, só a tela de login/setup tem <style> inline mesmo.
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
    next();
  });

  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  const isHttps = APP_BASE_URL.startsWith("https://");

  function setSessionCookie(res, appUserId) {
    const session = sign({ appUserId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }, SESSION_SECRET);
    res.setHeader("Set-Cookie", serializeCookie("session", session, { maxAge: SESSION_TTL_SECONDS, secure: isHttps }));
  }

  // ---------- Setup inicial (cria o primeiro admin, só funciona se não houver ninguém ainda) ----------

  app.get("/setup", async (req, res) => {
    const n = await db.countUsers();
    if (n > 0) return res.redirect("/login");
    res.send(
      authPage({
        title: "Criar conta de administrador",
        subtitle: "Primeira vez usando essa ferramenta — crie a conta principal.",
        action: "/setup",
        showNameField: true,
      })
    );
  });

  app.post("/setup", async (req, res) => {
    const n = await db.countUsers();
    if (n > 0) return res.redirect("/login");

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    if (!name || !email || password.length < 8) {
      return res.status(400).send(
        authPage({
          title: "Criar conta de administrador",
          subtitle: "Primeira vez usando essa ferramenta — crie a conta principal.",
          action: "/setup",
          showNameField: true,
          error: "Preencha nome, email e uma senha com pelo menos 8 caracteres.",
        })
      );
    }
    if (await isPasswordPwned(password)) {
      return res.status(400).send(
        authPage({
          title: "Criar conta de administrador",
          subtitle: "Primeira vez usando essa ferramenta — crie a conta principal.",
          action: "/setup",
          showNameField: true,
          error: "Essa senha já apareceu em vazamentos conhecidos — escolha outra.",
        })
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.createUser({ name, email, passwordHash, role: "admin" });
    db.logLogin(user.id, req.ip).catch((e) => console.error("log login:", e));
    setSessionCookie(res, user.id);
    res.redirect("/");
  });

  // ---------- Login ----------

  app.get("/login", async (req, res) => {
    const n = await db.countUsers();
    if (n === 0) return res.redirect("/setup");
    res.send(authPage({ title: "ScoutX", subtitle: "Entre com seu email e senha.", action: "/login" }));
  });

  // Minutos arredondados pra cima — "bloqueado por 4 minutos" é melhor que
  // "3.2 minutos" (a pessoa não vai cronometrar o segundo exato mesmo).
  function minutesLeft(lockedUntil) {
    return Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000));
  }

  const PERMANENT_LOCK_MESSAGE = "Conta bloqueada por excesso de tentativas — peça pra um administrador redefinir sua senha (aba Usuários → 🔑 Senha).";

  app.post("/login", async (req, res) => {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");

    const ipLimit = checkIpLoginLimit(req.ip);
    if (ipLimit.blocked) {
      return res.status(429).send(
        authPage({
          title: "ScoutX",
          subtitle: "Entre com seu email e senha.",
          action: "/login",
          error: `Muitas tentativas de login vindas daqui — tenta de novo em ${ipLimit.retryAfterMinutes} min.`,
        })
      );
    }

    const user = await db.findUserByEmail(email);

    // Bloqueio ativo: nem chega a checar a senha — não consome tentativa
    // nova (senão as "2 tentativas a mais"/"1 tentativa a mais" prometidas
    // pro usuário nunca sobrariam) e não dá pra "esperar" tentando de novo.
    if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
      const permanent = new Date(user.locked_until).getUTCFullYear() >= 9000;
      const error = permanent
        ? PERMANENT_LOCK_MESSAGE
        : `Muitas tentativas erradas — tenta de novo em ${minutesLeft(user.locked_until)} min.`;
      return res.status(423).send(
        authPage({ title: "ScoutX", subtitle: "Entre com seu email e senha.", action: "/login", error })
      );
    }

    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !valid) {
      recordIpLoginFailure(req.ip);
      let error = "Email ou senha inválidos.";
      if (user) {
        const { lockedUntil, permanent } = await db.recordFailedLogin(user.id);
        if (permanent) error = PERMANENT_LOCK_MESSAGE;
        else if (lockedUntil) error = `Muitas tentativas erradas — conta bloqueada por ${minutesLeft(lockedUntil)} min.`;
      }
      return res.status(401).send(
        authPage({ title: "ScoutX", subtitle: "Entre com seu email e senha.", action: "/login", error })
      );
    }

    resetIpLoginFailures(req.ip);
    await db.resetFailedLogins(user.id);
    db.logLogin(user.id, req.ip).catch((e) => console.error("log login:", e));
    setSessionCookie(res, user.id);
    res.redirect("/");
  });

  app.get("/logout", (req, res) => {
    res.setHeader("Set-Cookie", serializeCookie("session", "", { maxAge: 0, secure: isHttps }));
    res.redirect("/login");
  });

  async function requireAuth(req, res, next) {
    const n = await db.countUsers();
    if (n === 0 && req.path !== "/setup") return res.redirect("/setup");

    const session = verify(req.cookies.session, SESSION_SECRET);
    if (!session) {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "Sessão expirada, faça login de novo." });
      }
      return res.redirect("/login");
    }

    const appUser = await db.getAppUserById(session.appUserId);
    if (!appUser) {
      res.setHeader("Set-Cookie", serializeCookie("session", "", { maxAge: 0, secure: isHttps }));
      return res.redirect("/login");
    }

    req.appUser = appUser;
    next();
  }

  app.use(requireAuth);

  // ---------- Identidade / permissões pro frontend ----------

  app.get("/api/me", (req, res) => {
    res.json({
      name: req.appUser.name,
      email: req.appUser.email,
      role: req.appUser.role,
      isAdmin: req.appUser.role === "admin",
      canViewHistory: req.appUser.role === "admin" || req.appUser.can_view_history,
      canAccessMinerador: req.appUser.role === "admin" || req.appUser.can_access_minerador,
    });
  });

  // Autoatendimento — troca a PRÓPRIA senha (exige a senha atual, diferente
  // do reset de admin em /api/admin/users/:id que não pede, já que é o
  // próprio dono da conta confirmando que é ele mesmo).
  app.patch("/api/me/password", async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Informe a senha atual e a nova senha." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "A nova senha precisa ter no mínimo 8 caracteres." });
    }
    const valid = await bcrypt.compare(currentPassword, req.appUser.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    if (await isPasswordPwned(newPassword)) {
      return res.status(400).json({ error: "Essa senha já apareceu em vazamentos conhecidos — escolha outra." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.updateUserPassword(req.appUser.id, passwordHash);
    res.json({ ok: true });
  });

  // ---------- Administração de usuários (admin only) ----------

  function requireAdmin(req, res, next) {
    if (req.appUser.role !== "admin") return res.status(403).json({ error: "Só administradores podem acessar isso." });
    next();
  }

  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    const users = await db.listUsersWithCounts();
    res.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        canViewHistory: u.can_view_history,
        canAccessMinerador: u.can_access_minerador,
        searchCount: u.search_count,
        ipCount: u.ip_count,
        lastIp: u.last_ip,
        lastLoginAt: u.last_login_at,
        allIps: u.all_ips || [],
        createdAt: u.created_at,
        failedLoginAttempts: u.failed_login_attempts,
        lockedUntil:
          u.locked_until && new Date(u.locked_until) > new Date() ? u.locked_until : null,
        lockedPermanently: u.locked_until && new Date(u.locked_until).getUTCFullYear() >= 9000,
      }))
    );
  });

  app.get("/api/admin/users/:id/ips", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id inválido" });
    const rows = await db.ipSummaryForUser(id);
    res.json(rows.map((r) => ({ ip: r.ip, count: r.count, firstAt: r.first_at, lastAt: r.last_at })));
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ error: "name, email e password (mín. 8 caracteres) são obrigatórios" });
    }
    if (role !== undefined && role !== "admin" && role !== "collaborator") {
      return res.status(400).json({ error: "role deve ser 'admin' ou 'collaborator'" });
    }

    const existing = await db.findUserByEmail(email);
    if (existing) return res.status(409).json({ error: "Já existe um usuário com esse email." });
    if (await isPasswordPwned(password)) {
      return res.status(400).json({ error: "Essa senha já apareceu em vazamentos conhecidos — escolha outra." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.createUser({ name, email, passwordHash, role: role || "collaborator" });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id inválido" });

    const { role, canViewHistory, canAccessMinerador, password } = req.body || {};
    if (role !== undefined && role !== "admin" && role !== "collaborator") {
      return res.status(400).json({ error: "role deve ser 'admin' ou 'collaborator'" });
    }
    if (password !== undefined && password.length < 8) {
      return res.status(400).json({ error: "A senha precisa ter no mínimo 8 caracteres." });
    }
    if (password !== undefined && (await isPasswordPwned(password))) {
      return res.status(400).json({ error: "Essa senha já apareceu em vazamentos conhecidos — escolha outra." });
    }

    await db.updateUserPermissions(id, {
      role,
      canViewHistory: typeof canViewHistory === "boolean" ? canViewHistory : undefined,
      canAccessMinerador: typeof canAccessMinerador === "boolean" ? canAccessMinerador : undefined,
    });
    // Senha muda em query separada (updateUserPermissions só monta SET pros
    // 3 campos de permissão) — admin resetando a senha de outra pessoa, ex:
    // usuário esqueceu ou perdeu acesso ao email cadastrado.
    if (password !== undefined) {
      const passwordHash = await bcrypt.hash(password, 10);
      await db.updateUserPassword(id, passwordHash);
    }
    res.json({ ok: true });
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id inválido" });
    if (id === req.appUser.id) return res.status(400).json({ error: "Você não pode remover sua própria conta." });
    await db.deleteUser(id);
    res.json({ ok: true });
  });

  // ---------- Histórico de buscas (admin, ou quem tiver permissão) ----------

  function requireHistoryAccess(req, res, next) {
    if (req.appUser.role !== "admin" && !req.appUser.can_view_history) {
      return res.status(403).json({ error: "Você não tem permissão para ver o histórico." });
    }
    next();
  }

  app.get("/api/history", requireHistoryAccess, async (req, res) => {
    const users = await db.listUsersWithCounts();
    res.json(users.map((u) => ({ id: u.id, name: u.name, searchCount: u.search_count })));
  });

  app.get("/api/history/:userId", requireHistoryAccess, async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "userId inválido" });
    const rows = await db.historySummaryForUser(userId);
    res.json(rows.map((r) => ({ domain: r.domain, tool: r.tool, count: r.count, lastAt: r.last_at })));
  });

  // ---------- Mega Minerador (admin, ou quem tiver permissão) ----------

  const MINERADOR_API_URL = process.env.MINERADOR_API_URL;
  const mineradorPublicDir = path.join(__dirname, "public-minerador");

  function requireMineradorAccess(req, res, next) {
    if (req.appUser.role !== "admin" && !req.appUser.can_access_minerador) {
      if (req.path.startsWith("/api/")) {
        return res.status(403).json({ error: "Você não tem permissão para acessar o Minerador." });
      }
      return res.status(403).send("Você não tem permissão para acessar essa área.");
    }
    next();
  }

  app.all("/api/minerador/*", requireMineradorAccess, async (req, res) => {
    if (!MINERADOR_API_URL) {
      return res.status(503).json({ error: "Minerador ainda não está configurado neste ambiente." });
    }
    // O front-end do Minerador monta suas próprias URLs já com "/api/..."
    // (ex: request('/api/dashboard/summary')), então só removemos o prefixo
    // "/api/minerador" e sobra exatamente a rota que o FastAPI espera.
    const targetPath = req.originalUrl.replace(/^\/api\/minerador/, "") || "/";
    const targetUrl = `${MINERADOR_API_URL.replace(/\/+$/, "")}${targetPath}`;
    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          // Multi-tenant: o FastAPI não tem conexão com este banco (onde
          // mora app_users), então a identidade de quem está pedindo só
          // chega assim — ver backend/app/api/deps.py. Mesmo modelo de
          // confiança que já existia (rede interna do Railway, serviço sem
          // domínio público), só que agora explícito por usuário.
          "X-User-Id": String(req.appUser.id),
          "X-User-Is-Admin": req.appUser.role === "admin" ? "true" : "false",
          "X-Internal-Secret": INTERNAL_API_SECRET,
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      });
      const data = await upstream.text();
      res.status(upstream.status);
      res.set("Content-Type", upstream.headers.get("content-type") || "application/json");
      res.send(data);
    } catch (err) {
      console.error("erro no proxy do minerador:", err);
      res.status(502).json({ error: "Não foi possível contatar o serviço do Minerador." });
    }
  });

  // Fusão dos apps: o ScoutX (React) virou o app inteiro, servido na raiz —
  // antes vivia em /minerador, com o app antigo "Buscar Barcode Shopify" na
  // raiz. requireMineradorAccess NÃO entra aqui de propósito: ele só protege
  // dado de verdade (o proxy /api/minerador/* abaixo, intacto), porque nem
  // toda tela do app novo precisa dessa permissão — Buscar Barcode/Espionar
  // Loja sempre foram liberados pra qualquer usuário logado, e agora moram
  // dentro desse mesmo React (RouteGuard no frontend cuida de esconder/
  // bloquear as telas do ScoutX em si pra quem não tem canAccessMinerador).
  app.use(express.static(mineradorPublicDir));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(mineradorPublicDir, "index.html"), (err) => {
      if (err) res.status(503).send("ScoutX ainda não está disponível neste ambiente.");
    });
  });

  // ---------- Rotas da ferramenta (mesmas do app desktop) ----------

  app.get("/api/buscar", async (req, res) => {
    const raw = req.query.url;
    if (!raw) {
      return res.status(400).json({ error: "Parâmetro 'url' é obrigatório" });
    }

    const domain = extractDomain(raw);
    if (domain) {
      db.logSearch(req.appUser.id, "barcode", domain, String(raw)).catch((e) => console.error("log search:", e));
    }

    let jsonUrl;
    try {
      jsonUrl = normalizeShopifyProductUrl(raw);
    } catch (err) {
      return res.status(400).json({ error: err.message || "URL inválida" });
    }

    try {
      await assertPublicHost(new URL(jsonUrl).hostname);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let response;
    try {
      response = await fetch(jsonUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; BuscarBarcodeShopify/1.0)",
        },
      });
    } catch {
      return res.status(502).json({ error: "Não foi possível conectar à loja" });
    }

    if (response.status === 404) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }
    if (!response.ok) {
      return res.status(502).json({ error: "Loja não suportada" });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return res.status(502).json({ error: "Loja não suportada" });
    }

    const result = extractBarcode(payload);
    if (!result) {
      return res.status(404).json({ error: "Código de barras não encontrado para este produto" });
    }

    res.json({ jsonUrl, ...result });
  });

  app.get("/api/spy", async (req, res) => {
    const raw = req.query.url;
    if (!raw) {
      return res.status(400).json({ error: "Parâmetro 'url' é obrigatório" });
    }

    const domain = extractDomain(raw);
    if (domain) {
      db.logSearch(req.appUser.id, "spy", domain, String(raw)).catch((e) => console.error("log search:", e));
    }

    if (!domain) {
      return res.status(400).json({ error: "URL inválida" });
    }
    try {
      await assertPublicHost(domain);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const result = await analyzeStore(raw);
      res.json(result);
    } catch (err) {
      if (err instanceof UnsupportedStoreError) {
        return res.status(400).json({ error: err.message });
      }
      console.error(err);
      res.status(502).json({ error: "Não foi possível analisar esta loja" });
    }
  });

  return app;
}

function startServer(port = process.env.PORT || 3001) {
  return new Promise((resolve, reject) => {
    db.migrate()
      .then(() => db.ensureMineradorDatabase())
      .then(() => {
        const app = createApp();
        const server = app.listen(port, () => resolve({ port: server.address().port, server }));
        server.on("error", reject);
      })
      .catch(reject);
  });
}

module.exports = { startServer, createApp };

if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`ScoutX (web) rodando em http://localhost:${port}`);
  });
}
