/** @odoo-module **/

/* ===== Banner UI ===== */
function ensureBanner() {
  let el = document.getElementById("pos-offline-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "pos-offline-banner";
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

const PING_URL        = "/pos_offline_info/ping";
const BASE_INTERVAL   = 10_000;   // 10 s cuando todo OK
const TIMEOUT_MS      = 2_500;    // corte rápido
const BACKOFF_MAX_MS  = 60_000;   // 60 s máx cuando está caído
let   nextDelay       = BASE_INTERVAL;

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function pingOnce() {
  // No gastes cuando la pestaña no está a la vista
  if (document.hidden) return schedule();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("Timeout", "AbortError")), TIMEOUT_MS);
  try {
    const res = await fetch(PING_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
      headers: { "Accept": "text/plain" },
    });
    clearTimeout(timer);
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
    schedule();
  }
}

function schedule() {
  const jitter = 1 + (Math.random()*0.3 - 0.15); // ±15%
  setTimeout(pingOnce, Math.floor(nextDelay * jitter));
}

/* ===== Señales del navegador (ayudan, pero no se confía en ellas) ===== */
window.addEventListener("offline", () => showBanner("Trabajando sin conexión"));
window.addEventListener("online",  () => { nextDelay = 1_000; pingOnce(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { nextDelay = BASE_INTERVAL; pingOnce(); }
});

setTimeout(pingOnce, 2_000);
