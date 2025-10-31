/** @odoo-module **/

import { registry } from "@web/core/registry";

const DB_NAME = "POS_info_offline";
const STORE_NAME = "product_info_v17";
const DB_VERSION = 1;


async function getDB() {

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Error al abrir IndexedDB:", event.target.error);
            reject(event.target.error);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
    });
}

/**
 * @param {string} key - La clave de almacenamiento única.
 */
export async function idbGet(key) {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn("[pos_offline_info] idbGet failed:", e);
        return null;
    }
}

/**
 * @param {string} key - La clave de almacenamiento única.
 * @param {object} value - El objeto a almacenar.
 */
export async function idbSet(key, value) {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        // Usa Promise para la petición
        return new Promise((resolve, reject) => {
            const request = store.put(value, key); // Almacena 'value' con la 'key'
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn("[pos_offline_info] idbSet failed:", e);
    }
}

function storageKey(env, pos) {
    const user = env.services.user;
    const db = user?.context?.db || "";
    const cmp = pos?.config?.company_id?.[0] || "0";
    const cfg = pos?.config?.id || "0";
    return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}

async function prefetchAll(env, pos) {
    const key = storageKey(env, pos);

    // Obtener productos (lógica original)
    const products =
        (pos.modelsByName?.["product.product"]?.records?.length
            ? pos.modelsByName["product.product"].records
            : Object.values(pos.db?.product_by_id || {})) || [];

    const ids = products.map(p => p.id);
    if (!ids.length) {
        console.log("[pos_offline_info] prefetch: no hay productos");
        return;
    }
    if (!navigator.onLine) {
        console.log("[pos_offline_info] prefetch: offline → salto");
        return;
    }

  
    let snap = await idbGet(key) || { byProduct: {}, ts: 0, version: 1 };
    
   
    try {
        const whereMap = await env.services.orm.call(
            "product.product", "pos_where_bulk", [ids, pos.config.id], {}
        );
        for (const pid of ids) {
            const prev = snap.byProduct[pid] || {};
          
            snap.byProduct[pid] = { ...prev, where: Array.isArray(whereMap?.[pid]) ? whereMap[pid] : [] };
        }
        snap.ts = Date.now();
        await idbSet(key, snap);
        console.log("[pos_offline_info] precache WHERE OK (guardado en IndexedDB)");
    } catch (e) {
        console.warn("[pos_offline_info] precache WHERE failed:", e);
    }

   
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        try {
            const infoMap = await env.services.orm.call(
                "product.product", "pos_product_info_bulk", [batch, pos.config.id, 1.0], {}
            );

          
            let cur = await idbGet(key) || { byProduct: {}, ts: 0, version: 1 };
            
            for (const [pidStr, info] of Object.entries(infoMap || {})) {
                const pid = Number(pidStr);
                const prev = cur.byProduct[pid] || {};
               
                cur.byProduct[pid] = { ...prev, info };
            }
            cur.ts = Date.now();
            await idbSet(key, cur); 
            console.log(`[pos_offline_info] precache INFO +${Object.keys(infoMap || {}).length} (guardado en IndexedDB)`);
        } catch (e) {
            console.warn("[pos_offline_info] precache INFO failed:", e);
        }
    }

    console.log("[pos_offline_info] prefetch DONE");
}

registry.category("services").add("pos_offline_prefetch", {
    dependencies: ["pos", "orm", "user"],
    start(env) {
        const pos = env.services.pos;
        window.__POS_SVC__ = env.services.pos;
        window.__POS_ENV__ = env;
        pos.ready.then(() => console.log("[pos_offline_info] POS READY (expuesto como __POS_SVC__)"));
        if (!pos) return;
        pos.ready.then(() => prefetchAll(env, pos)).catch((e) => {
            console.warn("[pos_offline_info] prefetch service error:", e);
        });
    },
});