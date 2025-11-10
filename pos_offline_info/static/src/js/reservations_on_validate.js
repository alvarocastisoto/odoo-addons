/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";

/*   storage  */
function baseKey(pos){
  const user = pos?.env?.services?.user;
  const db   = user?.context?.db || "";
  const cmp  = pos?.config?.company_id?.[0] || "0";
  const cfg  = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

function isOfflineLike(){
  return !navigator.onLine || window.__pos_rpc_down__ === true;
}

function buildAccFromOrder(pos, order){
  const acc = {}; // { pid: { lid: qty } }
  if (!order) return acc;

  const defaultLoc = pos?.config?.stock_location_id?.[0] || null;
  const lines = order.get_orderlines?.() || [];
  for (const l of lines){
    const p   = l.get_product ? l.get_product() : l.product;
    const qty = (l.get_quantity ? l.get_quantity() : l.qty) || 0;
    if (!p?.id || !qty) continue;

    const chosenLoc = (l.getPosSourceLocationId && l.getPosSourceLocationId()) || defaultLoc;
    if (!chosenLoc) continue;

    const pid = String(p.id);
    const lid = String(chosenLoc);
    if (!acc[pid]) acc[pid] = {};
    acc[pid][lid] = (Number(acc[pid][lid]) || 0) + Number(qty);
  }
  return acc;
}

function persistReservationsDelta(pos, deltaByPid){
  const keyPersist = baseKey(pos) + "/reservations_persisted";
  const snap = lsGet(keyPersist) || {}; // { pid: { lid: qty } }

  for (const [pid, byLoc] of Object.entries(deltaByPid)){
    snap[pid] = snap[pid] || {};
    for (const [lid, q] of Object.entries(byLoc)){
      snap[pid][lid] = (Number(snap[pid][lid]) || 0) + Number(q || 0);
    }
  }
  lsSet(keyPersist, snap);

  try {
    pos.trigger?.("pos_offline_reservations_changed");
  } catch {}

  try { console.log("[pos_offline_info] reservas_persisted =", snap); } catch {}
}

const _finalize = PaymentScreen.prototype._finalizeValidation;

patch(PaymentScreen.prototype, {
  async _finalizeValidation(){
    const pos = this.env.services.pos;

    const shouldSnapshot = isOfflineLike();
    const order = pos?.get_order?.();
    const delta = shouldSnapshot ? buildAccFromOrder(pos, order) : null;

    let res;
    try {
      res = await _finalize.apply(this, arguments);
    } finally {
      if (delta && isOfflineLike()) {
        persistReservationsDelta(pos, delta);
      }
    }
    return res;
  },
});
