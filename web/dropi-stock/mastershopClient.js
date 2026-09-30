// Cliente da Mastershop (catálogo "Mercado de Productos").
// O login tem Cloudflare Turnstile, então o robô NUNCA faz login: o Samuel
// entra no navegador (resolvendo o desafio como pessoa) e copia o cookie
// `ms_refresh_token` pro .env.local. A partir dele, o robô faz o mesmo que o
// próprio site faz a cada hora: POST account/refresh (email + cookie) e
// recebe access_token/id_token novos. Se o servidor devolver um refresh token
// novo (rotação), ele é salvo em .mastershop-session.local.json (gitignored)
// e passa a valer no lugar do que está no .env.local.
const fs = require("fs");
const path = require("path");

const API = "https://api-m.mastershop.com/prod/api/b2c/";
const SESSION_FILE = path.join(__dirname, ".mastershop-session.local.json");
const BROWSER_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://app.mastershop.com",
  referer: "https://app.mastershop.com/",
};

class MastershopSessionError extends Error {}

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeSession(data) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ ...readSession(), ...data, updatedAt: new Date().toISOString() }, null, 2));
}

function currentRefreshToken() {
  const envToken = (process.env.MASTERSHOP_REFRESH_TOKEN || "").trim();
  const saved = readSession();
  // Se o Samuel colou um token NOVO no .env.local (relogou), ele ganha do salvo.
  if (envToken && envToken !== saved.envTokenSeen) return envToken;
  return saved.refreshToken || envToken;
}

function jwtExp(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp * 1000;
  } catch {
    return null;
  }
}

async function refresh() {
  const email = (process.env.MASTERSHOP_EMAIL || "").trim();
  const refreshToken = currentRefreshToken();
  if (!email || !refreshToken) throw new MastershopSessionError("MASTERSHOP_EMAIL ou MASTERSHOP_REFRESH_TOKEN faltando no .env.local");

  const res = await fetch(`${API}account/refresh`, {
    method: "POST",
    headers: { ...BROWSER_HEADERS, "content-type": "application/json", cookie: `ms_refresh_token=${refreshToken}` },
    body: JSON.stringify({ email }),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new MastershopSessionError(`Sessão da Mastershop expirou (HTTP ${res.status}). Entre de novo no navegador e cole o ms_refresh_token novo.`);
  }
  if (!res.ok) throw new Error(`Refresh da Mastershop falhou (HTTP ${res.status}): ${text.slice(0, 200)}`);
  const data = JSON.parse(text).data || {};

  // Rotação: token novo pode vir no corpo ou no Set-Cookie.
  const setCookie = res.headers.get("set-cookie") || "";
  const rotated = data.refresh_token || (setCookie.match(/ms_refresh_token=([^;]+)/) || [])[1];
  writeSession({
    refreshToken: rotated || refreshToken,
    envTokenSeen: (process.env.MASTERSHOP_REFRESH_TOKEN || "").trim(),
    lastRefreshOk: new Date().toISOString(),
  });

  if (!data.access_token || !data.id_token) throw new Error("Refresh da Mastershop não devolveu os tokens esperados.");
  return { accessToken: data.access_token, idToken: data.id_token, expiresAt: jwtExp(data.access_token) || jwtExp(data.id_token) };
}

// Token novo vindo da extensão da ScoutX (o Samuel abriu a Mastershop logado no
// Chrome dele): passa a valer no lugar do .env.local, mas só depois de testado.
// Se não funcionar, volta o arquivo de sessão como estava.
async function adoptRefreshToken(token) {
  const before = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, "utf8") : null;
  writeSession({ refreshToken: token, envTokenSeen: (process.env.MASTERSHOP_REFRESH_TOKEN || "").trim() });
  try {
    const t = await refresh();
    writeSession({ adoptedFromExtensionAt: new Date().toISOString() });
    return { ok: true, expiresAt: t.expiresAt };
  } catch (err) {
    if (before === null) fs.rmSync(SESSION_FILE, { force: true });
    else fs.writeFileSync(SESSION_FILE, before);
    throw err;
  }
}

// Sessão que se renova sozinha antes de vencer (margem de 5 min).
function createSession() {
  let tokens = null;
  async function ensure() {
    if (!tokens || (tokens.expiresAt && tokens.expiresAt - Date.now() < 5 * 60 * 1000)) tokens = await refresh();
    return tokens;
  }
  async function request(apiPath, body, { retried = false, method = "POST" } = {}) {
    const t = await ensure();
    const res = await fetch(API + apiPath, {
      method,
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/json",
        authorization: `Bearer ${t.accessToken}`,
        "x-auth-id": t.idToken,
        "x-idbusiness": (process.env.MASTERSHOP_ID_BUSINESS || "").trim(),
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    if ((res.status === 401 || res.status === 403) && !retried) {
      tokens = null;
      return request(apiPath, body, { retried: true, method });
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Mastershop HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
  const get = (apiPath) => request(apiPath, null, { method: "GET" });
  return { request, get, ensure };
}

// Uma página do Mercado de Productos (todos os fornecedores).
async function marketPage(session, { offset = 0, limit = 200 } = {}) {
  const json = await session.request(`afiliation/market?offset=${offset}&limit=${limit}`, { useCache: true });
  const d = json.data;
  return Array.isArray(d) ? d : d?.products || [];
}

module.exports = { createSession, marketPage, refresh, adoptRefreshToken, MastershopSessionError };
