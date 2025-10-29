/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";

function storageKey(pos){
  const user = pos?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

function addReservationsForOrder(pos, order){
  if (!order) return;
  const key = storageKey(pos) + "/reservations";
  const R = lsGet(key) || {}; // { productId: qty }

  const lines = order.get_orderlines ? order.get_orderlines() : [];
  for (const line of lines) {
    const prod = line.get_product ? line.get_product() : line.product;
    const qty  = (line.get_quantity ? line.get_quantity() : line.qty) || 0;
    if (prod?.id && qty) R[prod.id] = (Number(R[prod.id]) || 0) + Number(qty);
  }
  lsSet(key, R);
}

const _finalize = PaymentScreen.prototype._finalizeValidation;
patch(PaymentScreen.prototype, {
  async _finalizeValidation() {
    const res = await _finalize.apply(this, arguments);
    try {
      if (!navigator.onLine) {
        const pos = this.env.services.pos;
        const order = pos?.get_order?.();
        addReservationsForOrder(pos, order);
      }
    } catch(e) {
      console.debug("[pos_offline_info] reservations_on_validate fallback:", e);
    }
    return res;
  },
});
