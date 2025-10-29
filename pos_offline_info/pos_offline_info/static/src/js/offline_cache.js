/** @odoo-module **/
import { PosStore } from "@point_of_sale/app/store/pos_store";

/* ---- Helpers de caché ---- */
function storageKey(store){
  const user = store?.env?.services?.user;
  const db = user?.context?.db || "";
  const cmp = store?.config?.company_id?.[0] || "0";
  const cfg = store?.config?.id || "0";
  return `POS_OFFLINE_INFO/v17/${db}/${cmp}/${cfg}`;
}
const lsGet = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{return null;} };
const lsSet = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

/* ===========================
   PATCH seguro de PosStore.setup
   - Guard 1 (global): no parchear dos veces el método.
   - Guard 2 (por instancia): no precargar dos veces.
   =========================== */
const origSetup = PosStore?.prototype?.setup;

if (!origSetup) {
  console.warn("[pos_offline_info] PosStore.setup no existe; no parcheo.");
} else if (!PosStore.prototype.setup.__pos_offline_prefetch_patched__) {

  PosStore.prototype.setup = async function patchedSetup() {
    // Llamamos al setup original y guardamos su retorno
    const res = await origSetup.apply(this, arguments);

    // Guard 2 (por instancia): si ya hicimos prefetch en ESTA instancia, salimos
    if (this.__offline_prefetch_done) return res;

    // Inicializamos snapshot en memoria (útil incluso si luego salimos)
    const key = storageKey(this);
    let snap = lsGet(key) || { byProduct: {}, ts: 0, version: 1 };
    this.offlineInfo = snap;

    // Encapsulamos toda la precarga para garantizar el flag en finally
    try {
      // 1) Espera a que el POS tenga productos cargados
      const MAX_TRIES = 200;   // ~20 s
      const SLEEP_MS  = 100;

      let tries = 0;
      while ((!this.modelsByName || !this.modelsByName["product.product"]?.records?.length) && tries < MAX_TRIES) {
        await new Promise(r => setTimeout(r, SLEEP_MS));
        tries++;
      }
      const products = this.modelsByName?.["product.product"]?.records || [];
      const ids = products.map(p => p.id);

      // Si estamos offline o no hay productos, no hacemos prefetch (pero marcamos el flag en finally)
      if (!navigator.onLine || !ids.length) {
        console.log("[pos_offline_info] prefetch: skip (offline o sin productos)");
        return res;
      }

      // 2) Precarga WHERE (tu método pos_where_bulk)
      try {
        const whereMap = await this.env.services.orm.call(
          "product.product", "pos_where_bulk", [ids, this.config.id], {}
        );
        const byProduct = snap.byProduct || {};
        for (const pid of ids) {
          const prev = byProduct[pid] || {};
          byProduct[pid] = { ...prev, where: Array.isArray(whereMap?.[pid]) ? whereMap[pid] : [] };
        }
        snap.byProduct = byProduct;
        snap.ts = Date.now();
        lsSet(key, snap);
        this.offlineInfo = snap;
      } catch (e) {
        console.warn("[pos_offline_info] precache WHERE failed:", e);
      }

      // 3) Precarga INFO por lotes (tu método pos_product_info_bulk)
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        try {
          const infoMap = await this.env.services.orm.call(
            "product.product", "pos_product_info_bulk", [batch, this.config.id, 1.0], {}
          );

          // Actualizamos snapshot y enriquecemos con “Finanzas” unitarias
          let cur = lsGet(key) || { byProduct: {}, ts: 0, version: 1 };
          const byProduct = cur.byProduct || {};

          for (const [pidStr, info] of Object.entries(infoMap || {})) {
            const pid = Number(pidStr);
            const prev = byProduct[pid] || {};

            const prod = products.find(p => p.id === pid);
            const unitPriceExcl = Number(info?.productInfo?.all_prices?.price_without_tax) || 0;
            const unitCost = Number(prod?.standard_price) || 0;
            const unitMargin = unitPriceExcl - unitCost;
            const unitMarginPct = unitPriceExcl ? Math.round((unitMargin / unitPriceExcl) * 100) : 0;

            const enriched = {
              ...info,
              costCurrency:   this.env.utils.formatCurrency(unitCost),
              marginCurrency: this.env.utils.formatCurrency(unitMargin),
              marginPercent:  unitMarginPct,
            };

            byProduct[pid] = { ...prev, info: enriched };
          }

          cur.byProduct = byProduct;
          cur.ts = Date.now();
          lsSet(key, cur);
          this.offlineInfo = cur;

        } catch (e) {
          console.warn("[pos_offline_info] pos_product_info_bulk failed:", e);
        }
      }

    } finally {
      // Pase lo que pase, marcamos que ya intentamos precargar en ESTA instancia
      this.__offline_prefetch_done = true;
    }

    return res;
  };

  // Guard 1: marca global para no volver a parchear el método si los assets recargan
  PosStore.prototype.setup.__pos_offline_prefetch_patched__ = true;
}
