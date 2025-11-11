/** @odoo-module **/

/* ===== Banner UI ===== */
function ensureBanner() {
  let el = document.getElementById("pos-offline-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "pos-offline-banner";
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `<span class="dot"></span><span class="msg">Trabajando sin conexión</span>`;
    document.body.appendChild(el);
  }
  return el;
}
function showBanner(text) {
  const el = ensureBanner();
  if (text) el.querySelector(".msg").textContent = text;
  el.classList.add("visible");
  window.__pos_rpc_down__ = true;
}
function hideBanner() {
  const el = document.getElementById("pos-offline-banner");
  if (el) el.classList.remove("visible");
  window.__pos_rpc_down__ = false;
}

/* ===== Config ===== */
const PING_URL       = "/pos_offline_info/ping";
const BASE_INTERVAL  = 10_000;   // 10 s cuando todo OK
const TIMEOUT_MS     = 2_500;    // corte rápido
const BACKOFF_MAX_MS = 60_000;   // 60 s máx con caída

let nextDelay  = BASE_INTERVAL;
let pingTimer  = null;           // único timer
let inFlight   = false;          // evita pings en paralelo

function schedule(ms) {
  const jitter = 1 + (Math.random() * 0.3 - 0.15); // ±15%
  const delay  = Math.max(0, ms ?? Math.floor(nextDelay * jitter));
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = setTimeout(pingOnce, delay);
}

async function pingOnce() {
  // No gastes si está oculta; reprograma y sal.
  if (document.hidden) return schedule();

  // Evita solapar con otro fetch en curso
  if (inFlight) return;
  inFlight = true;

  const ctrl  = new AbortController();
  const killer = setTimeout(() => {
    try { ctrl.abort(new DOMException("Timeout", "AbortError")); } catch {}
  }, TIMEOUT_MS);

  try {
    const res = await fetch(PING_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
      headers: { "Accept": "text/plain" },
    });

    if (res.ok) {
      hideBanner();
      nextDelay = BASE_INTERVAL;
    } else {
      showBanner("Trabajando sin conexión");
      nextDelay = Math.min(Math.floor(nextDelay * 1.7), BACKOFF_MAX_MS);
    }
  } catch (_e) {
    showBanner("Trabajando sin conexión");
    nextDelay = Math.min(Math.floor(nextDelay * 1.7), BACKOFF_MAX_MS);
  } finally {
    clearTimeout(killer);
    inFlight = false;
    schedule();
  }
}

/* ===== Señales del navegador ===== */
window.addEventListener("offline", () => {
  showBanner("Trabajando sin conexión");
});

window.addEventListener("online", () => {
  nextDelay = 1_000;
  schedule(100);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    nextDelay = BASE_INTERVAL;
    schedule(100);
  }
});

window.addEventListener("beforeunload", () => {
  if (pingTimer) clearTimeout(pingTimer);
});

/* Arranque inicial */
window.addEventListener("load", () => schedule(2_000));
