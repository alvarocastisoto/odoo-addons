/** @odoo-module **/

import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { Orderline } from "@point_of_sale/app/store/models";
import { SelectionPopup } from "@point_of_sale/app/utils/input_popups/selection_popup";

console.log("[pos_offline_info] choose_location_on_validate LOADED");

const SHOW_QTY_IN_SELECTOR = false;
const LABEL_QTY = "disponible";

function storageKey(pos){
  const user = pos?.env?.services?.user;
  const db  = user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };

const locId = (r)=> r?.location_id ?? r?.location?.id ?? r?.id ?? null;

function leafName(row) {
  const base = (row && (row.path || row.display_name || row.complete_name || "")) || "";
  const parts = String(base).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : base || (row?.location_id ? `Loc ${row.location_id}` : "Ubicación");
}

function lastTwoSeg(row) {
  const parts = String(row?.path || row?.display_name || row?.complete_name || "").split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(-2).join("/") : (parts[0] || "Ubicación");
}

function fmtQty(q, pos){
  const n = Number(q);
  try { return pos && pos.formatFloat ? pos.formatFloat(n) : (Number.isFinite(n) ? n.toFixed(2) : "0.00"); }
  catch { return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
}

function rowOnHand(r){
  const n = Number(
    r?.qty ?? r?.available_quantity ?? r?.available_qty ?? r?.on_hand ??
    r?.qty_available ?? r?.free_qty ?? r?.quantity_available ??
    r?.quantity ?? r?.atp ?? r?.available_to_promise ?? 0
  );
  return Number.isFinite(n) ? n : 0;
}

const SRC_LOC_BY_CID = new Map();
window.__pos_src_dump = () => Array.from(SRC_LOC_BY_CID.entries());
window.__pos_src_get_by_cid = (cid) => SRC_LOC_BY_CID.get(cid);
window.__pos_src_clear = () => SRC_LOC_BY_CID.clear();

const _exportAsJSON = Orderline.prototype.export_as_JSON;
const _initFromJSON = Orderline.prototype.init_from_JSON;

patch(Orderline.prototype, {
  setPosSourceLocationId(locId) { this.pos_src_location_id = locId || null; },
  getPosSourceLocationId() { return this.pos_src_location_id || null; },
  export_as_JSON() {
    const json = _exportAsJSON ? _exportAsJSON.apply(this, arguments) : {};
    json.cid = json.cid || this.cid || this.uid || this.id || null;
    if (this.pos_src_location_id != null) json.pos_src_location_id = this.pos_src_location_id;
    return json;
  },
  init_from_JSON(json) {
    const res = _initFromJSON ? _initFromJSON.apply(this, arguments) : undefined;
    this.pos_src_location_id = json?.pos_src_location_id || null;
    return res;
  },
});
Orderline.prototype.export_as_JSON.__pos_src_loc_patched__ = true;

registry.category("services").add("pos_choose_location_on_validate", {
  dependencies: ["pos", "popup", "user"],
  start(env) {
    const pos = env.services.pos;

    if (!pos.__pos_src_inject_wrapped__) {
      const origSave = pos._save_to_server.bind(pos);
      pos._save_to_server = async function (orders, options) {
        try {
          for (const o of orders || []) {
            for (const cmd of o?.data?.lines || []) {
              if (Array.isArray(cmd) && cmd[2]) {
                const payload = cmd[2];
                const cid = payload.cid ?? payload.uid ?? payload.id ?? null;
                const chosen = SRC_LOC_BY_CID.get(cid);
                if (chosen && payload.pos_src_location_id == null) {
                  payload.pos_src_location_id = chosen;
                }
              }
            }
          }
          console.log("[pos_offline_info] inject-before-push: OK");
        } catch (e) {
          console.warn("[pos_offline_info] inject-before-push failed", e);
        }
        return await origSave(orders, options);
      };
      pos.__pos_src_inject_wrapped__ = true;
    }

    const prev = PaymentScreen.prototype.validateOrder;
    if (!prev || prev.__pos_choose_loc_wrapped__) return {};

    patch(PaymentScreen.prototype, {
      async validateOrder(isForceValidate) {
        const key = storageKey(env.services.pos);
        const snap = lsGet(key) || { byProduct:{}, ts:0, version:1 };
        const cfgStockLocId = env.services.pos?.config?.stock_location_id?.[0] || null;

        const order = env.services.pos.get_order?.();
        if (order?.get_orderlines) {
          for (const line of order.get_orderlines()) {
            if (line.getPosSourceLocationId?.()) continue;

            const prod = line.get_product ? line.get_product() : line.product;
            if (!prod) continue;

            const rows = Array.isArray(snap.byProduct?.[prod.id]?.where)
              ? snap.byProduct[prod.id].where
              : [];

            const map = new Map();
            for (const r of rows) {
              const id = locId(r);
              if (!id) continue;
              if (!map.has(id)) {
                map.set(id, { id, leaf: leafName(r), onh: rowOnHand(r), row: r });
              }
            }
            let options = Array.from(map.values());

            if (!options.length && cfgStockLocId) {
              options.push({ id: cfgStockLocId, leaf: "defecto", onh: 0 });
            }

            if (options.length <= 1) {
              if (options.length === 1) line.setPosSourceLocationId(options[0].id);
              continue;
            }

            options.sort((a,b) => (b.onh - a.onh) || a.leaf.localeCompare(b.leaf));

            const counts = options.reduce((acc, o) => (acc[o.leaf] = (acc[o.leaf] || 0) + 1, acc), {});
            const fmt = (n) => fmtQty(n, env.services.pos);
            const list = options.map(o => {
              const base = counts[o.leaf] > 1 ? lastTwoSeg(o.row) : o.leaf;
              return {
                id: o.id,
                label: SHOW_QTY_IN_SELECTOR ? `${base} — ${LABEL_QTY}: ${fmt(o.onh)}` : base,
                item: o,
              };
            });

            const { confirmed, payload } = await env.services.popup.add(SelectionPopup, {
              title: `Elegir ubicación para ${prod.display_name}`,
              body: "Selecciona desde qué ubicación descontar esta línea.",
              list,
              confirmText: "Usar ubicación",
              cancelText: "Cancelar",
            });
            if (!confirmed) return;

            const chosenId = payload.id;
            line.setPosSourceLocationId?.(chosenId);
            const cid = line.cid ?? line.uid ?? line.id ?? null;
            if (cid) {
              SRC_LOC_BY_CID.set(cid, chosenId);
              console.log(`[pos_offline_info] línea ${cid} → pos_src_location_id = ${chosenId}`);
            }
          }
        }

        return await prev.apply(this, arguments);
      },
    });

    PaymentScreen.prototype.validateOrder.__pos_choose_loc_wrapped__ = true;
    console.log("[pos_offline_info] choose_location_on_validate: PATCH ACTIVE");
    return {};
  },
});
