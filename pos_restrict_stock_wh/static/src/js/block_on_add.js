/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Order, Orderline } from "@point_of_sale/app/store/models";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { ConfirmPopup } from "@point_of_sale/app/utils/confirm_popup/confirm_popup";
// Si usas pos_offline_info, mantenemos esta importación:
import * as OFFDB from "@pos_offline_info/js/cache_indexeddb";

/* ===== opciones ===== */
const SHOW_LAST_UNIT_TOAST = true;
const DEBUG = true;
const FAIL_CLOSED = true;                // sin datos fiables → bloquear
const LOW_STOCK_THRESHOLD = 10;          // umbral “stock bajo”
const LOW_STOCK_COOLDOWN_MIN = 0;        // minutos (0 = sin cooldown)
const LOW_STOCK_RESIGNAL_ON_DECREASE = true;

/* ===== logs ===== */
const log  = (...a) => DEBUG && console.log("[pos_restrict_stock_wh]", ...a);
const warn = (...a) => console.warn("[pos_restrict_stock_wh]", ...a);

function tagLog(label, payload){
  log(`check ${label}`, payload);
}

/* ===== helpers ===== */
function isControlledByStock(product) { return product && product.type !== "service"; }
function fmt(n){ const v=Number(n); return Number.isFinite(v) ? Math.round(v*100)/100 : 0; }
function leafName(s){ s=String(s||""); const p=s.split("/").filter(Boolean); return p.length?p.at(-1):s; }
function offlineLike(){ return !navigator.onLine || window.__pos_rpc_down__ === true; }

/* ===== storage base (LS) ===== */
function baseKey(pos){
  const user = pos?.env?.services?.user;
  const db   = user?.context?.db || "";
  const cmp  = pos?.config?.company_id?.[0] || "0";
  const cfg  = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

/* ===== allowed tree ===== */
let __ALLOWED_IDS_CACHE__ = null;
async function getAllowedChildLocationIds(env){
  if (__ALLOWED_IDS_CACHE__) return __ALLOWED_IDS_CACHE__;
  const pos = env.services.pos;
  const snap = lsGet(baseKey(pos)+"/allowed_locs");
  if (snap?.children?.length){
    __ALLOWED_IDS_CACHE__ = snap.children.map(Number).filter(Number.isFinite);
    return __ALLOWED_IDS_CACHE__;
  }
  if (!offlineLike()){
    try{
      const rpc = env.services.rpc;
      const cfg = (await rpc("/web/dataset/call_kw/pos.config/read", {
        model:"pos.config", method:"read", args:[[pos.config.id],["picking_type_id"]], kwargs:{},
      }))?.[0] || {};
      const ptypeId = cfg?.picking_type_id?.[0] || null;
      if (!ptypeId) throw new Error("No picking_type_id");

      const ptype = (await rpc("/web/dataset/call_kw/stock.picking.type/read", {
        model:"stock.picking.type", method:"read", args:[[ptypeId],["default_location_src_id"]], kwargs:{},
      }))?.[0] || {};
      const root = ptype?.default_location_src_id?.[0] || null;
      if (!root) throw new Error("No default_location_src_id");

      const ids = await rpc("/web/dataset/call_kw/stock.location/search", {
        model:"stock.location", method:"search",
        args:[[["id","child_of",[root]],["usage","=","internal"]]], kwargs:{},
      });
      const children = (Array.isArray(ids)?ids:[]).map(Number).filter(Number.isFinite);
      lsSet(baseKey(pos)+"/allowed_locs", { root, children, ts:Date.now() });
      __ALLOWED_IDS_CACHE__ = children;
      return __ALLOWED_IDS_CACHE__;
    }catch(e){ warn("allowed_locs RPC failed", e); }
  }
  __ALLOWED_IDS_CACHE__ = [];
  return __ALLOWED_IDS_CACHE__;
}

/* ===== overlay sesión (por producto) ===== */
function ensureSessionMap(pos){
  if (!pos.__prsw_session_reserved) pos.__prsw_session_reserved = {};
  return pos.__prsw_session_reserved;
}
function incReserved(pos, productId, delta){
  if (!Number.isFinite(delta) || !delta) return;
  const map = ensureSessionMap(pos);
  map[productId] = (Number(map[productId])||0) + delta;
  if (map[productId] < 0) map[productId] = 0;
}
function setReservedFromOrder(pos){
  const map = {};
  const order = pos?.get_order?.() || pos?.selectedOrder || null;
  if (order){
    const lines = order.get_orderlines?.() || [];
    for (const l of lines){
      const p = l.get_product ? l.get_product() : l.product;
      const q = (l.get_quantity ? Number(l.get_quantity()) : Number(l.qty||0)) || 0;
      if (p?.id && q>0) map[p.id] = (map[p.id]||0) + q;
    }
  }
  pos.__prsw_session_reserved = map;
  return map;
}

/* ===== reservas persistidas offline (por árbol) ===== */
function readPersistedReservations(pos){
  const base = baseKey(pos);
  const A = lsGet(base + "/reservations_persisted") || {};
  const B = lsGet(base + "/reservations") || {};
  const out = {};
  for (const src of [A,B]){
    for (const [pid,byLoc] of Object.entries(src)){
      const dst = (out[pid]=out[pid]||{});
      for (const [lid,q] of Object.entries(byLoc)){
        dst[lid] = (Number(dst[lid])||0) + Number(q||0);
      }
    }
  }
  return out;
}
function persistedReservedInAllowed(pos, productId, allowedSet){
  const map = readPersistedReservations(pos);
  const byLoc = map?.[String(productId)] || {};
  let total = 0;
  for (const [lid,q] of Object.entries(byLoc)){
    if (!allowedSet.size || allowedSet.has(Number(lid))) total += Number(q||0);
  }
  return total;
}

/* ===== aviso stock bajo ===== */
function getSessionId(pos){
  return (
    (pos && pos.pos_session && pos.pos_session.id) ||
    (pos && pos.session && pos.session.id) ||
    (Array.isArray(pos?.config?.current_session_id) ? pos.config.current_session_id[0] : null) ||
    "0"
  );
}
function lowKey(pos, productId){ return baseKey(pos)+"/low_ping/s"+String(getSessionId(pos))+"/"+String(productId); }

function maybeLowStockToast(env, product, remainingExact){
  const pos = env.services.pos;
  const thr = Number(LOW_STOCK_THRESHOLD);
  if (!Number.isFinite(thr) || thr <= 0) return;

  if (!(remainingExact > 0 && remainingExact <= thr)){
    try{ localStorage.removeItem(lowKey(pos, product.id)); }catch{}
    return;
  }

  const k = lowKey(pos, product.id);
  const snap = lsGet(k);
  const now = Date.now();
  const cooldownMs = Math.max(0, Number(LOW_STOCK_COOLDOWN_MIN) * 60_000);

  let should = false;
  if (!snap){
    should = true;
  }else{
    const elapsed = now - (snap.ts||0);
    const decreased = Number.isFinite(snap.rem) && remainingExact < snap.rem;
    should = LOW_STOCK_RESIGNAL_ON_DECREASE
      ? (decreased ? (cooldownMs ? elapsed >= cooldownMs : true) : elapsed >= cooldownMs)
      : elapsed >= cooldownMs;
  }

  if (should){
    try{
      env.services.notification?.add?.(
        `Stock bajo: quedan ${fmt(remainingExact)} de ${leafName(product.display_name || product.name)}`
      );
    }catch{}
    lsSet(k, { ts: now, rem: remainingExact, v: 5 });
  }
}

/* ===== WHERE rows ===== */
async function getWhereRows(env, productId){
  const pos = env.services.pos;
  const HAS_IDB = OFFDB && typeof OFFDB.cache?.getJSON === "function" &&
                  typeof OFFDB.buildCtx === "function" && typeof OFFDB.keyWhere === "function";

  if (offlineLike()){
    if (HAS_IDB){
      const ctx = OFFDB.buildCtx(pos);
      let rows = await OFFDB.cache.getJSON("where", OFFDB.keyWhere(ctx, productId));
      if (!Array.isArray(rows) || rows.length===0) rows = OFFDB.readLSWhere?.(pos, productId) || [];
      return Array.isArray(rows) ? rows : [];
    }
    const key = baseKey(pos);
    const snap = lsGet(key);
    const rows = snap?.byProduct?.[productId]?.where;
    return Array.isArray(rows) ? rows : [];
  }

  try{
    const rows = await env.services.rpc("/pos_restrict_stock_wh/where_available", {
      product_id: productId,
      config_id: pos.config?.id || null,
      company_id: pos.config?.company_id?.[0] || null,
      limit: 200,
    });
    if (Array.isArray(rows)){
      if (rows.length && HAS_IDB){
        const ctx = OFFDB.buildCtx(pos);
        await OFFDB.cache.setJSON("where", OFFDB.keyWhere(ctx, productId), rows);
      }
      return rows;
    }
    return [];
  }catch(e){
    warn("where_available RPC failed → offline snapshot fallback", e);
    if (HAS_IDB){
      const ctx = OFFDB.buildCtx(pos);
      let rows = await OFFDB.cache.getJSON("where", OFFDB.keyWhere(ctx, productId));
      if (!Array.isArray(rows) || rows.length===0) rows = OFFDB.readLSWhere?.(pos, productId) || [];
      return Array.isArray(rows) ? rows : [];
    }
    const key = baseKey(pos);
    const snap = lsGet(key);
    const rows = snap?.byProduct?.[productId]?.where;
    return Array.isArray(rows) ? rows : [];
  }
}

/* ===== stock por fila ===== */
function rowOnHand(r){
  if (!r) return 0;
  if (Object.prototype.hasOwnProperty.call(r,"free_qty")){
    const v = Number(r.free_qty);
    return Number.isFinite(v) ? Math.max(v,0) : 0;
  }
  const hasQ = Object.prototype.hasOwnProperty.call(r,"quantity");
  const hasR = Object.prototype.hasOwnProperty.call(r,"reserved") ||
               Object.prototype.hasOwnProperty.call(r,"reserved_quantity");
  if (hasQ && hasR){
    const q  = Number(r.quantity||0);
    const rv = Number((r.reserved!=null ? r.reserved : r.reserved_quantity)||0);
    const free = q - rv;
    return Number.isFinite(free) ? Math.max(free,0) : 0;
  }
  const keys = ["available_quantity","available_qty","qty_available","on_hand","quantity_available","qty","quantity","atp"];
  for (const k of keys){
    if (Object.prototype.hasOwnProperty.call(r,k)){
      const v = Number(r[k]||0);
      if (Number.isFinite(v) && v>0) return v;
    }
  }
  return 0;
}
const locId = (r)=> r?.location_id ?? r?.location?.id ?? r?.id ?? null;

/* ===== flag restricción ===== */
async function getRestrictFlag(env){
  const pos = env.services.pos;
  const cfg = pos.config || {};
  const k = baseKey(pos) + "/restrict_flag";

  if (typeof cfg.restrict_out_of_stock === "boolean"){
    const val = !!cfg.restrict_out_of_stock;
    lsSet(k, { value: val, ts: Date.now(), v: 1 });
    return val;
  }
  if (offlineLike()){
    const snap = lsGet(k);
    if (snap && typeof snap.value === "boolean") return snap.value;
    return true; // fail-closed
  }
  try{
    const recs = await env.services.rpc("/web/dataset/call_kw/pos.config/read", {
      model:"pos.config", method:"read", args:[[cfg.id],["restrict_out_of_stock"]], kwargs:{},
    });
    const val = !!(recs?.[0]?.restrict_out_of_stock);
    cfg.restrict_out_of_stock = val;
    lsSet(k, { value: val, ts: Date.now(), v: 1 });
    return val;
  }catch(e){
    const snap = lsGet(k);
    if (snap && typeof snap.value === "boolean") return snap.value;
    return true;
  }
}

/* ===== chequeo central ===== */
async function canAddProductNow(env, product, qtyToAdd, label="CHECK"){
  const pos = env.services.pos;
  const restrict = await getRestrictFlag(env);
  if (!restrict) return { ok:true };
  if (!isControlledByStock(product)) return { ok:true };

  const allowedIds = (await getAllowedChildLocationIds(env)).map(Number).filter(Number.isFinite);
  const allowedSet = new Set(allowedIds);

  const rows = await getWhereRows(env, product.id);
  if ((!rows || rows.length===0) && FAIL_CLOSED){
    warn("No hay filas de stock (online/offline) → FAIL_CLOSED: bloqueo");
    return { ok:false, remaining:0, allowedOnHand:0, reserved:0, remainingExact:0, allowedExact:0, reservedExact:0 };
  }

  let allowedOnHandExact = 0;
  for (const r of rows){
    const lid = Number(locId(r));
    if (!Number.isFinite(lid)) continue;
    if (!allowedSet.size || allowedSet.has(lid)){
      allowedOnHandExact += Number(rowOnHand(r));
    }
  }

  if (!pos.__prsw_session_reserved) setReservedFromOrder(pos);
  const reservedSessionExact   = Number((pos.__prsw_session_reserved || {})[product.id] || 0);
  const reservedPersistedExact = persistedReservedInAllowed(pos, product.id, allowedSet);
  const alreadyReservedExact   = reservedSessionExact + reservedPersistedExact;

  const need = Number(qtyToAdd || 1);
  const remainingExact = allowedOnHandExact - alreadyReservedExact;

  tagLog(label, {
    product: { id: product.id, type: product.type, name: product.display_name || product.name },
    allowedOnHand: fmt(allowedOnHandExact),
    reservedSession: fmt(reservedSessionExact),
    reservedPersisted: fmt(reservedPersistedExact),
    reserved: fmt(alreadyReservedExact),
    remaining: fmt(remainingExact),
    need,
    offline: offlineLike(),
    rowsCount: rows?.length || 0,
    allowedSetSize: allowedSet.size,
  });

  if (remainingExact <= 0 || need > remainingExact){
    warn("BLOCK", { product: product.id, allowedOnHand: fmt(allowedOnHandExact), reserved: fmt(alreadyReservedExact), remaining: fmt(remainingExact), need });
    return {
      ok:false,
      remaining: fmt(remainingExact), allowedOnHand: fmt(allowedOnHandExact), reserved: fmt(alreadyReservedExact),
      remainingExact, allowedExact: allowedOnHandExact, reservedExact: alreadyReservedExact,
    };
  }
  return {
    ok:true,
    remaining: fmt(remainingExact), allowedOnHand: fmt(allowedOnHandExact), reserved: fmt(alreadyReservedExact),
    remainingExact, allowedExact: allowedOnHandExact, reservedExact: alreadyReservedExact,
  };
}

/* ===== UI: ProductScreen ===== */
if (!ProductScreen.prototype.__prsw_block_on_add_patched__){
  const _addToOrder = ProductScreen.prototype.addProductToCurrentOrder;
  patch(ProductScreen.prototype, {
    async addProductToCurrentOrder(product, options = {}) {
      options = options || {};
      const qty = Number(options?.quantity ?? 1);

      try{
        const chk = await canAddProductNow(this.env, product, qty, "PRE");
        if (!chk.ok){
          const title = "Sin stock en el árbol del TPV";
          const body  = `No puedes añadir «${product.display_name || product.name}».
Quedan ${fmt(chk.remaining)} (permitido: ${fmt(chk.allowedOnHand)} − reservado en sesión: ${fmt(chk.reserved)}).`;
          await this.env.services.popup.add(ConfirmPopup, { title, body, confirmText:"Aceptar" });
          return;
        }
        options.__prsw_checked = true;
      }catch(e){
        warn("addProductToCurrentOrder guard failed; allowing add", e);
      }

      const pos = this.env.services.pos;
      pos.__prsw_skip_next_set_q   = true;  // evita overlay en set_quantity interno
      pos.__prsw_skip_recheck_guard = true; // evita re-check en Order.add_product

      try{
        return await _addToOrder.call(this, product, options);
      }finally{
        pos.__prsw_skip_next_set_q   = false;
        pos.__prsw_skip_recheck_guard = false;
      }
    },
  });
  ProductScreen.prototype.__prsw_block_on_add_patched__ = true;
}

/* ===== Modelo: Order.add_product ===== */
const __orig_add_product__ =
  (Order && Order.prototype && (Order.prototype.add_product || Order.prototype.addProduct)) || null;

if (__orig_add_product__ && !Order.prototype.__prsw_add_product_patched__){
  Order.prototype.add_product = async function(product, options = {}){
    options = options || {};
    const qty = Number(options?.quantity ?? 1);

    // Saltar re-check si venimos de ProductScreen (flag de sesión)
    if (!options.__prsw_checked && !this.pos.__prsw_skip_recheck_guard){
      try{
        const chk = await canAddProductNow(this.pos.env, product, qty, "PRE(Order)");
        if (!chk.ok){
          const title = "Sin stock en el árbol del TPV";
          const body  = `No puedes añadir «${product.display_name || product.name}».
Quedan ${fmt(chk.remaining)} (permitido: ${fmt(chk.allowedOnHand)} − reservado en sesión: ${fmt(chk.reserved)}).`;
          await this.pos.env.services.popup.add(ConfirmPopup, { title, body, confirmText:"Aceptar" });
          return;
        }
      }catch(e){ warn("Order.add_product guard failed; allowing add", e); }
    }

    const pos = this.pos;
    const prev = !!pos.__prsw_skip_next_set_q;
    pos.__prsw_skip_next_set_q = true;

    try{
      const res = await __orig_add_product__.apply(this, arguments);

      // Actualiza overlay y EMITE TOASTS con el remanente REAL tras añadir
      if (product?.id && qty>0) {
        incReserved(pos, product.id, qty);
        try {
          const chkAfter = await canAddProductNow(pos.env, product, 0, "AFTER");
          const remainingNow = Number(chkAfter.remainingExact);
          if (remainingNow === 0 && SHOW_LAST_UNIT_TOAST){
            pos.env.services.notification?.add?.(`Última unidad de ${leafName(product.display_name || product.name)}`);
          } else if (remainingNow > 0 && remainingNow <= LOW_STOCK_THRESHOLD){
            maybeLowStockToast(pos.env, product, remainingNow);
          }
        } catch(e) { warn("post-add toast failed", e); }
      }
      return res;
    }finally{
      pos.__prsw_skip_next_set_q = prev;
    }
  };
  Order.prototype.__prsw_add_product_patched__ = true;
}

/* ===== Cantidad y borrar línea ===== */
if (!Orderline.prototype.__prsw_set_quantity_patched__){
  const _setQ = Orderline.prototype.set_quantity;
  Orderline.prototype.set_quantity = async function(q, keep_price){
    const cur  = this.get_quantity ? Number(this.get_quantity()) : Number(this.qty||0);
    const next = Number(q);
    const delta = (Number.isFinite(cur)&&Number.isFinite(next)) ? (next-cur) : 0;

    if (!this.pos || this.pos.__prsw_skip_next_set_q){
      return _setQ.apply(this, arguments);
    }

    const res = await _setQ.apply(this, arguments);
    try{
      const product = this.get_product ? this.get_product() : this.product;
      if (product?.id && Number.isFinite(delta) && delta){
        incReserved(this.pos, product.id, delta);
        const pos = this.pos;
        const chk = await canAddProductNow(pos.env, product, 0, "AFTER_SETQ");
        const after = Number(chk.remainingExact);
        if (after === 0 && SHOW_LAST_UNIT_TOAST){
          pos.env.services.notification?.add?.(`Última unidad de ${leafName(product.display_name || product.name)}`);
        } else if (after > 0 && after <= LOW_STOCK_THRESHOLD){
          maybeLowStockToast(pos.env, product, after);
        }
      }
    }catch(e){ warn("set_quantity overlay/toast failed", e); }
    return res;
  };
  Orderline.prototype.__prsw_set_quantity_patched__ = true;
}

if (!Order.prototype.__prsw_remove_line_patched__){
  const _rm = Order.prototype.remove_orderline;
  Order.prototype.remove_orderline = function(line){
    try{
      const product = line?.get_product ? line.get_product() : line?.product;
      const qty     = line?.get_quantity ? Number(line.get_quantity()) : Number(line?.qty||0);
      if (product?.id && qty>0) incReserved(this.pos, product.id, -qty);
    }catch(e){ warn("remove_orderline overlay adjust failed", e); }
    return _rm.apply(this, arguments);
  };
  Order.prototype.__prsw_remove_line_patched__ = true;
}

/* ===== Debug helpers ===== */
window.__PRSW__ = { setReservedFromOrder, canAddProductNow };
console.log("[pos_restrict_stock_wh] guard loaded (exported __PRSW__)", window.__PRSW__);
