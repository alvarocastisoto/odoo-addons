/** @odoo-module **/
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { Order, Orderline } from "@point_of_sale/app/store/models";

function recomputeReservations(pos) {
  const map = {};
  const orders = pos.get_order_list?.() || pos.get_orders?.() || [];
  for (const o of orders) {
    const lines = o.get_orderlines?.() || [];
    for (const l of lines) {
      const p = l.get_product ? l.get_product() : l.product;
      const q = l.get_quantity ? l.get_quantity() : l.qty;
      const pid = p?.id;
      if (!pid) continue;
      map[pid] = (map[pid] || 0) + (Number(q) || 0);
    }
  }
  pos.sessionReserved = map;
  try { pos.trigger?.("pos_offline_reservations_changed"); } catch {}
}

const _add = Order.prototype.add_product;
Order.prototype.add_product = function (product, options) {
  const r = _add.apply(this, arguments);
  try { recomputeReservations(this.pos); } catch {}
  return r;
};

const _rm = Order.prototype.remove_orderline;
Order.prototype.remove_orderline = function (line) {
  const r = _rm.apply(this, arguments);
  try { recomputeReservations(this.pos); } catch {}
  return r;
};

const _setQ = Orderline.prototype.set_quantity;
Orderline.prototype.set_quantity = function (q, keep_price) {
  const r = _setQ.apply(this, arguments);
  try { recomputeReservations(this.pos); } catch {}
  return r;
};

// Inicializa el mapa en el arranque del POS
const _setup = PosStore.prototype.setup;
PosStore.prototype.setup = async function () {
  const res = await _setup.apply(this, arguments);
  try { recomputeReservations(this); } catch {}
  return res;
};
