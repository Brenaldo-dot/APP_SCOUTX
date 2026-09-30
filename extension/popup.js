const statusEl = document.getElementById("status");
const urlEl = document.getElementById("url");

function setStatus(cls, text) {
  statusEl.className = `card ${cls}`;
  statusEl.innerHTML = `<span class="dot"></span>${text}`;
}

// ---------- sessão da Mastershop (só admin) ----------
const msCard = document.getElementById("ms-card");
const msStatus = document.getElementById("ms-status");
const msNow = document.getElementById("ms-now");
const msButtons = msCard.querySelectorAll(".seg button");

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function showMs() {
  const { msSync, msLastSync } = await chrome.storage.local.get(["msSync", "msLastSync"]);
  msButtons.forEach((b) => b.classList.toggle("on", (b.dataset.ms === "on") === Boolean(msSync)));
  msNow.hidden = !msSync;
  if (!msSync) {
    msStatus.textContent = "Ligue para a ScoutX renovar a sessão sempre que você abrir a Mastershop logado neste Chrome.";
  } else if (!msLastSync) {
    msStatus.textContent = "Abra a Mastershop logado (ou clique em Renovar agora).";
  } else if (msLastSync.ok) {
    msStatus.innerHTML = `<b class="ok">✓ Renovada</b> em ${fmtWhen(msLastSync.at)}`;
  } else {
    const why = msLastSync.error || (msLastSync.status === 403 ? "sua conta não é admin" : "falhou");
    msStatus.innerHTML = `<b class="bad">✗ Não renovou</b> em ${fmtWhen(msLastSync.at)}: ${why}`;
  }
}

msButtons.forEach((b) =>
  b.addEventListener("click", async () => {
    const on = b.dataset.ms === "on";
    await chrome.storage.local.set({ msSync: on });
    if (on) await chrome.runtime.sendMessage({ type: "msSyncNow" });
    showMs();
  })
);
msNow.addEventListener("click", async () => {
  msStatus.textContent = "Renovando…";
  const r = await chrome.runtime.sendMessage({ type: "msSyncNow" });
  if (r?.reason === "no-cookie") msStatus.textContent = "Você não está logado na Mastershop neste Chrome. Entre nela e tente de novo.";
  else showMs();
});

async function refresh() {
  setStatus("", "Verificando conexão…");
  const s = await chrome.runtime.sendMessage({ type: "status" });
  msCard.hidden = !(s.ok && s.isAdmin);
  if (!msCard.hidden) showMs();
  urlEl.value = s.base;
  if (s.ok && s.canUse) setStatus("ok", `Conectado${s.name ? ` como <b>${s.name}</b>` : ""}. Os selos aparecem no catálogo.`);
  else if (s.ok) setStatus("bad", "Conectado, mas seu plano não inclui o Radar de Vendas.");
  else if (s.reason === "login") setStatus("bad", "Entre na sua conta da ScoutX neste navegador.");
  else setStatus("bad", "Não consegui falar com a ScoutX. Confira o endereço.");
}

document.getElementById("save").addEventListener("click", async () => {
  const value = urlEl.value.trim().replace(/\/+$/, "");
  await chrome.storage.sync.set({ scoutxUrl: value });
  await chrome.runtime.sendMessage({ type: "clearCache" });
  refresh();
});

document.getElementById("open").addEventListener("click", async () => {
  const s = await chrome.runtime.sendMessage({ type: "status" });
  chrome.tabs.create({ url: `${s.base}/radar-vendas` });
});

// Painel completo (padrão) ou selo compacto nos cards do catálogo.
const modeButtons = document.querySelectorAll(".seg button");
function showMode(mode) {
  modeButtons.forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
}
chrome.storage.sync.get("panelMode", (v) => showMode(v?.panelMode === "compact" ? "compact" : "full"));
modeButtons.forEach((b) =>
  b.addEventListener("click", async () => {
    await chrome.storage.sync.set({ panelMode: b.dataset.mode });
    showMode(b.dataset.mode);
  })
);

refresh();
