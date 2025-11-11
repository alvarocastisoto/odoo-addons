/** @odoo-module **/
import { registry } from "@web/core/registry";

/* ====== helpers cache en localStorage ====== */
function keyBase(pos){
  const user = pos?.env?.services?.user;
  const db   = user?.context?.db || "";
  const cmp  = pos?.config?.company_id?.[0] || "0";
  const cfg  = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
function lsGet(k){ try { return JSON.parse(localStorage.getItem(k)||"null"); } catch { return null; } }
function lsSet(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

export function readAllowedFromCache(pos){
  const snap = lsGet(keyBase(pos) + "/allowed_locs");
  if (snap && Array.isArray(snap.children)) return snap;
  return { root: null, children: [] };
}
export function writeAllowedToCache(pos, payload){
  const safe = {
    root: Number(payload?.root) || null,
    children: (Array.isArray(payload?.children) ? payload.children : []).map(Number).filter(Boolean),
    ts: Date.now(),
  };
  lsSet(keyBase(pos) + "/allowed_locs", safe);
  return safe;
}

async function computeAllowed(env){
  const rpc = env.services.rpc;
  const pos = env.services.pos;

  // 1) pos.config → picking_type_id
  const cfg = await rpc("/web/dataset/call_kw/pos.config/read", {
    model: "pos.config", method: "read",
    args: [[pos.config.id], ["picking_type_id"]],
    kwargs: {},
  });
  const ptypeId = cfg?.[0]?.picking_type_id?.[0] || null;
  if (!ptypeId) return null;

  const ptype = await rpc("/web/dataset/call_kw/stock.picking.type/read", {
    model: "stock.picking.type", method: "read",
    args: [[ptypeId], ["default_location_src_id"]],
    kwargs: {},
  });
  const rootId = ptype?.[0]?.default_location_src_id?.[0] || null;
  if (!rootId) return null;

  const ids = await rpc("/web/dataset/call_kw/stock.location/search", {
    model: "stock.location", method: "search",
    args: [[["id", "child_of", [rootId]], ["usage", "=", "internal"]]],
    kwargs: {},
  });

  return { root: rootId, children: Array.isArray(ids) ? ids : [] };
}

registry.category("services").add("pos_allowed_locations_cache", {
  dependencies: ["pos", "rpc", "user"],
  async start(env){
    const pos = env.services.pos;

    if (navigator.onLine) {
      try {
        const payload = await computeAllowed(env);
        if (payload) writeAllowedToCache(pos, payload);
      } catch (e) {
        console.warn("[pos_offline_info] allowed_locs precalc failed:", e);
      }
    }

    const onOnline = async () => {
      try {
        const payload = await computeAllowed(env);
        if (payload) writeAllowedToCache(pos, payload);
      } catch {}
    };
    window.addEventListener("online", onOnline);

    return { destroy(){ window.removeEventListener("online", onOnline); } };
  },
});
