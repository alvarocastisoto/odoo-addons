/** @odoo-module **/
import { registry } from "@web/core/registry";
import { migrateLS2IDBIfAny } from "./cache_indexeddb";

registry.category("services").add("pos_idb_bootstrap", {
  dependencies: ["pos"],
  async start(env) {
    const pos = env.services.pos;
    try { await migrateLS2IDBIfAny(pos); } catch(e) { console.warn("[pos_offline_info] bootstrap migrate err:", e); }
    return {};
  },
});
