/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { onMounted, onWillUpdateProps, onWillUnmount, useState } from "@odoo/owl";
import { ProductInfoPopup } from "@point_of_sale/app/screens/product_screen/product_info_popup/product_info_popup";

const _setup = ProductInfoPopup.prototype.setup;

/* ===================== Helpers de sesión ===================== */
function reservationsFor(pos){
  const user = pos?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  const key = `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}/reservations`;
  const R = (()=>{ try{ return JSON.parse(localStorage.getItem(key)||"null"); }catch{return null;} })() || {};
  return R; // { productId: qty }
}

function sessionQtyForProduct(pos, productId) {
  let qty = 0;
  const orders = pos.get_order_list?.() || pos.get_orders?.() || [];
  for (const order of orders) {
    if (!order.get_orderlines) continue;
    for (const line of order.get_orderlines()) {
      const p = line.get_product ? line.get_product() : line.product;
      const q = line.get_quantity ? line.get_quantity() : line.qty;
      if (p && p.id === productId) qty += (q || 0);
    }
  }
  return qty;
}

function applySessionDeltas(pos, product, rows) {
  const stockLocId = pos.config?.stock_location_id?.[0] || null;
  const openLines  = sessionQtyForProduct(pos, product.id);
  const pendingR   = Number(reservationsFor(pos)[product.id] || 0);
  const reserved   = Number(openLines) + Number(pendingR);

  if (!reserved || !stockLocId) return rows;

  return (rows || []).map(r => {
    const locId = r.location_id || r.location?.id;
    if (String(locId) !== String(stockLocId)) return r;

    const onh = Number(r.available_quantity ?? r.on_hand ?? 0);
    const fct = Number(r.forecasted_quantity ?? r.forecasted ?? onh);
    return {
      ...r,
      available_quantity: Math.max(0, onh - reserved),
      forecasted_quantity: Math.max(0, fct - reserved),
      on_hand: Math.max(0, (r.on_hand ?? onh) - reserved),
      forecasted: Math.max(0, (r.forecasted ?? fct) - reserved),
    };
  });
}


patch(ProductInfoPopup.prototype, {
  setup() {
    if (_setup) _setup.apply(this, arguments);
    const rpc = this.env.services.rpc;
    const posSvc = this.env.services.pos;

    this.whereState = this.whereState || useState({ rows: [], productId: null });

    const key = (() => {
      const user = this?.env?.services?.user;
      const db = user?.context?.db || "";
      const cmp = posSvc?.config?.company_id?.[0] || "0";
      const cfg = posSvc?.config?.id || "0";
      return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
    })();
    const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
    const readCached = (pid) => (lsGet(key)?.byProduct?.[pid]) || null;

    const safeOnline = () => navigator.onLine && !window.__pos_rpc_down__;

    const TTL_MS = 30_000;

    const recomputeFromCache = (product) => {
      if (!product) return;
      const snap = readCached(product.id);
      const rows0 = Array.isArray(snap?.where) ? snap.where : [];
      const rowsAdj = applySessionDeltas(posSvc, product, rows0);

      const prevJSON = JSON.stringify(this.whereState.rows || []);
      const nextJSON = JSON.stringify(rowsAdj || []);
      if (prevJSON !== nextJSON) {
        this.whereState.rows = rowsAdj;
      }
      this.whereState.productId = product.id;
    };

    const needsRefresh = (product) => {
      const s = lsGet(key);
      const lastTs = Number(s?.ts || 0);
      const has = Array.isArray(s?.byProduct?.[product.id]?.where) && s.byProduct[product.id].where.length > 0;
      const stale = Date.now() - lastTs > TTL_MS;
      return !has || stale;
    };


    const refreshWhereSilently = async (product) => {
    try {
        const rows = await this.env.services.orm.call(
        "product.product",
        "pos_where",
        [product.id, posSvc.config.id],
        {}
        );

        const cur = lsGet(key) || { byProduct: {}, ts: 0, version: 1 };
        const prev = cur.byProduct[product.id] || {};
        cur.byProduct[product.id] = { ...prev, where: Array.isArray(rows) ? rows : [] };
        cur.ts = Date.now();
        lsSet(key, cur);
        window.__pos_rpc_down__ = false;

        if (this.whereState.productId === product.id) {
        recomputeFromCache(product);
        }
    } catch (e) {
        window.__pos_rpc_down__ = true;
        console.debug("[pos_offline_info] where refresh failed; using cache", e);
    }
    };

    const load = async (product) => {
      if (!product) return;

      recomputeFromCache(product);

      if (safeOnline() && needsRefresh(product)) {
        refreshWhereSilently(product);
      }
    };

    onMounted(async () => {
      if (this.props?.product) {
        await load(this.props.product);
      }
      this.__where_refresh_timer__ = setInterval(() => {
        if (this.props?.product) recomputeFromCache(this.props.product);
      }, 1000);
    });

    onWillUpdateProps(async (next) => {
      if (next?.product && next.product.id !== this.whereState.productId) {
        await load(next.product);
      }
    });

    onWillUnmount(() => {
      if (this.__where_refresh_timer__) {
        clearInterval(this.__where_refresh_timer__);
        this.__where_refresh_timer__ = null;
      }
    });
  },
});
