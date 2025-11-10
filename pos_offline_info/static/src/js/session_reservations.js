/** @odoo-module **/
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { Order, Orderline } from "@point_of_sale/app/store/models";

function recomputeReservationsPerLoc(pos) {
  const byPid = {};
  const orders = pos.get_order_list?.() || pos.get_orders?.() || [];
  const defaultLoc = pos?.config?.stock_location_id?.[0] || null;

  for (const o of orders) {
    const lines = o.get_orderlines?.() || [];
    for (const l of lines) {
      const p   = l.get_product ? l.get_product() : l.product;
      const qty = (l.get_quantity ? l.get_quantity() : l.qty) || 0;
      if (!p?.id || !qty) continue;

      const chosenLoc = (l.getPosSourceLocationId && l.getPosSourceLocationId()) || defaultLoc;
      if (!chosenLoc) continue;

      const pid = String(p.id);
      const lid = String(chosenLoc);
      if (!byPid[pid]) byPid[pid] = {};
      byPid[pid][lid] = (Number(byPid[pid][lid]) || 0) + Number(qty);
    }
  }
  pos.sessionReserved = byPid;
  try { pos.trigger?.("pos_offline_reservations_changed"); } catch {}
}

const _add = Order.prototype.add_product;
Order.prototype.add_product = function (product, options) {
  const r = _add.apply(this, arguments);
  try { recomputeReservationsPerLoc(this.pos); } catch {}
  return r;
};

const _rm = Order.prototype.remove_orderline;
Order.prototype.remove_orderline = function (line) {
  const r = _rm.apply(this, arguments);
  try { recomputeReservationsPerLoc(this.pos); } catch {}
  return r;
};

const _setQ = Orderline.prototype.set_quantity;
Orderline.prototype.set_quantity = function (q, keep_price) {
  const r = _setQ.apply(this, arguments);
  try { recomputeReservationsPerLoc(this.pos); } catch {}
  return r;
};

const _setup = PosStore.prototype.setup;
PosStore.prototype.setup = async function () {
  const res = await _setup.apply(this, arguments);
  try { recomputeReservationsPerLoc(this); } catch {}
  return res;
};
