/** @odoo-module **/

import { browser } from "@web/core/browser/browser";
import { patch } from "@web/core/utils/patch";
import { WebClient } from "@web/webclient/webclient";

// =================================================================
// 🎯 PATCH WebClient: HANDLER DEL BOTÓN Y PUNTO DE INYECCIÓN
// =================================================================
patch(WebClient.prototype, { 
    __OWL_DEBUG__: "pos_offline_session.WebClientHandler",
    
    setup() {
        super.setup();

        if (this._offlineHandlerAttached) {
            return;
        }
        this._offlineHandlerAttached = true;
        
        // -----------------------------------------------------------------
        // HANDLER DEL BOTÓN (Intercepción del clic y NAVEGACIÓN DIRECTA)
        // -----------------------------------------------------------------
        browser.addEventListener("click", (ev) => {

            const button = ev.target.closest("button.oe_kanban_action_button[name='open_ui']");

            if (!button || navigator.onLine) {
                return;
            }

            ev.preventDefault();
            ev.stopImmediatePropagation(); 

            const record = ev.target.closest(".o_kanban_record");
            let finalConfigId = null;

            if (record && record.dataset.id) {
                const datapointIdStr = record.dataset.id;
                const match = datapointIdStr.match(/\d+$/);
                if (match) {
                    finalConfigId = parseInt(match[0]);
                }
            }

            if (finalConfigId && finalConfigId > 0) {
                
                // 💡 Redirigimos al TPV con la flag force_offline
                const posUrl = `/pos/ui?config_id=${finalConfigId}&force_offline=1`; 
                
                console.warn("=========================================");
                console.warn(`🟢 POS OFFLINE FORCE: ¡Interceptado clic! ID: ${finalConfigId}`);
                console.warn(`✅ Forzando navegación directa a: ${posUrl}`);
                console.warn("=========================================");

                window.location.href = posUrl; 

            } else {
                console.error("🔴 ERROR: No se pudo extraer un ID numérico válido del Datapoint.");
            }

        }, true);
    },
});