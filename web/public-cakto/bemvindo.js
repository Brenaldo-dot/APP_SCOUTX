// Página /bem-vindo (server.js): a Cakto redireciona o comprador pra cá com
// ?ref=<refId> depois do pagamento aprovado. O webhook (server-to-server)
// pode demorar alguns segundos pra chegar, então isso aqui tenta buscar as
// credenciais várias vezes antes de desistir e mostrar o aviso de fallback.
(function () {
  const params = new URLSearchParams(window.location.search);
  const refId = params.get("ref");

  const loadingEl = document.getElementById("loading");
  const readyEl = document.getElementById("ready");
  const fallbackEl = document.getElementById("fallback");
  const missingRefEl = document.getElementById("missing-ref");
  const emailEl = document.getElementById("cred-email");
  const passwordEl = document.getElementById("cred-password");

  function show(el) {
    [loadingEl, readyEl, fallbackEl, missingRefEl].forEach((e) => e && e.classList.add("hidden"));
    if (el) el.classList.remove("hidden");
  }

  if (!refId) {
    show(missingRefEl);
    return;
  }

  const POLL_INTERVAL_MS = 3000;
  const MAX_ATTEMPTS = 25; // ~75s de tentativa antes do fallback

  let attempts = 0;
  function poll() {
    attempts += 1;
    fetch(`/api/cakto/credentials?ref=${encodeURIComponent(refId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.email && data.password) {
          emailEl.textContent = data.email;
          passwordEl.textContent = data.password;
          show(readyEl);
          return;
        }
        if (attempts >= MAX_ATTEMPTS) {
          show(fallbackEl);
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      })
      .catch(() => {
        if (attempts >= MAX_ATTEMPTS) {
          show(fallbackEl);
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      });
  }

  poll();
})();
