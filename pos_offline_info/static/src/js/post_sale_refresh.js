/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { cache, buildCtx, keyInfo, keyWhere } from "./cache_indexeddb";

console.log("[pos_offline_info] post_sale_refresh LOADED");

const uniq  = (a)=>[...new Set(a)];
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

function keyByLoc(rows=[]) {
  return Object.fromEntries(
    rows.map(r => {
      const locId = r.location_id || r.location?.id || 0;
      const onh = Number(r.available_quantity ?? r.on_hand ?? 0);
      const fct = Number(r.forecasted_quantity ?? r.forecasted ?? onh);
      return [String(locId), { onh, fct }];
    })
  );
}
function differs(a, b) {
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return true;
  for (const k of ak) {
    if (!b[k]) return true;
    if (a[k].onh !== b[k].onh || a[k].fct !== b[k].fct) return true;
  }
  return false;
}

async function readPrevWhereMap(pos, productIds) {
  const ctx = buildCtx(pos);
  const out = {};
  for (const pid of productIds) {
    const prev = await cache.getJSON("where", keyWhere(ctx, pid));
    out[pid] = Array.isArray(prev) ? prev : [];
  }
  return out;
}

async function writeBulkInfoWhere(env, pos, productIds) {
  const ctx = buildCtx(pos);

  const whereMap = await env.services.orm.call("product.product", "pos_where_bulk", [productIds, pos.config.id], {}) || {};
  const kvWhere = [];
  for (const pid of productIds) kvWhere.push({ key: keyWhere(ctx, pid), val: Array.isArray(whereMap[pid]) ? whereMap[pid] : [] });
  await cache.msetJSON("where", kvWhere);

  const infoMap = await env.services.orm.call("product.product", "pos_product_info_bulk", [productIds, pos.config.id, 1.0], {}) || {};
  const kvInfo = [];
  for (const [pidStr, info] of Object.entries(infoMap)) kvInfo.push({ key: keyInfo(ctx, Number(pidStr)), val: info });
  if (kvInfo.length) await cache.msetJSON("info", kvInfo);
}

async function refreshUntilChanged(env, pos, productIds) {
  const prevWhere = await readPrevWhereMap(pos, productIds);
  const attempts = [0, 1000, 3000, 7000, 15000];

  for (let i=0; i<attempts.length; i++) {
    if (attempts[i]) await sleep(attempts[i]);
    try {
      const whereMap = await env.services.orm.call("product.product", "pos_where_bulk", [productIds, pos.config.id], {}) || {};
      let changed = false;
      for (const pid of productIds) {
        const before = keyByLoc(prevWhere[pid] || []);
        const now    = keyByLoc(Array.isArray(whereMap[pid]) ? whereMap[pid] : []);
        if (differs(before, now)) { changed = true; break; }
      }
      await writeBulkInfoWhere(env, pos, productIds);
      console.log("[pos_offline_info] post-sale refresh", changed ? `OK (attempt ${i+1})` : "no-change");
      return changed;
    } catch (e) {
      console.warn("[pos_offline_info] post-sale refresh attempt failed:", e);
      if (i === attempts.length - 1) return false;
    }
  }
  return false;
}

const _validate = PaymentScreen?.prototype?.validateOrder;

if (_validate && !_validate.__pos_offline_postsale_patched__) {
  patch(PaymentScreen.prototype, {
    async validateOrder(isForceValidate) {
      const pos = this.env.services.pos;
      const order = pos.get_order?.();
      const pids = order?.get_orderlines?.()
        ?.map(l => (l.get_product?.() || l.product)?.id)
        ?.filter(Boolean) || [];
      const uniquePids = uniq(pids);

      const res = await _validate.apply(this, arguments);

      if (uniquePids.length) {
        if (navigator.onLine) {
          try { await refreshUntilChanged(this.env, pos, uniquePids); }
          catch (e) { console.warn("[pos_offline_info] post-sale refresh failed:", e); }
        } else {
          console.log("[pos_offline_info] offline after sale → no refresh to backend");
        }
      }
      return res;
    },
  });
  PaymentScreen.prototype.validateOrder.__pos_offline_postsale_patched__ = true;
} else {
  console.warn("[pos_offline_info] PaymentScreen.validateOrder no localizado o ya parcheado.");
}
