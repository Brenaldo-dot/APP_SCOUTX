// Cliente da API da Dropi, portado do droplatam-price-watch (src/services/dropi.js).
// A Dropi bloqueia chamadas feitas direto do servidor (WAF, "Access denied"),
// então TODA chamada sai de dentro de um Chromium de verdade via Playwright.
const { chromium } = require("playwright");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const COUNTRY_BY_CODE = { co: "COLOMBIA", mx: "MEXICO", ec: "ECUADOR", pe: "PERU", py: "PARAGUAY", cl: "CHILE" };

class DropiAuthError extends Error {}
class CaptchaRequiredError extends Error {}
class InvalidCredentialsError extends Error {}

// Código do país do domínio: "co.droplatam.com.br" -> "co" (white-label, país
// na frente) e "app.dropi.co" -> "co" (Dropi direto, país no fim).
function countryCode(domain) {
  const m = domain.match(/(?:^|\.)dropi\.([a-z]{2})$/);
  return m ? m[1] : domain.split(".")[0];
}

// -> "api.dropi.co" (padrão confirmado no droplatam pra co e mx).
function apiHostFromDomain(domain) {
  return `api.dropi.${countryCode(domain)}`;
}

function countryFromDomain(domain) {
  return COUNTRY_BY_CODE[countryCode(domain)] || "COLOMBIA";
}

function extractStoredToken(raw) {
  if (!raw) return null;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

// Abre UMA sessão de navegador na origem da Dropi e faz login com e-mail/senha.
// Se aparecer captcha, desiste (não tenta resolver) e lança CaptchaRequiredError.
// Devolve { request(path, { method, body }), close() } pra reaproveitar a mesma
// página em centenas de chamadas.
// No Windows o Chromium 1140 baixado pelo Playwright não abre ("configuração
// lado a lado incorreta"), então lá usa o Chrome instalado. DROPI_BROWSER_CHANNEL
// sobrescreve (ex: "msedge"); vazio no Linux = Chromium do Playwright.
function launchOptions() {
  const channel = process.env.DROPI_BROWSER_CHANNEL ?? (process.platform === "win32" ? "chrome" : "");
  return { headless: true, ...(channel ? { channel } : {}) };
}

async function openSession(domain, email, password) {
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(`https://${domain}/auth/login`, { waitUntil: "domcontentloaded" });

    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.locator("form button").first().click();

    const outcome = await page
      .waitForFunction(
        () => {
          if (!location.pathname.includes("/auth/login")) return "navigated";
          if (
            document.querySelector(
              'iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .h-captcha, .g-recaptcha'
            )
          )
            return "captcha";
          const bodyText = document.body.innerText || "";
          if (/incorrecta|incorrect|inválid|invalid|erro|error/i.test(bodyText)) return "error_text";
          return false;
        },
        { timeout: 15000, polling: 300 }
      )
      .then((h) => h.jsonValue())
      .catch(() => "timeout");

    if (outcome === "captcha") throw new CaptchaRequiredError("Captcha apareceu no login da Dropi, não tentei resolver.");
    if (outcome !== "navigated") throw new InvalidCredentialsError(`Login na Dropi não completou (${outcome}).`);

    const token = extractStoredToken(await page.evaluate(() => localStorage.getItem("DROPI_token")));
    if (!token) throw new Error("Login pareceu funcionar, mas não achei o token salvo.");

    const apiHost = apiHostFromDomain(domain);

    async function request(apiPath, { method = "GET", body } = {}) {
      const result = await page.evaluate(
        async ({ url, method, token, body }) => {
          const res = await fetch(url, {
            method,
            headers: {
              accept: "application/json, text/plain, */*",
              ...(body ? { "content-type": "application/json" } : {}),
              "x-authorization": `Bearer ${token}`,
              "x-captcha-token": "",
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: res.status, text: await res.text() };
        },
        { url: `https://${apiHost}${apiPath}`, method, token, body }
      );
      if (result.status === 401 || result.status === 403) {
        throw new DropiAuthError(`Token inválido/expirado (HTTP ${result.status})`);
      }
      try {
        return JSON.parse(result.text);
      } catch {
        throw new Error(`Resposta inesperada da Dropi (HTTP ${result.status})`);
      }
    }

    return { request, page, close: () => browser.close(), country: countryFromDomain(domain) };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// Uma página do catálogo geral (todos os fornecedores). Endpoint e campos vêm
// da engenharia reversa feita no droplatam; `get_stock: true` pede o estoque junto.
function searchCatalog(session, { keywords, startData = 0, pageSize = 50, extra = {} } = {}) {
  return session.request("/api/products/v4/index", {
    method: "POST",
    body: {
      pageSize,
      startData,
      privated_product: false,
      userVerified: false,
      favorite: false,
      with_collection: true,
      get_stock: true,
      no_count: false,
      search_type: "simple",
      country: session.country,
      ...(keywords ? { keywords } : {}),
      ...extra,
    },
  });
}

function getProduct(session, dropiId) {
  return session.request(`/api/products/productlist/v1/show/?id=${encodeURIComponent(dropiId)}`);
}

module.exports = {
  launchOptions,
  openSession,
  searchCatalog,
  getProduct,
  DropiAuthError,
  CaptchaRequiredError,
  InvalidCredentialsError,
};
