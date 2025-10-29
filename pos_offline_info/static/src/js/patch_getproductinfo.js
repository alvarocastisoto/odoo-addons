/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";

function storageKey(store){
  const user = store?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = store?.config?.company_id?.[0] || "0";
  const cfg = store?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };

function harden(info){
  info = info || {};
  info.productInfo = info.productInfo || {};
  const pi = info.productInfo;
  const ap = pi.all_prices || {};
  pi.all_prices = {
    price_without_tax: ap.price_without_tax ?? ap.total_excluded ?? 0,
    price_with_tax:    ap.price_with_tax    ?? ap.total_included ?? 0,
    taxes: Array.isArray(ap.taxes) ? ap.taxes : (Array.isArray(ap.tax_details) ? ap.tax_details : []),
    tax_details: Array.isArray(ap.tax_details) ? ap.tax_details : (Array.isArray(ap.taxes) ? ap.taxes : []),
  };
  pi.pricelists = Array.isArray(pi.pricelists) ? pi.pricelists : [];
  pi.warehouses = Array.isArray(pi.warehouses) ? pi.warehouses : [];
  pi.suppliers  = Array.isArray(pi.suppliers)  ? pi.suppliers  : [];
  pi.variants   = Array.isArray(pi.variants)   ? pi.variants   : [];
  pi.variants = pi.variants.map(v => ({...v, values: Array.isArray(v.values) ? v.values : []}));
  pi.optional_products = Array.isArray(pi.optional_products) ? pi.optional_products : [];
  info.uom = info.uom || { name: (pi.uom || "Unidades") };
  info.availability = info.availability || { on_hand: 0, forecasted: 0, uom: info.uom.name };
  return info;
}

const _getProductInfo = PosStore.prototype.getProductInfo;

patch(PosStore.prototype, {
  async getProductInfo(product, quantity=1) {
    if (!product) return _getProductInfo ? _getProductInfo.apply(this, arguments) : null;

    if (!navigator.onLine) {
      const key = storageKey(this);
      const mem = (this.offlineInfo?.byProduct?.[product.id]?.info) || null;
      const ls  = (lsGet(key)?.byProduct?.[product.id]?.info) || null;
      const info = mem || ls;
      if (info) return harden(info);
      return harden({
        productInfo: { all_prices:{}, pricelists:[], warehouses:[], suppliers:[], variants:[], optional_products:[] },
        availability: { on_hand:0, forecasted:0, uom: "Unidades" }, uom: { name: "Unidades" }, product_id: product.id,
      });
    }

    const res = _getProductInfo ? await _getProductInfo.apply(this, arguments) : {};
    const key = storageKey(this);
    const snap = lsGet(key) || { byProduct:{}, ts:0, version:1 };
    const prev = snap.byProduct[product.id] || {};
    snap.byProduct[product.id] = { ...prev, info: harden(res) };
    snap.ts = Date.now();
    localStorage.setItem(key, JSON.stringify(snap));
    this.offlineInfo = snap; // también en memoria
    return res;
  },
});
