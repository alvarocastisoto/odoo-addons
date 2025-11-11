/** @odoo-module **/
import { registry } from "@web/core/registry";
import { cache, buildCtx, keyWhere } from "./cache_indexeddb";

/* ========= helpers storage ========= */
function keyBase(pos) {
  const user = pos?.env?.services?.user;
  const db   = user?.context?.db || "";
  const cmp  = pos?.config?.company_id?.[0] || "0";
  const cfg  = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ========= helpers overlay / reservas ========= */
function mergeReservationsMaps(pos) {
  const base       = keyBase(pos);
  const legacyKey  = base + "/reservations";
  const persistKey = base + "/reservations_persisted";

  const L = lsGet(legacyKey)  || {}; // { pid: { lid: qty } }
  const P = lsGet(persistKey) || {};

  const out = {};

  for (const [pid, byLoc] of Object.entries(L)) {
    const dst = (out[pid] = out[pid] || {});
    for (const [lid, q] of Object.entries(byLoc)) {
      dst[lid] = (Number(dst[lid]) || 0) + Number(q || 0);
    }
  }
  // suma P
  for (const [pid, byLoc] of Object.entries(P)) {
    const dst = (out[pid] = out[pid] || {});
    for (const [lid, q] of Object.entries(byLoc)) {
      dst[lid] = (Number(dst[lid]) || 0) + Number(q || 0);
    }
  }
  return out; // { pid: { lid: qty } }
}

function deleteReservationsFor(pos, productIds) {
  const base       = keyBase(pos);
  const legacyKey  = base + "/reservations";
  const persistKey = base + "/reservations_persisted";

  const L = lsGet(legacyKey)  || {};
  const P = lsGet(persistKey) || {};

  let changed = false;

  for (const pid of productIds.map(String)) {
    if (pid in L) { delete L[pid]; changed = true; }
    if (pid in P) { delete P[pid]; changed = true; }
  }
  if (changed) {
    lsSet(legacyKey, L);
    lsSet(persistKey, P);
    try {
      const posSvc = pos;
      posSvc?.trigger?.("pos_offline_reservations_changed");
    } catch {}
  }
}

/* ========= refresco WHERE ========= */
async function refreshWhereFor(env, pos, productIds) {
  if (!productIds?.length) return;
  const ctx = buildCtx(pos);
  const CHUNK = 150;

  for (let i = 0; i < productIds.length; i += CHUNK) {
    const batch = productIds.slice(i, i + CHUNK);
    const map = await env.services.orm.call(
      "product.product", "pos_where_bulk", [batch, pos.config.id], {}
    );
    const kv = [];
    for (const pid of batch) {
      const rows = Array.isArray(map?.[pid]) ? map[pid] : [];
      kv.push({ key: keyWhere(ctx, pid), val: rows });
    }
    await cache.msetJSON("where", kv);
  }
}

/* ========= conectividad (FIX: sin 400) ========= */
async function httpPing(env, waits = [0, 800, 1600, 3200, 6400]) {
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
    if (!navigator.onLine) continue;

    // 1) ping ligero: HEAD /web
    try {
      const resWeb = await fetch("/web", {
        method: "HEAD",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (resWeb?.ok) {
        window.__pos_rpc_down__ = false;
        return true;
      }
    } catch {}

    // 2) ping de versión correcto (POST JSON), preferentemente vía rpc
    try {
      const rpc = env?.services?.rpc;
      if (rpc) {
        await rpc("/web/webclient/version_info", {}); // realiza POST JSON y maneja CSRF/cookies
        window.__pos_rpc_down__ = false;
        return true;
      }
      // Fallback manual si no hay rpc
      const resVer = await fetch("/web/webclient/version_info", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: "{}",
      });
      if (resVer?.ok) {
        window.__pos_rpc_down__ = false;
        return true;
      }
    } catch {}

    window.__pos_rpc_down__ = true;
  }
  return false;
}

registry.category("services").add("pos_offline_autoflush", {
  dependencies: ["pos", "orm", "user"],
  start(env) {
    const pos = env.services.pos;
    if (!pos) return;

    let running = false;

    const onOnline = async () => {
      if (running) return;
      running = true;
      try {
        const ok = await httpPing(env); // <-- pasa env al ping
        if (!ok) return;

        try { await pos.push_orders?.(); } catch {}

        const merged = mergeReservationsMaps(pos);
        const ids = Object.keys(merged).map(Number).filter(Boolean);

        if (ids.length) {
          try { await refreshWhereFor(env, pos, ids); } catch {}
          deleteReservationsFor(pos, ids); // borra en ambas claves + dispara evento
        }
      } finally {
        running = false;
      }
    };

    window.addEventListener("online", onOnline);
    if (navigator.onLine) onOnline();

    return {
      destroy() { window.removeEventListener("online", onOnline); },
    };
  },
});
