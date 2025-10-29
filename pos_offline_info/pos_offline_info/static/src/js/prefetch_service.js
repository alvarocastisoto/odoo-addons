/** @odoo-module **/
import { registry } from "@web/core/registry";

// Utilidades
function storageKey(env, pos) {
  const user = env.services.user;  // SIEMPRE existe
  const db  = user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

async function prefetchAll(env, pos) {
  const key = storageKey(env, pos);

  // Cogemos productos de la fuente que esté disponible
  const products =
    (pos.modelsByName?.["product.product"]?.records?.length
      ? pos.modelsByName["product.product"].records
      : Object.values(pos.db?.product_by_id || {})) || [];

  const ids = products.map(p => p.id);
  if (!ids.length) {
    console.log("[pos_offline_info] prefetch: no hay productos");
    return;
  }
  if (!navigator.onLine) {
    console.log("[pos_offline_info] prefetch: offline → salto");
    return;
  }

  // 1) WHERE (tu módulo pos_stock_where)
  try {
    const whereMap = await env.services.orm.call(
      "product.product", "pos_where_bulk", [ids, pos.config.id], {}
    );
    let snap = lsGet(key) || { byProduct:{}, ts:0, version:1 };
    for (const pid of ids) {
      const prev = snap.byProduct[pid] || {};
      snap.byProduct[pid] = { ...prev, where: Array.isArray(whereMap?.[pid]) ? whereMap[pid] : [] };
    }
    snap.ts = Date.now();
    lsSet(key, snap);
    console.log("[pos_offline_info] precache WHERE OK");
  } catch (e) {
    console.warn("[pos_offline_info] precache WHERE failed:", e);
  }

  // 2) INFO en lotes (nuestro pos_product_info_bulk)
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    try {
      const infoMap = await env.services.orm.call(
        "product.product", "pos_product_info_bulk", [batch, pos.config.id, 1.0], {}
      );
      let cur = lsGet(key) || { byProduct:{}, ts:0, version:1 };
      for (const [pidStr, info] of Object.entries(infoMap || {})) {
        const pid = Number(pidStr);
        const prev = cur.byProduct[pid] || {};
        cur.byProduct[pid] = { ...prev, info };
      }
      cur.ts = Date.now();
      lsSet(key, cur);
      console.log(`[pos_offline_info] precache INFO +${Object.keys(infoMap || {}).length}`);
    } catch (e) {
      console.warn("[pos_offline_info] precache INFO failed:", e);
    }
  }

  console.log("[pos_offline_info] prefetch DONE");
}

// Service que se ejecuta cuando POS está listo
registry.category("services").add("pos_offline_prefetch", {
  dependencies: ["pos", "orm", "user"],
  start(env) {
    // `env.services.pos` es el PosStore. Esperamos a que esté listo.
    const pos = env.services.pos;
    if (!pos) return;
    pos.ready.then(() => prefetchAll(env, pos)).catch((e) => {
      console.warn("[pos_offline_info] prefetch service error:", e);
    });
  },
});
