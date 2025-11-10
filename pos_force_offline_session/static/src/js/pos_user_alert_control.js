/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/navbar/navbar";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { onMounted } from "@odoo/owl";

// =================================================================
// 1. IndexedDB Utils (Gestión de Logs Offline)
// =================================================================

const DB_NAME = 'PosOfflineDB';
const STORE_NAME = 'closure_logs';
const DB_VERSION = 1;

/** Abre la base de datos o crea el almacén de objetos. */
function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => reject(event.target.error);
        request.onsuccess = (event) => resolve(event.target.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' }); 
            }
        };
    });
}

/** Guarda una entrada de log en IndexedDB. */
async function saveIndexedDBLog(logEntry) {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(logEntry); 

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                console.log(`💾 [IndexedDB] Evento '${logEntry.eventType}' guardado.`);
                resolve();
            };
            request.onerror = (event) => {
                console.error("🔴 [IndexedDB] Fallo al guardar el log:", event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("🔴 [IndexedDB] Error al acceder a la base de datos para guardar:", error);
    }
}

/** Obtiene todos los logs guardados. */
async function getAllIndexedDBLogs() {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error("🔴 [IndexedDB] Fallo al leer logs:", error);
        return [];
    }
}

/** Elimina todos los logs después de una sincronización exitosa. */
async function clearIndexedDBLogs() {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear(); 

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                console.log("🧹 [IndexedDB] Logs eliminados después de la sincronización.");
                resolve();
            };
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error("🔴 [IndexedDB] Fallo al borrar logs:", error);
    }
}


// =================================================================
// 2. PATCH: Navbar (Lógica de Interceptación, Logs de Red y Sincronización)
// =================================================================

patch(Navbar.prototype, {
    __OWL_DEBUG__: "pos_offline_session.NavbarDOMPatch",

    // -------------------------------------------------------------------------
    // A. SETUP (INICIALIZACIÓN)
    // -------------------------------------------------------------------------
    setup() {
        super.setup();
        this.dialog = useService("dialog");
        this.rpc = useService("rpc"); 
        this._syncAttemptCount = 0; 
        this._maxSyncAttempts = 5; 
        
        // Manejo del Estado de Conexión y Logs de Red
        this.isCurrentlyOffline = !navigator.onLine; 
        
        this.updateConnectionStatus = () => {
            const newStatusOffline = !navigator.onLine;
            
            if (this.isCurrentlyOffline !== newStatusOffline) {
                const oldStatus = this.isCurrentlyOffline ? "🔴 OFFLINE" : "🟢 ONLINE";
                const newStatus = newStatusOffline ? "🔴 OFFLINE" : "🟢 ONLINE";
                
                console.log(`📡 [NETWORK STATUS CHANGE] Conexión ha cambiado de ${oldStatus} a ${newStatus}`);

                // 🚨 REGISTRO DE EVENTOS DE RED
                if (newStatusOffline) { // Si pasa a OFFLINE
                    this._saveLog('network_lost', 'El dispositivo pasó a OFFLINE.');
                } else { // Si pasa a ONLINE (reconexión)
                    this._saveLog('network_recovered', 'El dispositivo recuperó la conexión ONLINE.');
                    console.log("⏳ [SYNC DELAY] Conexión online recuperada. Retrasando sincronización 2 segundos...");
                    this._syncAttemptCount = 0; 
                    setTimeout(() => {
                        this._syncOfflineLogs(); 
                    }, 2000); 
                }
                
                this.isCurrentlyOffline = newStatusOffline;
            }
        };

        window.addEventListener("online", this.updateConnectionStatus);
        window.addEventListener("offline", this.updateConnectionStatus);
        this.updateConnectionStatus(); 

        // =================================================================
        // 🚨 CAMBIO CRÍTICO: Sincronización al inicio del TPV si hay conexión.
        // =================================================================
        if (!this.isCurrentlyOffline) {
            console.log("🚀 [SYNC STARTUP] TPV iniciado con conexión ONLINE. Intentando sincronizar logs pendientes...");
            // Usamos un ligero timeout para no bloquear el renderizado inicial del TPV
            setTimeout(() => {
                this._syncAttemptCount = 0; 
                this._syncOfflineLogs();
            }, 100); 
        }
        // =================================================================
        
        console.log("🛠️ [POS OFFLINE PATCH] Setup del Navbar iniciado. Preparando Observador de DOM.");
        onMounted(this.setupCloseButtonInterceptor);
    },
    
    // Función auxiliar para registrar logs (simplifica el código)
    async _saveLog(eventType, details) {
        const session_id = this.pos.pos_session?.id;
        const user_id = this.pos.pos_session?.user_id?.[0];

        if (session_id && user_id) {
            const logEntry = {
                timestamp: new Date().toISOString(), 
                session_id: session_id,
                user_id: user_id,
                eventType: eventType,
                details: details,
            };
            await saveIndexedDBLog(logEntry);
        } else {
            console.error("🔴 [LOGGING] No se pudo guardar el log. Sesión o Usuario no disponibles.");
        }
    },

    // -------------------------------------------------------------------------
    // B. Interceptor de Cierre
    // -------------------------------------------------------------------------

    setupCloseButtonInterceptor() {
        const topHeader = document.querySelector('.pos-topheader');
        if (!topHeader) {
            console.error("🔴 [DOM CRÍTICO] Contenedor principal del POS (.pos-topheader) no encontrado.");
            return;
        }

        const observer = new MutationObserver((mutationsList, observer) => {
            const subMenu = topHeader.querySelector('.sub-menu');
            const closeButtonAnchor = subMenu ? subMenu.querySelector('.close-button a') : null;

            if (closeButtonAnchor && !closeButtonAnchor._is_intercepted) {
                console.log("✅ [DOM Interceptor] Botón 'Cerrar sesión' encontrado. Inyectando controlador de eventos.");

                closeButtonAnchor.onclick = async (event) => {
                    if (this.isCurrentlyOffline) {
                        console.warn("🔴 [CONEXIÓN DETECTADA] ¡Modo sin conexión! Interceptando acción de cierre.");
                        event.preventDefault();
                        event.stopPropagation();
                        
                        // 🚨 1. REGISTRO: El usuario inició el intento (Primer log de la secuencia)
                        await this._saveLog(
                            'attempted_close', 
                            `El usuario hizo clic en "Cerrar Sesión" estando OFFLINE. Órdenes pendientes: ${this.pos.db.get_orders().length}. Se muestra la advertencia.`
                        );

                        // Llama a la advertencia, que usará el hack de onclick
                        const shouldContinue = await this.showOfflineCloseWarning(); 
                        
                        if (shouldContinue) {
                            console.log("✅ Intercepción completada. Ejecutando acción de cierre de Odoo...");
                            // Desactiva el interceptor y lanza el evento de clic original
                            closeButtonAnchor.onclick = null;
                            closeButtonAnchor.click(); 
                        } 

                    } else {
                        console.log("🟢 [CONEXIÓN DETECTADA] Conexión activa. Permitiendo cierre de sesión normal.");
                    }
                };

                closeButtonAnchor._is_intercepted = true;
                observer.disconnect();
            }
        });

        observer.observe(topHeader, { childList: true, subtree: true });
        console.log("🔬 [DOM Observer] Observador iniciado en el contenedor '.pos-topheader'.");
    },
    
    /**
     * Intenta encontrar el botón de aceptar del diálogo y añade un listener directo para el log.
     * Esta es la lógica del 'onclick literal'.
     */
    _injectAcceptButtonListener(resolve) {
        const acceptButton = document.querySelector('.o_dialog .modal-footer .btn-primary');

        if (acceptButton) {
            console.log("✅ [INJECTOR] Botón de aceptar encontrado. Inyectando listener directo.");
            
            const originalClick = acceptButton.onclick || (() => {}); 
            
            acceptButton.onclick = async (event) => {
                event.stopPropagation();
                
                // 🚨 REGISTRO LITERAL: Esto solo se ejecuta al hacer click en el botón.
                const ordersCount = this.pos.db.get_orders().length;
                await this._saveLog(
                    'accepted_close', 
                    `[ONCLICK LITERAL] El usuario ACEPTÓ cerrar la sesión tras la advertencia crítica. Órdenes pendientes: ${ordersCount}.`
                );
                
                // Resuelve la promesa que está esperando la función showOfflineCloseWarning
                resolve(true);
                
                // Ejecutamos la función original de Odoo para que cierre el modal
                originalClick(event);
            };
        } else {
            // Reintentar encontrar el botón, ya que el modal puede tardar en renderizarse
            setTimeout(() => this._injectAcceptButtonListener(resolve), 50);
        }
    },


    async showOfflineCloseWarning() {
        const sessionName = this.pos.pos_session.name || 'Sesión POS';
        const ordersCount = this.pos.db.get_orders().length;
        
        const warningTitle = "🛑 ADVERTENCIA CRÍTICA: SIN CONEXIÓN A INTERNET";

        const warningBody = `
            La Sesión ${sessionName} no tiene conexión a Internet.
            CERRAR SESIÓN en este estado puede llevar a la **PÉRDIDA PERMANENTE de las órdenes** no sincronizadas.
            
            Hay ${ordersCount} órdenes pendientes. Solo debe presionar "He Entendido y Acepto Cerrar" 
            si ha **entendido y acepta las consecuencias**.
        `;

        // Paso 1: Llamamos al diálogo.
        const dialogPromise = this.dialog.add(ConfirmationDialog, {
            title: warningTitle,
            body: warningBody,
            confirmLabel: "He Entendido y Acepto Cerrar v4",
        });

        // Paso 2: HACK DE ONCLICK: Creamos una nueva promesa que espera la acción de click real.
        const userConfirmationPromise = new Promise(resolve => {
            this._injectAcceptButtonListener(resolve);
        });

        // Esperamos la promesa inyectada (el onclick literal).
        const didConfirm = await userConfirmationPromise; 

        // Esperamos que el diálogo original se cierre.
        try {
            await dialogPromise;
        } catch(e) {
            // Ignoramos el error de la promesa original.
        }

        return didConfirm;
    },

    // -------------------------------------------------------------------------
    // C. Reintentos y Sincronización de Logs (Online)
    // -------------------------------------------------------------------------

    async _retrySyncLogs(delay = 2000) {
        if (this.isCurrentlyOffline) {
            console.warn("❌ Sincronización de logs cancelada: conexión perdida de nuevo.");
            return;
        }

        this._syncAttemptCount += 1;
        if (this._syncAttemptCount > this._maxSyncAttempts) {
            console.error(`❌ [SYNC FAILED] Límite de ${this._maxSyncAttempts} reintentos alcanzado. Logs permanecerán en IndexedDB.`);
            return;
        }

        console.log(`🔄 [SYNC RETRY] Reintentando sincronización (Intento ${this._syncAttemptCount}/${this._maxSyncAttempts}) usando Fetch API...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        await this._syncOfflineLogs();
    },

    async _syncOfflineLogs() {
        if (this.isCurrentlyOffline) { 
            return; 
        }
        
        const logsToSync = await getAllIndexedDBLogs();

        if (logsToSync.length === 0) {
            console.log("✅ [SYNC] No hay logs de cierre pendientes de sincronizar en IndexedDB.");
            return;
        }
        
        if (this._syncAttemptCount === 0) {
            console.log(`🔄 [SYNC] Intentando sincronizar ${logsToSync.length} logs de cierre de IndexedDB...`);
        }

        // Mapeamos los logs a la estructura que espera el método Python
        const formattedLogs = logsToSync.map(log => ({
            session_id: log.session_id,
            user_id: log.user_id,
            timestamp: log.timestamp,
            event_type: log.eventType,
            details: log.details,
        }));
        
        try {
            // Llamada al backend de Odoo
            const response = await fetch('/web/dataset/call_kw/pos.offline.log/create_multiple_log_entries', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': odoo.csrf_token, 
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: {
                        model: 'pos.offline.log',
                        method: 'create_multiple_log_entries',
                        args: [formattedLogs],
                        kwargs: {},
                    }
                }),
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(`Odoo Server Error (RPC Response): ${result.error.message}`);
            }
            
            // Éxito: limpiar DB local
            await clearIndexedDBLogs();
            this._syncAttemptCount = 0;
            console.log(`🎉 [SYNC SUCCESS] Logs sincronizados y eliminados de IndexedDB. (Vía Fetch)`);
            
        } catch (error) {
            console.error("🔴 [SYNC FAILED] Fallo en la sincronización al servidor (Fetch API):", error);
            this._retrySyncLogs(2000); 
        }
    },
});