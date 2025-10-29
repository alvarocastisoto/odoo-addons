/** @odoo-module **/
import { registry } from "@web/core/registry";

function keyBase(pos){
  const user = pos?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

async function refreshWhereFor(env, pos, productIds){
  if (!productIds?.length) return;
  const base = keyBase(pos);
  const keySnap = base;
  const keyRes  = base + "/reservations";

  const CH = 150;
  let cur = lsGet(keySnap) || { byProduct: {}, ts:0, version:1 };
  for (let i=0; i<productIds.length; i+=CH){
    const batch = productIds.slice(i, i+CH);
    const map = await env.services.orm.call("product.product", "pos_where_bulk", [batch, pos.config.id], {});
    for (const pid of batch) {
      const prev = cur.byProduct[pid] || {};
      const rows = Array.isArray(map?.[pid]) ? map[pid] : [];
      cur.byProduct[pid] = { ...prev, where: rows };
    }
  }
  cur.ts = Date.now();
  lsSet(keySnap, cur);
  pos.offlineInfo = cur;

  const R = lsGet(keyRes) || {};
  for (const pid of productIds) delete R[pid];
  lsSet(keyRes, R);
}

// --- PING HTTP con backoff (sin JSON-RPC) ---
async function httpPing(urls=["/web/webclient/version_info", "/web"], attempts=[0, 800, 1600, 3200, 6400]) {
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i]) await new Promise(r => setTimeout(r, attempts[i]));
    if (!navigator.onLine) continue;

    for (const url of urls) {
      try {
        const opts = url === "/web"
          ? { method: "HEAD", credentials: "include", cache: "no-store" }
          : { method: "GET",  credentials: "include", cache: "no-store" };
        const res = await fetch(url, opts);
        if (res && res.ok) {
          window.__pos_rpc_down__ = false;
          return true;
        }
      } catch {
        // sigue intentando con la siguiente URL / intento
      }
    }
    window.__pos_rpc_down__ = true;
  }
  return false;
}

registry.category("services").add("pos_offline_autoflush", {
  // No necesitamos "rpc" aquí
  dependencies: ["pos", "orm", "user"],
  start(env) {
    const pos = env.services.pos;
    if (!pos) return;

    let running = false;
    const onOnline = async () => {
      if (running) return;
      running = true;
      try {
        const ok = await httpPing();
        if (!ok) return;

        // Empuja pedidos en cola (si hay)
        try {
          const maybe = pos.push_orders?.();
          if (maybe?.then) await maybe;
        } catch {}

        // Refresca WHERE de productos con reservas
        const base = keyBase(pos);
        const R = lsGet(base + "/reservations") || {};
        const ids = Object.keys(R).map(Number).filter(Boolean);
        if (ids.length) {
          try { await refreshWhereFor(env, pos, ids); } catch {}
        }
      } finally {
        running = false;
      }
    };

    window.addEventListener("online", onOnline);
    if (navigator.onLine) onOnline();

    return { destroy(){ window.removeEventListener("online", onOnline); } };
  },
});
