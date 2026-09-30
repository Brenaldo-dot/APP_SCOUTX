// Service worker da extensão: é o único ponto que fala com a ScoutX.
// O content script manda os IDs que viu na tela; aqui buscamos os números na
// API (com o login da ScoutX do próprio usuário, via cookie) e devolvemos.
// Nenhum cálculo é feito aqui: a extensão só MOSTRA o que a ScoutX devolve.

const DEFAULT_BASE = "http://localhost:3011";
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // "country:id" -> { at, data }

async function baseUrl() {
  const { scoutxUrl } = await chrome.storage.sync.get("scoutxUrl");
  return (scoutxUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

async function lookup(country, ids) {
  const base = await baseUrl();
  const now = Date.now();
  const result = {};
  const missing = [];
  for (const id of ids) {
    const hit = cache.get(`${country}:${id}`);
    if (hit && now - hit.at < CACHE_MS) {
      if (hit.data) result[id] = hit.data;
    } else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 150) {
    const chunk = missing.slice(i, i + 150);
    const res = await fetch(`${base}/api/radar/lookup?country=${encodeURIComponent(country)}&ids=${chunk.join(",")}`, {
      credentials: "include",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, base };
    if (!res.ok) return { ok: false, status: res.status, base };
    const { items } = await res.json();
    for (const id of chunk) {
      const data = items[id] || null;
      cache.set(`${country}:${id}`, { at: now, data });
      if (data) result[id] = data;
    }
  }
  return { ok: true, items: result, base };
}

async function status() {
  const base = await baseUrl();
  try {
    const res = await fetch(`${base}/api/me`, { credentials: "include" });
    if (res.status === 401) return { ok: false, reason: "login", base };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, base };
    const me = await res.json();
    return { ok: true, base, name: me.name || me.email || "", canUse: Boolean(me.isAdmin || me.canAccessMinerador), isAdmin: Boolean(me.isAdmin) };
  } catch {
    return { ok: false, reason: "offline", base };
  }
}

// ---------- renovação da sessão da Mastershop (só admin, chave no popup) ----------
// Quando o admin está logado na Mastershop neste Chrome, o cookie
// ms_refresh_token é entregue à ScoutX (só ao endereço configurado aqui), que
// testa e passa a usar. Desligado por padrão; a chave só aparece pra admin.
const MS_COOKIE = "ms_refresh_token";
const MS_URLS = ["https://api-m.mastershop.com/", "https://app.mastershop.com/"];

async function hashOf(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// O cookie pode estar preso a um caminho (ex.: só o endereço de renovação da
// API), então procura em todos os caminhos/subdomínios da Mastershop e fica
// com o mais novo (o que vence por último).
async function readMastershopToken() {
  const all = await chrome.cookies.getAll({ name: MS_COOKIE }).catch(() => []);
  const ours = all.filter((c) => c.value && /(^|\.)mastershop\.com$/.test(c.domain.replace(/^\./, "")));
  if (ours.length) {
    ours.sort((a, b) => (b.expirationDate || Infinity) - (a.expirationDate || Infinity));
    return ours[0].value;
  }
  for (const url of MS_URLS) {
    const c = await chrome.cookies.get({ url, name: MS_COOKIE }).catch(() => null);
    if (c?.value) return c.value;
  }
  return null;
}

let msSyncing = false;
async function syncMastershop({ force = false } = {}) {
  const { msSync } = await chrome.storage.local.get("msSync");
  if (!msSync || msSyncing) return { ok: false, reason: "off" };
  msSyncing = true;
  try {
    const token = await readMastershopToken();
    if (!token) return { ok: false, reason: "no-cookie" };
    const h = await hashOf(token);
    const { msLastHash } = await chrome.storage.local.get("msLastHash");
    if (!force && h === msLastHash) return { ok: true, reason: "same" };
    const base = await baseUrl();
    const res = await fetch(`${base}/api/radar/admin/mastershop-session`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json().catch(() => ({}));
    const result = { ok: res.ok && body.ok, at: new Date().toISOString(), status: res.status, error: body.error || null };
    await chrome.storage.local.set({ msLastSync: result, ...(result.ok ? { msLastHash: h } : {}) });
    return result;
  } catch (e) {
    const result = { ok: false, at: new Date().toISOString(), error: String(e).slice(0, 120) };
    await chrome.storage.local.set({ msLastSync: result });
    return result;
  } finally {
    msSyncing = false;
  }
}

// Cookie trocou (login novo / renovação): manda o novo.
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (!removed && cookie.name === MS_COOKIE && cookie.domain.includes("mastershop.com")) syncMastershop();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "msSeen") {
    syncMastershop().then(sendResponse);
    return true;
  }
  if (msg?.type === "msSyncNow") {
    syncMastershop({ force: true }).then(sendResponse);
    return true;
  }
  if (msg?.type === "lookup") {
    lookup(msg.country, msg.ids)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, status: 0, error: String(e) }));
    return true; // resposta assíncrona
  }
  if (msg?.type === "status") {
    status().then(sendResponse);
    return true;
  }
  if (msg?.type === "clearCache") {
    cache.clear();
    sendResponse({ ok: true });
  }
  return false;
});
