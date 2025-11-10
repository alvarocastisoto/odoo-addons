/** @odoo-module **/
import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { Orderline } from "@point_of_sale/app/store/models";
import { SelectionPopup } from "@point_of_sale/app/utils/input_popups/selection_popup";
import { cache, buildCtx, keyWhere, readLSWhere } from "./cache_indexeddb";
import { readAllowedFromCache } from "./allowed_locations_cache";

const SHOW_QTY_IN_SELECTOR = false;
const LABEL_QTY = "disponible";

const locId = (r) => r?.location_id ?? r?.location?.id ?? r?.id ?? null;
function leafName(row) {
  const base = (row && (row.path || row.display_name || row.complete_name || "")) || "";
  const parts = String(base).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : base || (row?.location_id ? `Loc ${row.location_id}` : "Ubicación");
}
function fmtQty(q, pos) {
  const n = Number(q);
  try { return pos?.formatFloat ? pos.formatFloat(n) : (Number.isFinite(n) ? n.toFixed(2) : "0.00"); }
  catch { return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
}
function rowOnHand(r) {
  const n = Number(
    r?.qty ?? r?.available_quantity ?? r?.available_qty ?? r?.on_hand ??
    r?.qty_available ?? r?.free_qty ?? r?.quantity_available ??
    r?.quantity ?? r?.atp ?? r?.available_to_promise ?? 0
  );
  return Number.isFinite(n) ? n : 0;
}

async function getWhereRows(env, productId) {
  const pos = env.services.pos;
  const ctx = buildCtx(pos);
  let rows = await cache.getJSON("where", keyWhere(ctx, productId));
  if (!Array.isArray(rows) || rows.length === 0) {
    const ls = readLSWhere(pos, productId);
    if (Array.isArray(ls) && ls.length) rows = ls;
  }
  if ((!rows || rows.length === 0) && navigator.onLine) {
    try {
      const serverRows = await env.services.orm.call("product.product", "pos_where", [productId, pos.config.id], {});
      rows = Array.isArray(serverRows) ? serverRows : [];
      await cache.setJSON("where", keyWhere(ctx, productId), rows);
      window.__pos_rpc_down__ = false;
    } catch {
      window.__pos_rpc_down__ = true;
      rows = rows || [];
    }
  }
  return rows || [];
}

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

registry.category("services").add("pos_choose_location_on_validate", {
  dependencies: ["pos", "popup", "user"],
  start(env) {
    const pos = env.services.pos;

    // Inyecta el id elegido en el payload antes de enviar al backend
    if (!pos.__pos_src_inject_wrapped__) {
      const origSave = pos._save_to_server.bind(pos);
      pos._save_to_server = async function (orders, options) {
        try {
          for (const o of orders || []) {
            for (const cmd of o?.data?.lines || []) {
              if (Array.isArray(cmd) && cmd[2]) {
                const payload = cmd[2];
                const cid = payload.cid ?? payload.uid ?? payload.id ?? null;
                const chosen = this.__SRC_LOC_BY_CID__?.get?.(cid);
                if (chosen && payload.pos_src_location_id == null) payload.pos_src_location_id = chosen;
              }
            }
          }
        } catch (e) { console.warn("[pos_offline_info] inject-before-push failed", e); }
        return await origSave(orders, options);
      };
      pos.__pos_src_inject_wrapped__ = true;
      pos.__SRC_LOC_BY_CID__ = new Map();
    }

    const prev = PaymentScreen.prototype.validateOrder;
    if (!prev || prev.__pos_choose_loc_wrapped__) return {};

    patch(PaymentScreen.prototype, {
      async validateOrder(isForceValidate) {
        const order = env.services.pos.get_order?.();

        const allowed = readAllowedFromCache(env.services.pos);
        const defaultRootId = allowed.root || null;
        const allowedSet = new Set(allowed.children || []);

        if (order?.get_orderlines) {
          for (const line of order.get_orderlines()) {
            if (line.getPosSourceLocationId?.()) continue;

            const prod = line.get_product ? line.get_product() : line.product;
            if (!prod) continue;

            const rows = await getWhereRows(env, prod.id);
            const map = new Map();
            for (const r of rows) {
              const id = locId(r);
              if (!id) continue;
              if (!map.has(id)) map.set(id, { id, leaf: leafName(r), onh: rowOnHand(r) });
            }

            let options = Array.from(map.values());
            if (allowedSet.size) options = options.filter(o => allowedSet.has(o.id));


            if (!options.length && defaultRootId) {
              line.setPosSourceLocationId(defaultRootId);
              continue;
            }

            if (options.length <= 1) {
              if (options.length === 1) line.setPosSourceLocationId(options[0].id);
              continue;
            }

            options.sort((a, b) => (b.onh - a.onh) || a.leaf.localeCompare(b.leaf));
            const fmt = (n) => fmtQty(n, env.services.pos);
            const list = options.map(o => ({
              id: o.id,
              label: SHOW_QTY_IN_SELECTOR ? `${o.leaf} — ${LABEL_QTY}: ${fmt(o.onh)}` : o.leaf,
              item: o,
            }));

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
            if (cid) env.services.pos.__SRC_LOC_BY_CID__.set(cid, chosenId);
          }
        }

        return await prev.apply(this, arguments);
      },
    });

    PaymentScreen.prototype.validateOrder.__pos_choose_loc_wrapped__ = true;
    return {};
  },
});
