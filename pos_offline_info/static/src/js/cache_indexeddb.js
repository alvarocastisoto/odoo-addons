/** @odoo-module **/

const DB_NAME = "POS_OfflineCache";
const DB_VERSION = 1;
const STORES = ["info", "where"];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: "k" });
        }
      }
    };
    req.onsuccess = (ev) => resolve(ev.target.result);
    req.onerror = (ev) => reject(ev.target.error);
  });
}

async function _put(store, records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([store], "readwrite");
    const st = tx.objectStore(store);
    for (const r of records) st.put({ k: r.key, v: r.val, ts: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}
async function _get(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([store], "readonly");
    const st = tx.objectStore(store);
    const g = st.get(key);
    g.onsuccess = () => resolve(g.result ? g.result.v : null);
    g.onerror = reject;
  });
}

export const cache = {
  async setJSON(store, key, val) { return _put(store, [{ key, val }]); },
  async msetJSON(store, kvList)  { return _put(store, kvList); },
  async getJSON(store, key)      { return _get(store, key); },
};

export function buildCtx(pos) {
  const user = pos?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  return { db, cmp, cfg };
}
export const keyInfo  = (ctx, productId) => `v17/${ctx.db}/${ctx.cmp}/${ctx.cfg}/info/${productId}`;
export const keyWhere = (ctx, productId) => `v17/${ctx.db}/${ctx.cmp}/${ctx.cfg}/where/${productId}`;
export const offlineNow = () => (!navigator.onLine || !!window.__pos_rpc_down__);

function storageBaseKey(pos){
  const user = pos?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = pos?.config?.company_id?.[0] || "0";
  const cfg = pos?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
function _lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } }

export function readLSWhere(pos, pid) {
  const snap = _lsGet(storageBaseKey(pos));
  const arr = snap?.byProduct?.[pid]?.where;
  return Array.isArray(arr) ? arr : null;
}
export function readLSInfo(pos, pid) {
  const snap = _lsGet(storageBaseKey(pos));
  const obj = snap?.byProduct?.[pid]?.info;
  return obj || null;
}

export async function migrateLS2IDBIfAny(pos) {
  try {
    const snap = _lsGet(storageBaseKey(pos));
    if (!snap?.byProduct) return;
    const ctx = buildCtx(pos);
    const kvWhere = [];
    const kvInfo  = [];
    for (const [pidStr, payload] of Object.entries(snap.byProduct)) {
      const pid = Number(pidStr);
      if (!Number.isFinite(pid)) continue;
      if (payload?.where) kvWhere.push({ key: keyWhere(ctx, pid), val: payload.where });
      if (payload?.info)  kvInfo.push ({ key: keyInfo (ctx, pid), val: payload.info  });
    }
    if (kvWhere.length) await cache.msetJSON("where", kvWhere);
    if (kvInfo.length)  await cache.msetJSON("info",  kvInfo);
    console.log("[pos_offline_info] Migración localStorage→IndexedDB:", {info: kvInfo.length, where: kvWhere.length});
  } catch(e) {
    console.warn("[pos_offline_info] migrateLS2IDBIfAny error:", e);
  }
}
