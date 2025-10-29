/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { onMounted, onWillUpdateProps, useState } from "@odoo/owl";
import { ProductInfoPopup } from "@point_of_sale/app/screens/product_screen/product_info_popup/product_info_popup";

const _setup = ProductInfoPopup.prototype.setup;

function safeAP(){
  return {
    total_excluded: 0, total_included: 0,
    price_without_tax: 0, price_with_tax: 0,
    taxes: [], tax_details: [],
  };
}
function normAP(ap0){
  const ap = ap0 || {};
  ap.total_excluded   = ap.total_excluded   ?? ap.price_without_tax ?? 0;
  ap.total_included   = ap.total_included   ?? ap.price_with_tax   ?? 0;
  ap.price_without_tax= ap.price_without_tax?? ap.total_excluded   ?? 0;
  ap.price_with_tax   = ap.price_with_tax   ?? ap.total_included   ?? 0;
  ap.tax_details = Array.isArray(ap.tax_details) ? ap.tax_details : (Array.isArray(ap.taxes) ? ap.taxes : []);
  ap.taxes       = Array.isArray(ap.taxes)       ? ap.taxes       : ap.tax_details;
  return ap;
}

patch(ProductInfoPopup.prototype, {
  setup() {
    if (_setup) _setup.apply(this, arguments);
    console.log("[pos_offline_info] product_info_patch.js LOADED (whereState alias)");


    const orm = this.env.services.orm;
    const posSvc = this.env.services.pos;

    this.whereState = this.whereState || useState({ rows: [], productId: null });

    const key = (() => {
      const user = this?.env?.services?.user;
      const db = user?.context?.db || "";
      const cmp = posSvc?.config?.company_id?.[0] || "0";
      const cfg = posSvc?.config?.id || "0";
      return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
    })();
    const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };
    const readCached = (pid)=> (lsGet(key)?.byProduct?.[pid]) || null;

    const load = async (product) => {
      if (!product) return;

      if (navigator.onLine) {
        try {
          const rows = await orm.call("product.product","pos_where",[product.id, posSvc.config.id],{});
          const cur = lsGet(key) || { byProduct:{}, ts:0, version:1 };
          const cached = cur.byProduct[product.id] || {};
          cur.byProduct[product.id] = { ...cached, where: Array.isArray(rows)?rows:[] };
          cur.ts = Date.now();
          localStorage.setItem(key, JSON.stringify(cur));

          this.whereState.rows = cur.byProduct[product.id].where;
          this.whereState.productId = product.id;
          return;
        } catch(e) {
          console.warn("[pos_offline_info] where online failed, fallback cache", e);
        }
      }

      const fb = readCached(product.id);
      this.whereState.rows = Array.isArray(fb?.where) ? fb.where : [];
      this.whereState.productId = product.id;
    };

    onMounted(async ()=>{ if(this.props?.product){ await load(this.props.product); } });
    onWillUpdateProps(async (next)=>{ if(next?.product && next.product.id !== this.whereState.productId){ await load(next.product); } });
  },
});
