/** @odoo-module **/

import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";
import { PosDB } from "@point_of_sale/app/store/db";

const DB_NAME = "POS_Order";
const STORE_NAME = "store1";
const DB_VERSION = 1;

const _dbAddOrder   = PosDB.prototype.add_order;

const _setup        = PosStore.prototype.setup;
const _pushOrders   = PosStore.prototype.push_orders;
const _saveToServer = PosStore.prototype._save_to_server;
const _flushOrders  = PosStore.prototype._flush_orders;

function isOfflineLike(errOrMsg) {
  const msg = String(errOrMsg?.message ?? errOrMsg ?? "");
  return (
    !navigator.onLine ||
    window.__pos_rpc_down__ ||
    /XmlHttpRequestError|NetworkError|Failed to fetch|Connection|timeout/i.test(msg)
  );
}
function log(...a){ try{ console.log("[pos_offline_db]", ...a); }catch{} }
function warn(...a){ try{ console.warn("[pos_offline_db]", ...a); }catch{} }
function error(...a){ try{ console.error("[pos_offline_db]", ...a); }catch{} }

function purgePosLocalStorage(dbName) {
  try {
    const prefix = dbName + "_";
    const toDel = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith(prefix) ||
        k === "posdb" ||
        k.includes("_orders") ||
        k.includes("_pending_operations")
      ) {
        toDel.push(k);
      }
    }
    for (const k of toDel) localStorage.removeItem(k);
    log("LocalStorage purgado:", toDel);
  } catch (e) { warn("purgePosLocalStorage err:", e); }
}

function clearPosOfflineReservations(pos) {
  try {
    const user = pos?.env?.services?.user;
    const db = user?.context?.db || "";
    const cmp = pos?.config?.company_id?.[0] || "0";
    const cfg = pos?.config?.id || "0";
    localStorage.removeItem(`POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}/reservations`);
  } catch {}
}

function getIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function saveToIndexedDB(orders) {
  const db = await getIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let ok = 0;

    orders.forEach((o) => {
      const uid  = o?.uid || o?.data?.uid;
      const data = o?.data || (o?.export_as_JSON ? o.export_as_JSON() : {});
      if (!uid) { error("UID ausente; no se guarda:", o); return; }
      const rec = { id: uid, uid, data };
      const put = store.put(rec);
      put.onsuccess = () => { ok++; };
      put.onerror   = (e) => error("IndexedDB put error:", e?.target?.error);
    });

    tx.oncomplete = () => { log(`Guardadas en IndexedDB: ${ok}/${orders.length}`); resolve(); };
    tx.onerror    = (e) => { error("IndexedDB tx error:", e); reject(e); };
  });
}

async function getAllFromIndexedDB() {
  const db = await getIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readonly");
    const store = tx.objectStore(STORE_NAME);
    const out = [];
    store.openCursor().onsuccess = (ev) => {
      const c = ev.target.result;
      if (c) { out.push(c.value); c.continue(); } else resolve(out);
    };
    tx.onerror = (e) => reject(e);
  });
}

async function clearIndexedDB() {
  const db = await getIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const clr = store.clear();
    clr.onsuccess = resolve;
    clr.onerror   = reject;
  });
}

function orderToJSON(o) {
  if (o?.data) return o.data;
  if (typeof o?.export_as_JSON === "function") {
    try { return o.export_as_JSON() || {}; } catch {}
  }
  // 3) otras convenciones
  if (typeof o?.toJSON === "function") {
    try { return o.toJSON() || {}; } catch {}
  }
  if (typeof o?.get_order_json === "function") {
    try { return o.get_order_json() || {}; } catch {}
  }
  if (o && typeof o === "object" && (
    Array.isArray(o.lines) || "amount_total" in o || "amount_paid" in o || "name" in o || "uid" in o
  )) return o;
  return {};
}

function ensureOrdersArrayWithData(orders) {
  return (Array.isArray(orders) ? orders : [])
    .filter(() => true)
    .map((o) => {
      const data = orderToJSON(o);
      const uid =
        o?.uid ||
        data?.uid ||
        data?.id ||
        (data?.name ? String(data.name) : null);
      const id = o?.id || uid;
      return { id, uid, data, export_as_JSON: () => data || {} };
    })
    .filter((x) => !!x.uid && !!x.data && (
      (Array.isArray(x.data.lines) && x.data.lines.length > 0) || Number(x.data.amount_total || 0) > 0
    ));
}

function reconstructFromCurrentPos(pos) {
  try {
    const cur = pos?.get_order?.();
    if (!cur) return null;
    const data = orderToJSON(cur);
    const uid = data?.uid || cur?.uid || data?.id || data?.name;
    const id  = uid;
    // Evita pedidos “en blanco”
    const hasLines = Array.isArray(data?.lines) && data.lines.length > 0;
    const total = Number(data?.amount_total || 0);
    if (!uid || (!hasLines && total === 0)) return null;
    return { id, uid, data, export_as_JSON: () => data };
  } catch (e) {
    warn("reconstructFromCurrentPos err:", e);
    return null;
  }
}

async function moveOrdersToIndexedDBAndPurge(pos, orders, reason) {
  try {
    let prepared = ensureOrdersArrayWithData(orders);

    if (!prepared.length) {
      const rec = reconstructFromCurrentPos(pos);
      if (rec) {
        prepared = [rec];
        log("Fallback aplicado: reconstruido pedido actual para IndexedDB →", rec.uid);
      }
    }

    if (!prepared.length) {
      warn("moveOrdersToIndexedDBAndPurge: no hay órdenes válidas. reason=", reason);
      return;
    }

    await saveToIndexedDB(prepared);

    try {
      for (const x of prepared) { try { pos.db.remove_order(x.uid); } catch {} }
    } catch (e) { warn("remove_order batch err:", e); }

    purgePosLocalStorage(pos.db.name);
    clearPosOfflineReservations(pos);
    log(`Pedidos movidos a IndexedDB (${prepared.length}) por: ${reason}`);
  } catch (e) {
    error("moveOrdersToIndexedDBAndPurge fatal:", e);
  }
}

patch(PosStore.prototype, {
  async setup() {
    const res = _setup ? await _setup.apply(this, arguments) : undefined;
    log("PATCH ACTIVO (setup)");

    if (!this.__offline_sync_bound__) {
      this.__offline_sync_bound__ = true;
      window.addEventListener("online", async () => {
        try { await this.push_orders?.(); } catch {}
        try { await this.sync_offline_orders?.(); } catch {}
      });
    }

    try { await this.sync_offline_orders?.(); } catch {}
    return res;
  },

  async push_orders() {
    log("push_orders interceptados");
    try {
      return _pushOrders ? await _pushOrders.apply(this, arguments) : undefined;
    } catch (err) {
      if (!isOfflineLike(err)) throw err;
      warn("push_orders OFFLINE → no se pudo enviar. (Se gestionará en _save_to_server/_flush_orders)");
      throw err;
    }
  },

  async _save_to_server(orders) {
    const len = Array.isArray(orders) ? orders.length : 0;
    log("_save_to_server interceptado", { len });
    if (!len) return { successful: [], failed: [] };

    try {
      const res = _saveToServer ? await _saveToServer.apply(this, arguments) : { successful: [], failed: [] };
      const failed = Array.isArray(res?.failed) ? res.failed : [];
      if (failed.length || isOfflineLike(res?.message)) {
        warn("_save_to_server → fallidos, moviendo a IndexedDB");
        await moveOrdersToIndexedDBAndPurge(this, orders, "_save_to_server failed");
        const pre = ensureOrdersArrayWithData(orders);
        return { successful: pre.map(o => ({ id: o.id, uid: o.uid })), failed: [] };
      }
      return res;
    } catch (err) {
      if (!isOfflineLike(err)) throw err;
      warn("_save_to_server OFFLINE → IndexedDB");
      await moveOrdersToIndexedDBAndPurge(this, orders, "_save_to_server exception");
      const pre = ensureOrdersArrayWithData(orders);
      return { successful: pre.map(o => ({ id: o.id, uid: o.uid })), failed: [] };
    }
  },

  async _flush_orders(orders, options) {
    const len = Array.isArray(orders) ? orders.length : 0;
    log("_flush_orders interceptado", { len });
    if (!len) return { successful: [], failed: [] };

    try {
      const res = _flushOrders ? await _flushOrders.apply(this, arguments) : { successful: [], failed: [] };
      const failed = Array.isArray(res?.failed) ? res.failed : [];
      if (failed.length || isOfflineLike(res?.message)) {
        warn("_flush_orders → fallidos, moviendo a IndexedDB");
        await moveOrdersToIndexedDBAndPurge(this, orders, "_flush_orders failed");
        const pre = ensureOrdersArrayWithData(orders);
        return { successful: pre.map(o => ({ id: o.id, uid: o.uid })), failed: [] };
      }
      return res;
    } catch (err) {
      if (!isOfflineLike(err)) throw err;
      warn("_flush_orders OFFLINE → IndexedDB");
      await moveOrdersToIndexedDBAndPurge(this, orders, "_flush_orders exception");
      const pre = ensureOrdersArrayWithData(orders);
      return { successful: pre.map(o => ({ id: o.id, uid: o.uid })), failed: [] };
    }
  },

  async sync_offline_orders() {
    const pending = await getAllFromIndexedDB();
    if (!pending.length) { log("IndexedDB vacío."); return; }

    log(`sync_offline_orders: ${pending.length} pendientes`);

    const prepared = pending.map((r) => ({
      ...r,
      id: r.uid,
      export_as_JSON: () => r.data,
    }));

    let uploadedAny = false;
    for (const order of prepared) {
      try {
        this.db.add_order(order);
        if (_flushOrders) await _flushOrders.apply(this, [[order], { timeout: 5, shadow: false }]);
        uploadedAny = true;
      } catch (e) {
        if (isOfflineLike(e)) { warn("Sigue offline durante sync."); break; }
        error("Error servidor en sync:", e);
      }
    }

    if (uploadedAny) {
      for (const o of prepared) { try { this.db.remove_order(o.id); } catch {} }
      await clearIndexedDB();
      clearPosOfflineReservations(this);
      purgePosLocalStorage(this.db.name);
      log("Sync completada. IndexedDB limpiado y LocalStorage purgado.");
    }
  },
});

patch(PosDB.prototype, {
  add_order(order) {
    try {
      const json = orderToJSON(order);
      const hasLines = Array.isArray(json?.lines) && json.lines.length > 0;
      const total = Number(json?.amount_total || 0);
      const isBlank = !hasLines && total === 0;

      if (isBlank) {
        console.log("[pos_offline_db] add_order: pedido en blanco NO persistido:", json?.uid || order?.uid);
        return; 
      }
    } catch (e) {
      console.warn("[pos_offline_db] add_order guard:", e);
    }
    return _dbAddOrder.apply(this, arguments);
  },
});

log("PATCH CARGADO (pos_offline.js)");
