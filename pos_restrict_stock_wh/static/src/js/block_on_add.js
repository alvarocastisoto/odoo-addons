/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { Order, Orderline } from "@point_of_sale/app/store/models";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { ConfirmPopup } from "@point_of_sale/app/utils/confirm_popup/confirm_popup";
import * as OFFDB from "@pos_offline_info/js/cache_indexeddb";

/* ===== opciones ===== */
const SHOW_LAST_UNIT_TOAST = true;
const DEBUG = true;
const FAIL_CLOSED = true;
const LOW_STOCK_THRESHOLD = 10;
const LOW_STOCK_COOLDOWN_MIN = 0;
const LOW_STOCK_RESIGNAL_ON_DECREASE = true;

/* ===== logs ===== */
const log  = (...a) => DEBUG && console.log("[pos_restrict_stock_wh]", ...a);
const warn = (...a) => console.warn("[pos_restrict_stock_wh]", ...a);
const tagLog = (label, payload)=> log(`check ${label}`, payload);

/* ===== helpers ===== */
const isControlledByStock = (p)=> p && p.type !== "service";
const fmt  = (n)=>{ const v=Number(n); return Number.isFinite(v) ? Math.round(v*100)/100 : 0; };
const leaf = (s)=>{ s=String(s||""); const p=s.split("/").filter(Boolean); return p.length?p.at(-1):s; };
const offlineLike = ()=> !navigator.onLine || window.__pos_rpc_down__===true;

/* === label de ubicación (offline: complete_name/display_name) === */
function locLabelFromRow(r, lid) {
  return String(
    r?.complete_name ||
    r?.display_name ||
    r?.location ||
    r?.location_name ||
    lid
  );
}

/* ===== LS base ===== */
function baseKey(pos){
  const user = pos?.env?.services?.user;
  const db   = user?.context?.db || "";
  const cmp  = pos?.config?.company_id?.[0] || "0";
  const cfg  = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

/* ===== árbol permitido ===== */
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

/* ===== util: IDB safe wrappers ===== */
async function safeIDBGetJSON(kind, key){
  try{
    if (OFFDB?.cache?.getJSON) return await OFFDB.cache.getJSON(kind, key);
  }catch(e){ warn(`IDB getJSON(${kind}) falló`, e); }
  return null;
}
async function safeIDBSetJSON(kind, key, val){
  try{
    if (OFFDB?.cache?.setJSON) await OFFDB.cache.setJSON(kind, key, val);
  }catch(e){ warn(`IDB setJSON(${kind}) falló`, e); }
}

/* ===== util: lectura amplia de WHERE desde caché (IDB/LS) ===== */
function readWhereFromLSLoose(pos, productId){
  const base = baseKey(pos);
  const snap = lsGet(base) || {};
  const byProduct = snap.byProduct || {};
  let rows = [];
  const pushArr = (a)=>{ if (Array.isArray(a) && a.length) rows = rows.concat(a); };

  pushArr(byProduct?.[productId]?.where_all);
  pushArr(byProduct?.[productId]?.where);
  pushArr(snap.where_all?.[productId]);
  pushArr(snap.where?.[productId]);

  try{ pushArr(OFFDB?.readLSWhere?.(pos, productId)); }catch{}
  return rows.filter(Boolean);
}

/* ===== endpoint global (toda la compañía) ===== */
async function getWhereRowsAll(env, productId){
  const pos = env.services.pos;
  const HAS_CTX = OFFDB && typeof OFFDB.buildCtx === "function" && typeof OFFDB.keyWhere === "function";

  if (offlineLike()){
    if (HAS_CTX){
      const ctx = OFFDB.buildCtx(pos);
      let rows = await safeIDBGetJSON("where_all", OFFDB.keyWhere(ctx, productId));
      if (!Array.isArray(rows) || rows.length === 0){
        rows = await safeIDBGetJSON("where", OFFDB.keyWhere(ctx, productId));
      }
      if (!Array.isArray(rows) || rows.length === 0){
        rows = readWhereFromLSLoose(pos, productId);
      }
      log("getWhereRowsAll OFFLINE -> rows:", rows?.length||0);
      return Array.isArray(rows) ? rows : [];
    }
    const rows = readWhereFromLSLoose(pos, productId);
    log("getWhereRowsAll OFFLINE(LS) -> rows:", rows?.length||0);
    return Array.isArray(rows) ? rows : [];
  }

  try{
    const rows = await env.services.rpc("/pos_restrict_stock_wh/where_available_all", {
      product_id: productId,
      company_id: pos.config?.company_id?.[0] || null,
      limit: 500,
    });
    if (Array.isArray(rows)){
      if (rows.length && HAS_CTX){
        const ctx = OFFDB.buildCtx(pos);
        await safeIDBSetJSON("where_all", OFFDB.keyWhere(ctx, productId), rows);
      }
      log("getWhereRowsAll ONLINE -> rows:", rows.length);
      return rows;
    }
    return [];
  }catch(e){
    warn("where_available_all RPC failed → fallback caché", e);
    if (HAS_CTX){
      const ctx = OFFDB.buildCtx(pos);
      let rows = await safeIDBGetJSON("where_all", OFFDB.keyWhere(ctx, productId));
      if (!Array.isArray(rows) || rows.length === 0){
        rows = await safeIDBGetJSON("where", OFFDB.keyWhere(ctx, productId));
      }
      if (!Array.isArray(rows) || rows.length === 0){
        rows = readWhereFromLSLoose(pos, productId);
      }
      log("getWhereRowsAll FALLBACK -> rows:", rows?.length||0);
      return Array.isArray(rows) ? rows : [];
    }
    const rows = readWhereFromLSLoose(pos, productId);
    log("getWhereRowsAll FALLBACK(LS) -> rows:", rows?.length||0);
    return Array.isArray(rows) ? rows : [];
  }
}

/* ===== WHERE rows (árbol local u offline) ===== */
async function getWhereRows(env, productId){
  const pos = env.services.pos;
  const HAS_CTX = OFFDB && typeof OFFDB.buildCtx === "function" && typeof OFFDB.keyWhere === "function";

  if (offlineLike()){
    if (HAS_CTX){
      const ctx = OFFDB.buildCtx(pos);
      let rows = await safeIDBGetJSON("where", OFFDB.keyWhere(ctx, productId));
      if (!Array.isArray(rows) || rows.length===0) rows = OFFDB?.readLSWhere?.(pos, productId) || [];
      log("getWhereRows OFFLINE -> rows:", rows?.length||0);
      return Array.isArray(rows) ? rows : [];
    }
    const snap = lsGet(baseKey(pos));
    const rows = snap?.byProduct?.[productId]?.where || [];
    log("getWhereRows OFFLINE(LS) -> rows:", rows?.length||0);
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
      if (rows.length && HAS_CTX){
        const ctx = OFFDB.buildCtx(pos);
        await safeIDBSetJSON("where", OFFDB.keyWhere(ctx, productId), rows);
      }
      log("getWhereRows ONLINE -> rows:", rows.length);
      return rows;
    }
    return [];
  }catch(e){
    warn("where_available RPC failed → offline fallback", e);
    if (HAS_CTX){
      const ctx = OFFDB.buildCtx(pos);
      let rows = await safeIDBGetJSON("where", OFFDB.keyWhere(ctx, productId));
      if (!Array.isArray(rows) || rows.length===0) rows = OFFDB?.readLSWhere?.(pos, productId) || [];
      log("getWhereRows FALLBACK -> rows:", rows?.length||0);
      return Array.isArray(rows) ? rows : [];
    }
    const snap = lsGet(baseKey(pos));
    const rows = snap?.byProduct?.[productId]?.where || [];
    log("getWhereRows FALLBACK(LS) -> rows:", rows?.length||0);
    return Array.isArray(rows) ? rows : [];
  }
}

/* ===== mezcla local + compañía para selector ===== */
async function getWhereRowsAny(env, productId){
  const a = await getWhereRows(env, productId);
  let b = [];
  try{ b = await getWhereRowsAll(env, productId); }
  catch(e){ warn("getWhereRowsAll lanzó; seguimos con local", e); }
  const seen = new Set();
  const out = [];
  for (const r of [...(a||[]), ...(b||[])]){
    const lid = Number(r?.location_id || r?.location?.id || r?.id);
    const key = Number.isFinite(lid) ? lid : Math.random();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  log("getWhereRowsAny -> local:", a?.length||0, "company:", b?.length||0, "merged:", out.length);
  return out;
}

/* ===================================================================== */
/* ===== reservas por ubicación (sesión) =============================== */
/* ===================================================================== */
function getDefaultSrcId(pos){
  const snap = lsGet(baseKey(pos)+"/allowed_locs");
  const root = snap && Number(snap.root);
  return Number.isFinite(root) ? root : null;
}
function ensureSessionMapByLoc(pos){
  if (!pos.__prsw_session_reserved_loc) pos.__prsw_session_reserved_loc = {};
  return pos.__prsw_session_reserved_loc;
}
function incReservedByLoc(pos, productId, locationId, delta){
  if (!Number.isFinite(delta) || !delta) return;
  const map = ensureSessionMapByLoc(pos);
  const pid = String(productId);
  const lid = String(locationId || "0");
  const byLoc = (map[pid] = map[pid] || {});
  byLoc[lid] = (Number(byLoc[lid]) || 0) + Number(delta);
  if (byLoc[lid] < 0) byLoc[lid] = 0;
}
function getSessionReservedInAllowed(pos, productId, allowedSet){
  const map = pos.__prsw_session_reserved_loc || {};
  const byLoc = map[String(productId)] || {};
  let total = 0;
  for (const [lidStr, q] of Object.entries(byLoc)){
    const lid = Number(lidStr);
    if (!allowedSet.size || allowedSet.has(lid)) total += Number(q || 0);
  }
  return total;
}

/* ===== overlay sesión (compat total y por ubicación) ===== */
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
  const mapTotal = {};
  const mapByLoc = {};
  const order = pos?.get_order?.() || pos?.selectedOrder || null;
  const defRoot = getDefaultSrcId(pos);

  if (order){
    const lines = order.get_orderlines?.() || [];
    for (const l of lines){
      const p   = l.get_product ? l.get_product() : l.product;
      const q   = (l.get_quantity ? Number(l.get_quantity()) : Number(l.qty||0)) || 0;
      const loc = l.pos_src_location_id || defRoot;
      if (p?.id && q > 0){
        mapTotal[p.id] = (mapTotal[p.id] || 0) + q;
        const pid = String(p.id);
        const lid = String(loc || "0");
        (mapByLoc[pid] ||= {});
        mapByLoc[pid][lid] = (Number(mapByLoc[pid][lid]) || 0) + q;
      }
    }
  }
  pos.__prsw_session_reserved     = mapTotal;  // compat total
  pos.__prsw_session_reserved_loc = mapByLoc;  // por ubicación
  return mapTotal;
}

/* ===== persistido offline ===== */
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

/* ===== avisos ===== */
function getSessionId(pos){
  return (
    (pos && pos.pos_session && pos.pos_session.id) ||
    (pos && pos.session && pos.session.id) ||
    (Array.isArray(pos?.config?.current_session_id) ? pos.config.current_session_id[0] : null) ||
    "0"
  );
}
const lowKey = (pos,pid)=> baseKey(pos)+"/low_ping/s"+String(getSessionId(pos))+"/"+String(pid);

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
  if (!snap){ should = true; }
  else{
    const elapsed = now - (snap.ts||0);
    const decreased = Number.isFinite(snap.rem) && remainingExact < snap.rem;
    should = LOW_STOCK_RESIGNAL_ON_DECREASE
      ? (decreased ? (cooldownMs ? elapsed >= cooldownMs : true) : elapsed >= cooldownMs)
      : elapsed >= cooldownMs;
  }

  if (should){
    env.services.notification?.add?.(
      _t("Stock bajo: quedan %s de %s", fmt(remainingExact), leaf(product.display_name || product.name))
    );
    lsSet(k, { ts: now, rem: remainingExact, v: 5 });
  }
}

/* ===== stock por fila ===== */
function rowOnHand(r){
  if (!r) return 0;

  if (Object.prototype.hasOwnProperty.call(r,"free_qty")){
    const v = Number(r.free_qty);
    return Number.isFinite(v) ? Math.max(v,0) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(r,"qty")){
    const v = Number(r.qty);
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

/* ===== selector sencillo (prompt) ===== */
async function openSelectionPrompt(title, list){
  const labels = list.map((it,i)=> `${i+1}) ${it.label}`).join("\n");
  const ans = window.prompt(`${title}\n\n${labels}\n\n${_t("Número")}:`);
  const idx = Number(ans) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return { confirmed:false };
  return { confirmed:true, payload:list[idx] };
}

/* ===== elegir ubicación alternativa + modo ===== */
async function offerAltSourceAndMode(env, product, qty){
  const allowedIds = (await getAllowedChildLocationIds(env)).map(Number).filter(Number.isFinite);
  const allowedSet = new Set(allowedIds);

  const rowsAny = await getWhereRowsAny(env, product.id);
  log("offerAltSourceAndMode rowsAny:", rowsAny.length, "allowedSet size:", allowedSet.size);

  const items = [];
  for (const r of rowsAny || []) {
    const lid = Number(r.location_id || r?.location?.id || r?.id);
    if (!Number.isFinite(lid)) continue;

    const freeEff = rowOnHand(r);
    if (freeEff > 0) {
      const isLocal = !allowedSet.size || allowedSet.has(lid);
      const tag = isLocal ? "" : " [OTRA TIENDA]";
      const label = `${locLabelFromRow(r, lid)} — ${_t("disp")}: ${fmt(freeEff)}${tag}`;
      items.push({ id: lid, label, item: { id: lid, name: locLabelFromRow(r, lid) } });
    }
  }

  if (!items.length){
    await env.services.popup.add(ConfirmPopup, {
      title: _t("Sin stock en otras ubicaciones"),
      body: _t("No hay ninguna ubicación con stock disponible (ni en caché offline)."),
      confirmText: _t("Aceptar"),
    });
    return null;
  }

  const selLoc  = await openSelectionPrompt(_t("Elige ubicación de origen"), items);
  if (!selLoc.confirmed) return null;
  const loc = selLoc.payload.item;

  const modeItems = [
    { id: "pickup", label: _t("Recogida en tienda"), item: "pickup" },
    { id: "ship",   label: _t("Envío a domicilio"), item: "ship"   },
  ];
  const selMode = await openSelectionPrompt(_t("Elige modo de envío"), modeItems);
  if (!selMode.confirmed) return null;
  const mode = selMode.payload.item;

  return { loc, mode, requireClient: mode === "ship" };
}

/* ===== popup “no hay stock → ¿enviar desde otro almacén?” ===== */
async function askShipFromOtherWarehouse(env, product, chk){
  const title = _t("Sin stock en el árbol del TPV");
  const body  = _t(
    "No hay stock de «%s».\nQuedan %s (permitido: %s − reservado en sesión: %s).\n\n¿Quieres vender enviando desde otra ubicación?",
    leaf(product.display_name || product.name),
    fmt(chk.remaining),
    fmt(chk.allowedOnHand),
    fmt(chk.reserved)
  );
  const res = await env.services.popup.add(ConfirmPopup, {
    title,
    body,
    confirmText: _t("Buscar en otras ubicaciones"),
    cancelText: _t("Cancelar"),
  });
  if (!res || !res.confirmed) return null;
  return offerAltSourceAndMode(env, product, 1);
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
  // *** CAMBIO CLAVE: reservas de sesión SOLO dentro del árbol permitido ***
  const reservedSessionExact   = getSessionReservedInAllowed(pos, product.id, allowedSet);
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

/* ===== persistir origen/modo en la línea ===== */
patch(Orderline.prototype, {
  setSourceLocation(loc) {
    this.pos_src_location_id = loc?.id || null;
  },
  setFulfillmentMode(mode) {
    this.pos_fulfillment_mode = mode || null;
  },
  export_as_JSON() {
    const json = super.export_as_JSON(...arguments);
    if (this.pos_src_location_id)   json.pos_src_location_id = this.pos_src_location_id;
    if (this.pos_fulfillment_mode)  json.pos_fulfillment_mode = this.pos_fulfillment_mode;
    return json;
  },
  init_from_JSON(json) {
    super.init_from_JSON(...arguments);
    this.pos_src_location_id  = json.pos_src_location_id  || null;
    this.pos_fulfillment_mode = json.pos_fulfillment_mode || null;
  },
});

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
          const alt = await askShipFromOtherWarehouse(this.env, product, chk);
          if (!alt) return;
          if (alt.requireClient) { this.showScreen("ClientListScreen"); return; }

          // *** pasamos la ubicación/modo elegidos como opciones para que add_product los use ***
          const pos = this.env.services.pos;
          const order = this.currentOrder || pos.get_order?.();
          pos.__prsw_skip_next_set_q = true;
          try{
            await order.add_product(product, {
              quantity: qty,
              __prsw_checked: true,
              __prsw_source_location_id: alt.loc?.id || null,
              __prsw_fulfillment_mode:  alt.mode || null,
            });
            // redundante por si algún flow externo no copia opciones:
            const line = order.get_selected_orderline();
            try{
              if (line){
                if (typeof line.setSourceLocation === "function") line.setSourceLocation(alt.loc);
                else line.pos_src_location_id = alt.loc?.id || null;
                if (typeof line.setFulfillmentMode === "function") line.setFulfillmentMode(alt.mode);
                else line.pos_fulfillment_mode = alt.mode || null;
              }
            }catch(e){ warn("set meta (ProductScreen) failed", e); }
          }finally{ pos.__prsw_skip_next_set_q = false; }
          return; // evita segunda alta
        }
        options.__prsw_checked = true;
      }catch(e){ warn("addProductToCurrentOrder guard failed; allowing add", e); }

      const pos = this.env.services.pos;
      pos.__prsw_skip_next_set_q   = true;
      pos.__prsw_skip_recheck_guard = true;
      try{ return await _addToOrder.call(this, product, options); }
      finally{
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

    if (!options.__prsw_checked && !this.pos.__prsw_skip_recheck_guard){
      try{
        const chk = await canAddProductNow(this.pos.env, product, qty, "PRE(Order)");
        if (!chk.ok){
          const alt = await askShipFromOtherWarehouse(this.pos.env, product, chk);
          if (!alt) return;
          if (alt.requireClient){
            await this.pos.env.services.popup.add(ConfirmPopup, {
              title: _t("Selecciona cliente"),
              body: _t("Para envío a domicilio asigna un cliente con dirección y vuelve a añadir el producto."),
              confirmText: _t("Aceptar"),
            });
            return;
          }
          // Pasamos ubicación/modo a la llamada original para que el flujo común los procese
          const res2 = await __orig_add_product__.apply(this, [product, {
            ...options,
            __prsw_checked: true,
            __prsw_source_location_id: alt.loc?.id || null,
            __prsw_fulfillment_mode:  alt.mode || null,
          }]);
          const line = this.get_selected_orderline();
          try{
            if (line){
              if (typeof line.setSourceLocation === "function") line.setSourceLocation(alt.loc);
              else line.pos_src_location_id = alt.loc?.id || null;
              if (typeof line.setFulfillmentMode === "function") line.setFulfillmentMode(alt.mode);
              else line.pos_fulfillment_mode = alt.mode || null;
            }
          }catch(e){ warn("set meta (Order) failed", e); }
          return res2; // evita re-entrada
        }
      }catch(e){ warn("Order.add_product guard failed; allowing add", e); }
    }

    const pos = this.pos;
    const prev = !!pos.__prsw_skip_next_set_q;
    pos.__prsw_skip_next_set_q = true;
    try{
      const res = await __orig_add_product__.apply(this, arguments);

      // *** INCLEMENTO DE RESERVA POR UBICACIÓN ***
      const line   = this.get_selected_orderline();
      const defRoot= getDefaultSrcId(pos);
      // prioridad: opción pasada desde ProductScreen > valor de la línea > raíz por defecto
      const optLoc = Number.isFinite(Number(options.__prsw_source_location_id))
        ? Number(options.__prsw_source_location_id) : null;
      const effLoc = optLoc || line?.pos_src_location_id || defRoot;

      // aplicar meta en línea si vino en options (por coherencia en tickets guardados)
      try{
        if (line){
          if (optLoc && !line.pos_src_location_id){
            if (typeof line.setSourceLocation === "function") line.setSourceLocation({ id: optLoc });
            else line.pos_src_location_id = optLoc;
          }
          if (options.__prsw_fulfillment_mode && !line.pos_fulfillment_mode){
            if (typeof line.setFulfillmentMode === "function") line.setFulfillmentMode(options.__prsw_fulfillment_mode);
            else line.pos_fulfillment_mode = options.__prsw_fulfillment_mode;
          }
        }
      }catch(e){ warn("apply meta from options failed", e); }

      if (product?.id && qty>0) {
        incReservedByLoc(pos, product.id, effLoc, qty);
        try{
          const chkAfter = await canAddProductNow(pos.env, product, 0, "AFTER");
          const remainingNow = Number(chkAfter.remainingExact);
          if (remainingNow === 0 && SHOW_LAST_UNIT_TOAST){
            pos.env.services.notification?.add?.(_t("Última unidad de %s", leaf(product.display_name || product.name)));
          }else if (remainingNow > 0 && remainingNow <= LOW_STOCK_THRESHOLD){
            maybeLowStockToast(pos.env, product, remainingNow);
          }
        }catch(e){ warn("post-add toast failed", e); }
      }
      return res;
    }finally{ pos.__prsw_skip_next_set_q = prev; }
  };
  Order.prototype.__prsw_add_product_patched__ = true;
}

/* ===== cantidad/borrado ===== */
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
        const defRoot = getDefaultSrcId(this.pos);
        const effLoc  = this.pos_src_location_id || defRoot;
        incReservedByLoc(this.pos, product.id, effLoc, delta);
        const pos = this.pos;
        const chk = await canAddProductNow(pos.env, product, 0, "AFTER_SETQ");
        const after = Number(chk.remainingExact);
        if (after === 0 && SHOW_LAST_UNIT_TOAST){
          pos.env.services.notification?.add?.(_t("Última unidad de %s", leaf(product.display_name || product.name)));
        }else if (after > 0 && after <= LOW_STOCK_THRESHOLD){
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
      const defRoot = getDefaultSrcId(this.pos);
      const effLoc  = line?.pos_src_location_id || defRoot;
      if (product?.id && qty>0) incReservedByLoc(this.pos, product.id, effLoc, -qty);
    }catch(e){ warn("remove_orderline overlay adjust failed", e); }
    return _rm.apply(this, arguments);
  };
  Order.prototype.__prsw_remove_line_patched__ = true;
}

/* ===== debug ===== */
window.__PRSW__ = { setReservedFromOrder, canAddProductNow, getAllowedChildLocationIds };
console.log("[pos_restrict_stock_wh] block_on_add loaded");
