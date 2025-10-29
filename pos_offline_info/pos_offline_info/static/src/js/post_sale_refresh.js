/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";

console.log("[pos_offline_info] post_sale_refresh LOADED");

// === Utils comunes ===
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
const uniq  = (a)=>[...new Set(a)];
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

function storageKey(env, pos) {
  const db  = env.services.user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}

function keyByLoc(rows=[]) {
  // Normaliza filas por ubicación (ajusta campos si tus filas difieren)
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
  // ¿cambió alguna ubicación relevante?
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return true;
  for (const k of ak) {
    if (!b[k]) return true;
    if (a[k].onh !== b[k].onh || a[k].fct !== b[k].fct) return true;
  }
  return false;
}

async function fetchWhere(env, pos, productIds) {
  const map = await env.services.orm.call(
    "product.product", "pos_where_bulk", [productIds, pos.config.id], {}
  );
  // Asegura arrays
  for (const pid of productIds) {
    if (!Array.isArray(map?.[pid])) map[pid] = [];
  }
  return map || {};
}

async function fetchInfo(env, pos, productIds) {
  return await env.services.orm.call(
    "product.product", "pos_product_info_bulk", [productIds, pos.config.id, 1.0], {}
  );
}

async function refreshProductsOnce(env, pos, productIds) {
  const key = storageKey(env, pos);
  let snap = lsGet(key) || { byProduct:{}, ts:0, version:1 };

  // WHERE
  const whereMap = await fetchWhere(env, pos, productIds);
  for (const pid of productIds) {
    const prev = snap.byProduct[pid] || {};
    snap.byProduct[pid] = {
      ...prev,
      where: Array.isArray(whereMap[pid]) ? whereMap[pid] : (prev.where || []),
    };
  }

  // INFO
  const infoMap = await fetchInfo(env, pos, productIds);
  for (const [pidStr, info] of Object.entries(infoMap || {})) {
    const pid = Number(pidStr);
    const prev = snap.byProduct[pid] || {};
    snap.byProduct[pid] = { ...prev, info };
  }

  snap.ts = Date.now();
  lsSet(key, snap);
  // Mantén en memoria alineado
  pos.offlineInfo = snap;
}

/**
 * Reintenta hasta que cambie el WHERE vs el snapshot previo
 * Backoff: 0s, 1s, 3s, 7s, 15s (ajustable)
 */
async function refreshUntilChanged(env, pos, productIds) {
  const key = storageKey(env, pos);
  const prevSnap = lsGet(key) || { byProduct:{}, ts:0, version:1 };

  const attempts = [0, 1000, 3000, 7000, 15000];
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i]) await sleep(attempts[i]);

    try {
      // Lee WHERE actual (sin escribir aún)
      const currentWhere = await fetchWhere(env, pos, productIds);

      // Compara por PID
      let changed = false;
      for (const pid of productIds) {
        const prevRows = prevSnap.byProduct?.[pid]?.where || [];
        if (differs(keyByLoc(prevRows), keyByLoc(currentWhere[pid] || []))) {
          changed = true;
          break;
        }
      }

      if (changed) {
        // Si cambió, ya escribimos snapshot completo (WHERE + INFO) una vez
        await refreshProductsOnce(env, pos, productIds);
        console.log("[pos_offline_info] post-sale refresh OK on attempt", i+1);
        return true;
      }

      // Si no cambió aún, en el último intento escribe igualmente (mejor “idéntico” que nada)
      if (i === attempts.length - 1) {
        await refreshProductsOnce(env, pos, productIds);
        console.warn("[pos_offline_info] post-sale refresh wrote identical snapshot (no change detected)");
        return false;
      }
    } catch (e) {
      console.warn("[pos_offline_info] post-sale refresh attempt failed:", e);
      if (i === attempts.length - 1) return false;
    }
  }
  return false;
}

// ============== HOOK ==============
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

      // flujo original
      const res = await _validate.apply(this, arguments);

      // tras validar (y volver a la pantalla de productos), intenta actualizar
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
