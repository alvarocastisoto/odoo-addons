/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { cache, buildCtx, keyInfo, readLSInfo } from "./cache_indexeddb";

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
function computeClientFields(pos, product, info) {
  const unitPriceExcl = Number(info?.productInfo?.all_prices?.price_without_tax) || 0;
  const unitCost = Number(product?.standard_price) || 0;
  const unitMargin = unitPriceExcl - unitCost;
  const unitMarginPct = unitPriceExcl ? Math.round((unitMargin / unitPriceExcl) * 100) : 0;

  info.costCurrency   = pos.env.utils.formatCurrency(unitCost);
  info.marginCurrency = pos.env.utils.formatCurrency(unitMargin);
  info.marginPercent  = unitMarginPct;

  const order = pos.get_order ? pos.get_order() : pos.selectedOrder;
  let qtyInOrder = 0;
  if (order && order.get_orderlines) {
    for (const line of order.get_orderlines()) {
      const lp = line.get_product ? line.get_product() : line.product;
      if (lp && lp.id === product.id) qtyInOrder += (line.get_quantity ? line.get_quantity() : line.qty) || 0;
    }
  }

  const totalPriceExcl = unitPriceExcl * qtyInOrder;
  const totalCost      = unitCost * qtyInOrder;
  const totalMargin    = totalPriceExcl - totalCost;
  const totalMarginPct = totalPriceExcl ? Math.round((totalMargin / totalPriceExcl) * 100) : 0;

  info.orderPriceWithoutTaxCurrency = pos.env.utils.formatCurrency(totalPriceExcl);
  info.orderCostCurrency            = pos.env.utils.formatCurrency(totalCost);
  info.orderMarginCurrency          = pos.env.utils.formatCurrency(totalMargin);
  info.orderMarginPercent           = totalMarginPct;
  return info;
}

const _getProductInfo = PosStore.prototype.getProductInfo;

patch(PosStore.prototype, {
  async getProductInfo(product, quantity=1) {
    if (!product) return _getProductInfo ? _getProductInfo.apply(this, arguments) : null;

    const ctx = buildCtx(this);
    const cacheKey = keyInfo(ctx, product.id);

    if (!navigator.onLine || window.__pos_rpc_down__) {
      let info = await cache.getJSON("info", cacheKey);
      if (!info) info = readLSInfo(this, product.id);
      info = harden(info || {
        productInfo: { all_prices:{}, pricelists:[], warehouses:[], suppliers:[], variants:[], optional_products:[] },
        availability: { on_hand:0, forecasted:0, uom: "Unidades" }, uom: { name: "Unidades" }, product_id: product.id,
      });
      return computeClientFields(this, product, info);
    }

    try {
      const res = _getProductInfo ? await _getProductInfo.apply(this, arguments) : {};
      window.__pos_rpc_down__ = false;
      await cache.setJSON("info", cacheKey, harden(res));
      return res;
    } catch (e) {
      console.warn("[pos_offline_info] getProductInfo online failed; using cache", e);
      window.__pos_rpc_down__ = true;
      let info = await cache.getJSON("info", cacheKey);
      if (!info) info = readLSInfo(this, product.id);
      info = harden(info || {
        productInfo: { all_prices:{}, pricelists:[], warehouses:[], suppliers:[], variants:[], optional_products:[] },
        availability: { on_hand:0, forecasted:0, uom: "Unidades" }, uom: { name: "Unidades" }, product_id: product.id,
      });
      return computeClientFields(this, product, info);
    }
  },
});
