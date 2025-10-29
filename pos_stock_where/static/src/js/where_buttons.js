/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { onMounted, onWillUpdateProps, useState } from "@odoo/owl";
import { ProductInfoPopup } from "@point_of_sale/app/screens/product_screen/product_info_popup/product_info_popup";

const originalSetup = ProductInfoPopup.prototype.setup;

function storageKey(env, posSvc) {
  const user = env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = posSvc?.config?.company_id?.[0] || "0";
  const cfg = posSvc?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} }
function lsSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

patch(ProductInfoPopup.prototype, {
  setup() {
    originalSetup && originalSetup.apply(this, arguments);

    this.whereState = this.whereState || useState({ rows: [], productId: null });

    const orm = useService("orm");
    const posSvc = useService("pos");
    const key = storageKey(this.env, posSvc);

    const readCachedWhere = (pid) => (lsGet(key)?.byProduct?.[pid]?.where) || null;
    const writeCachedWhere = (pid, rows) => {
      const snap = lsGet(key) || { byProduct: {}, ts: 0, version: 1 };
      const prev = snap.byProduct[pid] || {};
      snap.byProduct[pid] = { ...prev, where: Array.isArray(rows) ? rows : [] };
      snap.ts = Date.now();
      lsSet(key, snap);
    };


    this.prettyName = (r) => {
        // Prioriza el path relativo al almacén (si viene), si no usa complete_name
        const base = (r && (r.path || r.display_name || r.complete_name || "")) || "";
        const parts = String(base).split("/").filter(Boolean);
        return parts.length ? parts[parts.length - 1] : base || ("Ubicación " + (r.location_id || ""));
        };

        this.fmtQty = (q) => {
        const n = Number(q);
        // Usa formateador del POS si está disponible, si no, toFixed(2)
        try {
            const pos = this.env?.services?.pos;
            return pos && pos.formatFloat ? pos.formatFloat(n) : (Number.isFinite(n) ? n.toFixed(2) : "0.00");
        } catch {
            return Number.isFinite(n) ? n.toFixed(2) : "0.00";
        }
        };
    const loadWhere = async (product) => {
      if (!product) return;

      if (navigator.onLine) {
        try {
          const rows = await orm.call(
            "product.product",
            "pos_where",
            [product.id, posSvc.config.id],
            {}
          );
          this.whereState.rows = Array.isArray(rows) ? rows : [];
          this.whereState.productId = product.id;
          writeCachedWhere(product.id, this.whereState.rows);
          console.log("[pos_stock_where] where ONLINE ok:", product.id, this.whereState.rows.length);
          return;
        } catch (e) {
          console.warn("[pos_stock_where] RPC failed, fallback to cache:", e);
        }
      }

      const cached = readCachedWhere(product.id);
      this.whereState.rows = Array.isArray(cached) ? cached : [];
      this.whereState.productId = product.id;
      console.log("[pos_stock_where] where OFFLINE cache:", product.id, this.whereState.rows.length);
    };

    onMounted(async () => {
      console.log("[pos_stock_where] where_buttons.js loaded");
      if (this.props?.product) await loadWhere(this.props.product);
    });

    onWillUpdateProps(async (nextProps) => {
      if (nextProps?.product && nextProps.product.id !== this.whereState.productId) {
        await loadWhere(nextProps.product);
      }
    });
  },
});
