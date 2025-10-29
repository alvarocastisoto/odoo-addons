/** @odoo-module **/
import { PosStore } from "@point_of_sale/app/store/pos_store";

function storageKey(store){
  const user = store?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = store?.config?.company_id?.[0] || "0";
  const cfg = store?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

const _setup = PosStore.prototype.setup;
PosStore.prototype.setup = async function () {
  const res = _setup ? await _setup.apply(this, arguments) : undefined;

  if (this.__offline_prefetch_done) return res;

  let tries = 0;
  while ((!this.modelsByName || !this.modelsByName["product.product"]?.records?.length) && tries < 200) {
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }
  const products = this.modelsByName?.["product.product"]?.records || [];
  const ids = products.map(p => p.id);

  // snapshot actual
  const key = storageKey(this);
  let snap = lsGet(key) || { byProduct:{}, ts:0, version:1 };
  this.offlineInfo = snap;  // también en memoria

  if (!navigator.onLine || !ids.length) {
    console.log("[pos_offline_info] prefetch: skip (offline o sin productos)");
    return res;
  }

  try {
    const whereMap = await this.env.services.orm.call("product.product", "pos_where_bulk", [ids, this.config.id], {});
    const byProduct = snap.byProduct || {};
    for (const pid of ids) {
      const prev = byProduct[pid] || {};
      byProduct[pid] = { ...prev, where: Array.isArray(whereMap?.[pid]) ? whereMap[pid] : [] };
    }
    snap.byProduct = byProduct; snap.ts = Date.now(); lsSet(key, snap);
    this.offlineInfo = snap;
    console.log("[pos_offline_info] precache WHERE OK:", Object.keys(whereMap || {}).length);
  } catch (e) {
    console.warn("[pos_offline_info] precache WHERE failed:", e);
  }

  const missing = ids.filter(pid => !( (lsGet(key)?.byProduct?.[pid]||{}).info ));
  if (!missing.length) {
    console.log("[pos_offline_info] precache INFO: nada que hacer");
    this.__offline_prefetch_done = true;
    return res;
  }

  console.log("[pos_offline_info] precache INFO: empezando →", missing.length);
  const conc = 8;
  let i = 0;
  const worker = async () => {
    while (i < missing.length) {
      const pid = missing[i++];
      try {
        const prod = products.find(p => p.id === pid);
        await this.getProductInfo(prod, 1);
      } catch (e) {
        console.warn("[pos_offline_info] precache INFO fallo", pid, e);
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  console.log("[pos_offline_info] precache INFO: terminado");

  this.offlineInfo = lsGet(key) || snap;
  this.__offline_prefetch_done = true;
  return res;
};
