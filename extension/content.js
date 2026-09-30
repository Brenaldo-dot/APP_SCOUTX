// Content script: roda dentro do catálogo da DropLatam, da Dropi e da Mastershop.
// Acha o ID de cada produto na tela, pede os números pra ScoutX (via
// background.js) e coloca um selo no card. Não calcula nada.
(() => {
  const host = location.hostname;
  // Dropi e DropLatam: mesmo site (a DropLatam é a Dropi com outra marca).
  // <país>.droplatam.com.br -> "<país>"; app.dropi.<país> -> "dp-<país>".
  const dl = host.match(/^([a-z]{2})\.droplatam\.com\.br$/);
  const dp = host.match(/^app\.dropi\.([a-z]{2})$/);
  // A DropLatam Espanha é outro sistema: cards com data-id, dados em "dl-es".
  const PLATFORM = host === "es.droplatam.com.br"
    ? { country: "dl-es", name: "DropLatam", dataIdSite: true }
    : dl
    ? { country: dl[1], name: "DropLatam", dropiSite: true }
    : dp
      ? { country: `dp-${dp[1]}`, name: "Dropi", dropiSite: true }
      : { country: "ms-co", name: "Mastershop", dropiSite: false };
  const num = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
  const fmt = (n) => (n >= 10000 ? num.format(n) : new Intl.NumberFormat("pt-BR").format(n));

  let scoutxBase = null;
  let authWarned = false;
  const known = new Map(); // id -> dados (ou null = sem dados)

  // ---------- onde está o ID em cada plataforma ----------
  // DropLatam: o card não mostra o ID em texto, mas a foto é .../products/<ID>/...
  function findDropiCards() {
    const out = [];
    for (const img of document.querySelectorAll('img[src*="/products/"]')) {
      const m = img.src.match(/\/products\/(\d{1,12})\//);
      if (!m) continue;
      const card = img.closest(".card-box") || img.closest("app-card-product, app-product-card") || img.parentElement?.parentElement;
      if (card) out.push({ id: m[1], card, anchor: img.closest(".box-img, .card-image-into") || img.parentElement });
    }
    return out;
  }

  // Mastershop: o card mostra "ID: 188046" em texto.
  function findMastershopCards() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const m = node.nodeValue.match(/\bID:?\s*#?(\d{3,12})\b/);
      if (!m) continue;
      let card = node.parentElement;
      for (let i = 0; i < 8 && card && !card.querySelector("img"); i++) card = card.parentElement;
      if (!card || card === document.body) continue;
      const img = card.querySelector("img");
      out.push({ id: m[1], card, anchor: img ? img.parentElement : card });
    }
    return out;
  }

  // Página de detalhe de um produto (widget flutuante).
  // DropLatam Espanha: o card é um <a class="btn_view_product" data-id="123">.
  function findDataIdCards() {
    return [...document.querySelectorAll("a.btn_view_product[data-id]")]
      .filter((a) => /^\d+$/.test(a.dataset.id))
      .map((a) => {
        const img = a.querySelector("img");
        return { id: a.dataset.id, card: a, anchor: img ? img.parentElement : a };
      });
  }

  function detailId() {
    if (PLATFORM.dataIdSite) return null; // lá o produto abre numa janelinha, sem página própria
    const m =
      PLATFORM.dropiSite
        ? location.pathname.match(/product-details\/(\d{1,12})/)
        : location.pathname.match(/products\/market\/(\d{3,12})/);
    return m ? m[1] : null;
  }

  // ---------- selos ----------
  function badgeHtml(d) {
    const hot = d.hot ? '<span class="scoutx-hot">🔥 Em alta</span>' : "";
    const empty = !d.sold1d && !d.sold7d;
    return `
      <span class="scoutx-logo"></span>
      ${hot}
      ${
        empty
          ? '<span class="scoutx-muted">Sem vendas nos últimos 7 dias</span>'
          : `<span class="scoutx-metric"><b>${fmt(d.sold1d)}</b> 24h</span><span class="scoutx-sep"></span><span class="scoutx-metric"><b>${fmt(d.sold7d)}</b> 7d</span>`
      }`;
  }

  function openAnalysis(d) {
    if (!scoutxBase) return;
    window.open(`${scoutxBase}/radar-vendas?plataforma=${PLATFORM.country}&produto=${d.id}`, "_blank", "noopener");
  }

  // ---------- painel completo (padrão) ----------
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const STATUS = {
    em_alta: ["🔥", "Em alta", "hot"],
    subindo: ["📈", "Subindo", "up"],
    estavel: ["➖", "Estável", "flat"],
    vendendo: ["🛒", "Vendendo", "flat"],
    caindo: ["📉", "Caindo", "down"],
    parado: ["💤", "Sem vendas", "idle"],
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function money(n) {
    if (n === null || n === undefined) return "–";
    if (n >= 1e9) return `$ ${(n / 1e9).toFixed(1).replace(".", ",")} bi`;
    if (n >= 1e6) return `$ ${(n / 1e6).toFixed(1).replace(".", ",")} mi`;
    if (n >= 1e3) return `$ ${Math.round(n / 1e3)} mil`;
    return `$ ${Math.round(n)}`;
  }

  function listedText(d) {
    if (!d.listedAt) return null;
    const t = new Date(d.listedAt);
    const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
    if (d.listedPrecision === "day") {
      const when = `${String(t.getDate()).padStart(2, "0")}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getFullYear()).slice(2)}`;
      return { when, ago: days === 0 ? "hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`, fresh: days <= 14 };
    }
    const months = Math.round(days / 30.4);
    const ago = months < 1 ? "há menos de 1 mês" : months < 12 ? `há ~${months} ${months === 1 ? "mês" : "meses"}` : `há ~${Math.floor(months / 12)} ${months < 24 ? "ano" : "anos"}`;
    return { when: `${MONTHS[t.getMonth()]}/${t.getFullYear()}`, ago, fresh: false };
  }

  function barsHtml(days7) {
    if (!days7 || !days7.length) return "";
    const max = Math.max(1, ...days7);
    return `<div class="sx-bars" title="Vendas dos últimos 7 dias">${days7
      .map((n, i) => {
        const h = n > 0 ? Math.max(12, Math.round((n / max) * 100)) : 4;
        return `<span class="sx-bar${i === days7.length - 1 ? " is-last" : ""}" style="height:${h}%" title="${n} vendas"></span>`;
      })
      .join("")}</div>`;
  }

  function panelHtml(d) {
    const [icon, label, tone] = STATUS[d.status] || (d.sold7d ? STATUS.vendendo : STATUS.parado);
    const listed = listedText(d);
    const listedRow = listed
      ? `<div class="sx-row${listed.fresh ? " is-new" : ""}"><i>📆</i><span>Publicado</span><b>${esc(listed.when)} <em>${esc(listed.ago)}</em></b></div>`
      : "";
    const head = `
      <div class="sx-head">
        <span class="scoutx-logo"></span><span class="sx-brand">ScoutX</span>
        ${listed && listed.fresh ? '<span class="sx-tag sx-new">✨ Novo</span>' : ""}
        <span class="sx-tag sx-${tone}">${icon} ${label}</span>
      </div>`;
    if (!d.sold30d) {
      return `${head}<div class="sx-empty">Nenhuma venda nos últimos 30 dias</div>${listedRow ? `<div class="sx-rows">${listedRow}</div>` : ""}`;
    }
    const rows = [
      `<div class="sx-row"><i>💰</i><span>Faturou 7d</span><b>${money(d.revenue7d)}</b></div>`,
      d.activeDays7 !== null && d.activeDays7 !== undefined
        ? `<div class="sx-row"><i>📅</i><span>Vende em</span><b>${d.activeDays7}/7 dias</b></div>`
        : "",
      d.peak30 ? `<div class="sx-row"><i>🏆</i><span>Recorde</span><b>${fmt(d.peak30)}/dia</b></div>` : "",
      d.categoryRank && d.category
        ? `<div class="sx-row"><i>📊</i><span>${esc(d.category)}</span><b>#${fmt(d.categoryRank)}</b></div>`
        : "",
      listedRow,
    ].join("");
    return `${head}
      <div class="sx-nums">
        <div><span>24h</span><b>${fmt(d.sold1d)}</b></div>
        <div class="is-main"><span>7 dias</span><b>${fmt(d.sold7d)}</b></div>
        <div><span>30 dias</span><b>${fmt(d.sold30d)}</b></div>
      </div>
      ${barsHtml(d.days7)}
      <div class="sx-rows">${rows}</div>
      <button type="button" class="sx-cta">Ver análise completa →</button>`;
  }

  function renderPanel({ id, card }) {
    const d = known.get(id);
    if (!d) return;
    let panel = card.querySelector(":scope .scoutx-panel");
    if (panel && panel.dataset.id === id) return;
    if (panel) panel.remove(); // card reaproveitado pela lista com outro produto
    card.querySelector(":scope .scoutx-badge")?.remove();
    panel = document.createElement("div");
    const [, , tone] = STATUS[d.status] || STATUS.parado;
    panel.className = `scoutx-panel sx-tone-${tone}`;
    panel.dataset.id = id;
    panel.innerHTML = panelHtml(d);
    // O card do site costuma ser um link: o painel não pode abrir o produto.
    panel.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target.closest(".sx-cta, .sx-head")) openAnalysis(d);
    });
    card.prepend(panel);
  }

  let panelMode = "full";
  try {
    chrome.storage.sync.get("panelMode", (v) => {
      panelMode = v?.panelMode === "compact" ? "compact" : "full";
      scan();
    });
    chrome.storage.onChanged.addListener((ch) => {
      if (!ch.panelMode) return;
      panelMode = ch.panelMode.newValue === "compact" ? "compact" : "full";
      document.querySelectorAll(".scoutx-panel, .scoutx-badge").forEach((el) => el.remove());
      scan();
    });
  } catch {
    // sem storage: fica no painel completo
  }

  function renderCard(c) {
    if (panelMode === "full") return renderPanel(c);
    const { id, card, anchor } = c;
    const d = known.get(id);
    if (!d) return;
    card.querySelector(":scope .scoutx-panel")?.remove();
    let badge = card.querySelector(":scope .scoutx-badge");
    if (badge && badge.dataset.id === id) return;
    if (badge) badge.remove(); // card reaproveitado pela lista com outro produto
    badge = document.createElement("button");
    badge.type = "button";
    badge.className = `scoutx-badge${d.hot ? " is-hot" : ""}`;
    badge.dataset.id = id;
    badge.title = "Ver análise completa na ScoutX";
    badge.innerHTML = badgeHtml(d);
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAnalysis(d);
    });
    const target = anchor && card.contains(anchor) ? anchor : card;
    if (getComputedStyle(target).position === "static") target.style.position = "relative";
    target.appendChild(badge);
  }

  function renderDetail(id) {
    let box = document.getElementById("scoutx-detail");
    const d = known.get(id);
    if (!d) {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.id = "scoutx-detail";
      document.body.appendChild(box);
    }
    if (box.dataset.id === id) return;
    box.dataset.id = id;
    const [, , tone] = STATUS[d.status] || STATUS.parado;
    box.className = `scoutx-panel sx-floating sx-tone-${tone}`;
    box.innerHTML = panelHtml(d);
    box.querySelector(".sx-cta")?.addEventListener("click", () => openAnalysis(d));
  }

  function warnAuth(status) {
    if (authWarned) return;
    authWarned = true;
    const t = document.createElement("div");
    t.id = "scoutx-toast";
    t.innerHTML = `<span class="scoutx-logo"></span><div><b>ScoutX Radar</b><br>${
      status === 403 ? "Seu plano da ScoutX não inclui o Radar de Vendas." : "Entre na sua conta da ScoutX para ver as vendas dos produtos."
    }</div><button type="button" aria-label="Fechar">×</button>`;
    t.querySelector("button").addEventListener("click", () => t.remove());
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 12000);
  }

  // ---------- ciclo ----------
  let pending = new Set();
  let timer = null;

  function scan() {
    const cards = PLATFORM.dataIdSite ? findDataIdCards() : PLATFORM.dropiSite ? findDropiCards() : findMastershopCards();
    const dId = detailId();
    const ids = new Set(cards.map((c) => c.id));
    if (dId) ids.add(dId);
    const unknown = [...ids].filter((id) => !known.has(id));
    for (const c of cards) renderCard(c);
    if (dId) renderDetail(dId);
    else document.getElementById("scoutx-detail")?.remove();
    if (unknown.length) fetchIds(unknown);
  }

  function fetchIds(ids) {
    for (const id of ids) pending.add(id);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const batch = [...pending];
      pending = new Set();
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: "lookup", country: PLATFORM.country, ids: batch });
      } catch {
        return; // extensão recarregada: a próxima página resolve
      }
      if (!res?.ok) {
        if (res?.status === 401 || res?.status === 403) warnAuth(res.status);
        return;
      }
      scoutxBase = res.base;
      for (const id of batch) known.set(id, res.items[id] || null);
      scan();
    }, 350);
  }

  // Na Mastershop: avisa o background (renova a sessão se o admin ligou a chave).
  if (PLATFORM.country === "ms-co") {
    try {
      chrome.runtime.sendMessage({ type: "msSeen" }).catch(() => {});
    } catch {
      // extensão recarregada: sem problema
    }
  }

  let scanTimer = null;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }).observe(document.body, { childList: true, subtree: true });
  // SPA: troca de rota sem recarregar a página.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      scan();
    }
  }, 800);
  scan();
})();
