/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { onMounted, onWillUnmount } from "@odoo/owl";
import { ProductInfoPopup } from "@point_of_sale/app/screens/product_screen/product_info_popup/product_info_popup";

const originalSetup = ProductInfoPopup.prototype.setup;

// Helpers de presentación (no modifican estado)
function prettyName(r){
  const base = (r && (r.path || r.display_name || r.complete_name || "")) || "";
  const parts = String(base).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : base || ("Ubicación " + (r.location_id || ""));
}
function fmtQtyGeneric(pos, q){
  const n = Number(q);
  try { return pos && pos.formatFloat ? pos.formatFloat(n) : (Number.isFinite(n) ? n.toFixed(2) : "0.00"); }
  catch { return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
}

patch(ProductInfoPopup.prototype, {
  setup() {
    // Si ya hay dueño (pos_offline_info), NO tocar estado ni timers.
    if (ProductInfoPopup.prototype.__pos_where_owner__
        && ProductInfoPopup.prototype.__pos_where_owner__ !== "pos_stock_where") {
      originalSetup && originalSetup.apply(this, arguments);

      // Añade solo helpers si no existen
      if (!this.prettyName) this.prettyName = prettyName;
      if (!this.fmtQty) {
        const pos = this.env?.services?.pos;
        this.fmtQty = (q) => fmtQtyGeneric(pos, q);
      }

      // Re-render suave cuando cambian reservas (no tocar rows)
      const posSvc = useService("pos");
      const cb = () => { try { this.render?.(); } catch {} };
      if (posSvc?.on) posSvc.on("pos_offline_reservations_changed", this, cb);

      onMounted(() => {});
      onWillUnmount(() => { try { posSvc?.off?.("pos_offline_reservations_changed", this, cb); } catch {} });
      return;
    }

    // Fallback: si no hay dueño, este módulo puede serlo (no ocurrirá si usas pos_offline_info).
    ProductInfoPopup.prototype.__pos_where_owner__ = "pos_stock_where";

    originalSetup && originalSetup.apply(this, arguments);

    const orm    = useService("orm");
    const posSvc = useService("pos");

    // Carga mínima de WHERE (sin overlay). Solo si somos dueños.
    const loadWhere = async (product) => {
      if (!product) return;
      let rows = [];
      if (navigator.onLine) {
        try {
          rows = await orm.call("product.product", "pos_where", [product.id, posSvc.config.id], {}) || [];
        } catch {}
      }
      if (!this.whereState) this.whereState = { rows: [], productId: null };
      this.whereState.rows = rows;
      this.whereState.productId = product.id;

      if (!this.prettyName) this.prettyName = prettyName;
      if (!this.fmtQty) this.fmtQty = (q) => fmtQtyGeneric(posSvc, q);
    };

    onMounted(async () => {
      if (this.props?.product) await loadWhere(this.props.product);
    });

    onWillUnmount(() => {});
  },
});
