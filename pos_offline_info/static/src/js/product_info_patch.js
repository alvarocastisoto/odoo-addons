/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { onMounted, onWillUpdateProps, onWillUnmount, useState } from "@odoo/owl";
import { ProductInfoPopup } from "@point_of_sale/app/screens/product_screen/product_info_popup/product_info_popup";
import { cache, buildCtx, keyWhere, readLSWhere } from "./cache_indexeddb";

const _setup = ProductInfoPopup.prototype.setup;

/*  switches  */
const SHOW_ROOT_AS_CHILD = true;
const ROOT_LABEL         = "Stock";
const HIDE_ODOO_SUMMARY  = true;

/*  helpers */
const leafName = (r)=>{
  const base = (r?.path || r?.display_name || r?.complete_name || "") + "";
  const p = base.split("/").filter(Boolean);
  return p.length ? p.at(-1) : base || (r?.location_id ? `Loc ${r.location_id}` : "Ubicación");
};
const qtyOf = (r)=>{
  const n = Number(
    r?.qty ??
    r?.available_quantity ??
    r?.on_hand ??
    r?.quantity_available ??
    r?.free_qty ?? 0
  );
  return Number.isFinite(n) ? n : 0;
};
const fmt = (pos, n)=>{ const v = Number(n)||0; try{ return pos?.formatFloat ? pos.formatFloat(v) : v.toFixed(2);}catch{ return v.toFixed(2);} };

/* ===== overlay reservas ===== */
function baseKey(pos){
  const user = pos?.env?.services?.user;
  const db   = user?.context?.db || "";
  const cmp  = pos?.config?.company_id?.[0] || "0";
  const cfg  = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } };

function getPersistedReservationsByLoc(pos){
  const B = baseKey(pos);
  const A = lsGet(B + "/reservations_persisted") || {};
  const L = lsGet(B + "/reservations") || {};
  const out = {};
  const merge=(src)=>{ for (const [pid, byLoc] of Object.entries(src||{})){
    out[pid] = out[pid] || {};
    for (const [lid,q] of Object.entries(byLoc||{})){
      out[pid][lid] = (Number(out[pid][lid])||0) + Number(q||0);
    }
  }}; merge(A); merge(L);
  return out;
}
function getSessionReservationsByLoc(pos){
  const byPid = {};
  const orders = pos.get_order_list?.() || pos.get_orders?.() || [];
  const defLoc = pos?.config?.stock_location_id?.[0] || null;
  for (const o of orders){
    for (const l of (o.get_orderlines?.() || [])){
      const p = l.get_product ? l.get_product() : l.product;
      const q = (l.get_quantity ? l.get_quantity() : l.qty) || 0;
      if (!p?.id || !q) continue;
      const chosen = (l.getPosSourceLocationId && l.getPosSourceLocationId()) || defLoc;
      if (!chosen) continue;
      const pid = String(p.id), lid = String(chosen);
      byPid[pid] = byPid[pid] || {};
      byPid[pid][lid] = (Number(byPid[pid][lid])||0) + Number(q);
    }
  }
  return byPid;
}
function applyOverlay(pos, productId, rows){
  if (!Array.isArray(rows) || !productId) return rows || [];
  const pid  = String(productId);
  const sess = getSessionReservationsByLoc(pos)[pid]   || {};
  const pers = getPersistedReservationsByLoc(pos)[pid] || {};
  const deltas = {};
  for (const k in sess) deltas[k] = (deltas[k]||0) + Number(sess[k]||0);
  for (const k in pers) deltas[k] = (deltas[k]||0) + Number(pers[k]||0);
  if (!Object.keys(deltas).length) return rows;

  return rows.map((r)=>{
    const lid  = String(r?.location_id ?? r?.location?.id ?? r?.id ?? "");
    const base = qtyOf(r);
    const fRaw = (r?.forecasted_quantity ?? r?.forecasted);
    const fBase= Number(fRaw != null ? fRaw : base);
    const sub  = Number(deltas[lid]||0);
    const onh  = Math.max(0, base - sub);
    const fct  = Math.max(0, fBase - sub);
    return { ...r, qty:onh, available_quantity:onh, on_hand:onh, forecasted_quantity:fct, forecasted:fct };
  });
}

/*  agrupación  */
function groupByWarehouse(rows = []) {
  const m = new Map();
  for (const r of rows) {
    const wh = (
      r?.warehouse_name ||
      (r?.complete_name || "").split("/", 1)[0] ||
      "Almacén"
    ).trim();
    const q = qtyOf(r);
    const isRoot = !r?.path || String(r.path).trim() === "";

    if (!m.has(wh)) m.set(wh, { name: wh, total: 0, children: [] });
    const g = m.get(wh);

    g.total += q;
    if (isRoot) {
      if (SHOW_ROOT_AS_CHILD && q > 0) g.children.push({ name: ROOT_LABEL, qty: q });
    } else if (q > 0) {
      g.children.push({ name: leafName(r), qty: q });
    }
  }
  const out = [...m.values()];
  for (const g of out) g.children.sort((a,b)=>a.name.localeCompare(b.name));
  out.sort((a,b)=>(b.total-a.total)||a.name.localeCompare(b.name));
  return out;
}

/*  DOM  */
const norm = (s)=> (s||"").toString().normalize("NFD").replace(/\p{Diacritic}/gu,"").trim().toLowerCase();

function findByTextAnyTag(root, needles){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  while (w.nextNode()){
    const el = w.currentNode;
    const t  = norm(el.textContent);
    if (needles.has(t)) return el;
  }
  return null;
}
function findInventoryAnchor(modal){
  const invSet = new Set(["inventario","inventory"]);
  const headers = modal.querySelectorAll("h1,h2,h3,h4,h5,h6");
  for (const h of headers){ if (invSet.has(norm(h.textContent))) return h; }
  const exact = findByTextAnyTag(modal, invSet);
  if (exact) return exact;
  const keys = ["unidades disponible","units available","on hand","forecast","pronosticado"];
  const w = document.createTreeWalker(modal, NodeFilter.SHOW_ELEMENT, null);
  while (w.nextNode()){
    const t = norm(w.currentNode.textContent);
    if (keys.some(k=>t.includes(k))) return w.currentNode;
  }
  return null;
}
function findAltAnchors(modal){
  const repSet = new Set(["reposicion","replenishment"]);
  const ordSet = new Set(["pedir","order"]);
  const rep = findByTextAnyTag(modal, repSet);
  const ord = findByTextAnyTag(modal, ordSet);
  return { rep, ord };
}
function ensureContainer(modal){
  let c = modal.querySelector("#pos_inv_tree") || document.getElementById("pos_inv_tree");
  if (!c) { c = document.createElement("div"); c.id = "pos_inv_tree"; }
  c.style.marginTop = "6px";
  c.style.width = "100%";
  return c;
}

/*  ocultación del resumen original  */
function hideNativeInventory(modal, anchorInv, cont, nextSection){
  if (!HIDE_ODOO_SUMMARY || !modal || !anchorInv) return;

  // ocultar todos los hermanos DESPUÉS de nuestro contenedor hasta el siguiente encabezado
  let n = cont.nextSibling;
  while (n && n !== nextSection){
    const next = n.nextSibling;
    if (n.nodeType === 1 /* elemento */ && !cont.contains(n)){
      n.style.display = "none";
    }
    n = next;
  }
}

/*  render  */
function renderTree(modal, groups, pos){
  if (!modal) return false;
  const cont = ensureContainer(modal);

  let html;
  if (!groups?.length){
    html = `<em style="opacity:.7;">Sin stock en almacenes internos.</em>`;
  } else {
    html = `<ul class="list-unstyled mb-0">` +
      groups.map(g => (
        `<li class="mb-1">
           <div class="d-flex justify-content-between fw-semibold">
             <span>${g.name}</span><span>${fmt(pos, g.total)}</span>
           </div>
           <ul class="list-unstyled ms-3 mb-0">
             ${g.children.map(c => (
               `<li class="d-flex justify-content-between">
                  <span>— ${c.name}</span><span>${fmt(pos, c.qty)}</span>
                </li>`
             )).join("")}
           </ul>
         </li>`
      )).join("") +
      `</ul>`;
  }
  if (cont.dataset.hash !== html){ cont.innerHTML = html; cont.dataset.hash = html; }

  // anclajes
  const anchorInv = findInventoryAnchor(modal);
  const { rep, ord } = findAltAnchors(modal);
  const nextSection = rep || ord || null;

  // colocación
  if (anchorInv){
    anchorInv.after(cont);
  } else if (nextSection && nextSection.parentNode){
    nextSection.parentNode.insertBefore(cont, nextSection);
  } else {
    modal.appendChild(cont);
  }

  // bloquear/ocultar el inventario nativo
  hideNativeInventory(modal, anchorInv || modal, cont, nextSection);

  return true;
}


/*  PATCH  */
patch(ProductInfoPopup.prototype, {
  setup(){
    _setup && _setup.apply(this, arguments);
    const pos = this.env.services.pos;
    this.whereState = this.whereState || useState({ groups: [], productId: null, rev: 0 });

    const recomputeFromCacheAndOverlay = async (productId, modalRoot)=>{
      const ctx = buildCtx(pos);
      let rows = await cache.getJSON("where", keyWhere(ctx, productId));
      if (!Array.isArray(rows) || !rows.length){
        const ls = readLSWhere(pos, productId);
        if (Array.isArray(ls) && ls.length) rows = ls;
      }
      rows = applyOverlay(pos, productId, rows||[]);
      const groups = groupByWarehouse(rows);
      this.whereState.groups = groups;
      this.whereState.productId = productId;
      this.whereState.rev++;
      renderTree(modalRoot, groups, pos);
    };

    const fetchAndRender = async (productId, modalRoot)=>{
      const ctx = buildCtx(pos);
      let rows = [];
      if (navigator.onLine && !window.__pos_rpc_down__){
        try{
          rows = await this.env.services.orm.call("product.product","pos_where",[productId, pos.config.id],{}) || [];
          window.__pos_rpc_down__ = false;
          try{ await cache.setJSON("where", keyWhere(ctx, productId), rows); }catch{}
        }catch{
          window.__pos_rpc_down__ = true;
        }
      }
      if (!Array.isArray(rows) || !rows.length){
        rows = await cache.getJSON("where", keyWhere(ctx, productId)) || readLSWhere(pos, productId) || [];
      }
      rows = applyOverlay(pos, productId, rows||[]);
      const groups = groupByWarehouse(rows);
      this.whereState.groups = groups;
      this.whereState.productId = productId;
      this.whereState.rev++;

      const tries = [0, 120, 280, 600, 1200, 2000];
      for (let i=0;i<tries.length;i++){
        if (tries[i]) await new Promise(r=>setTimeout(r, tries[i]));
        const modalOk = (this.el && (this.el.closest(".modal-content") || this.el)) || this.el || document.body;
        if (renderTree(modalOk, groups, pos)) break;
      }
    };

    const busCb = async ()=>{
      const modalRoot = (this.el && (this.el.closest(".modal-content") || this.el)) || this.el || document.body;
      if (this.whereState.productId) await recomputeFromCacheAndOverlay(this.whereState.productId, modalRoot);
    };

    if (pos?.on && !this.__pos_offline_overlay_bus__){
      pos.on("pos_offline_reservations_changed", this, busCb);
      this.__pos_offline_overlay_bus__ = ()=>{ try{ pos.off("pos_offline_reservations_changed", this, busCb); }catch{} };
    }

    onMounted(async ()=>{
      const stray = document.getElementById("pos_inv_tree");
      if (stray && this.el && !this.el.contains(stray)) stray.remove();

      const modalRoot = (this.el && (this.el.closest(".modal-content") || this.el)) || this.el || document.body;
      const p = this.props?.product;
      if (p?.id) await fetchAndRender(p.id, modalRoot);
      this.__where_refresh_timer__ = setInterval(()=>{ try{ busCb(); }catch{} }, 1000);
    });

    onWillUpdateProps(async (next)=>{
      const modalRoot = (this.el && (this.el.closest(".modal-content") || this.el)) || this.el || document.body;
      const p = next?.product;
      if (p?.id && p.id !== this.whereState.productId) await fetchAndRender(p.id, modalRoot);
    });

    onWillUnmount(()=>{
      if (this.__where_refresh_timer__){ clearInterval(this.__where_refresh_timer__); this.__where_refresh_timer__ = null; }
      if (this.__pos_offline_overlay_bus__){ this.__pos_offline_overlay_bus__(); this.__pos_offline_overlay_bus__ = null; }
      const old = document.getElementById("pos_inv_tree"); if (old) old.remove();
    });
  },
});
