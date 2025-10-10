/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { onMounted, onPatched, onWillUpdateProps, useState } from "@odoo/owl";
import { ProductInfoPopup } from "@point_of_sale/app/screens/product_screen/product_info_popup/product_info_popup";

console.log("[pos_stock_where] JS cargado (pretty labels)");

const originalSetup = ProductInfoPopup.prototype.setup;

patch(ProductInfoPopup.prototype, {
    setup() {
        if (originalSetup) originalSetup.apply(this, arguments);

        this._posWhere = useState({ rows: [], productId: null });

        const orm = useService("orm");
        const posSvc = useService("pos");

        const PATH_LABELS = new Map([
            ["wh-t1/stock", "Tienda 1"],
            ["wh-t2/up", "Tienda 2 arriba"],
            ["wh-t2/down", "Tienda 2 abajo"],
        ]);

        const prettyName = (r) => {
            const raw = String(r?.complete_name || "").trim();
            if (!raw) return `Ubicación ${r?.location_id ?? ""}`.trim();

            const key = raw.toLowerCase();
            if (PATH_LABELS.has(key)) return PATH_LABELS.get(key);

            const m = raw.match(/^WH-?T?(\d+)\/Stock(?:\/(.+))?$/i);
            if (m) {
                const tienda = m[1];
                const sub = (m[2] || "").toLowerCase();
                if (tienda === "1") return "Tienda 1";
                if (tienda === "2") {
                    if (sub === "arriba") return "Tienda 2 arriba";
                    if (sub === "abajo") return "Tienda 2 abajo";
                    return "Tienda 2";
                }
                return `Tienda ${tienda}${sub ? " " + m[2] : ""}`;
            }
            return raw;
        };

        const findHost = () => {
            if (this.el) {
                const local = this.el.querySelector("main.body, .modal-body");
                if (local) {
                    console.log("[pos_stock_where] host local OK:", local);
                    return local;
                }
                console.warn("[pos_stock_where] host local NO encontrado dentro de this.el");
            }
            const global = document.querySelector(".popup.product-info-popup main.body, .popup.product-info-popup .modal-body");
            if (global) {
                console.log("[pos_stock_where] host global OK:", global);
                return global;
            }
            console.warn("[pos_stock_where] host global NO encontrado");
            if (this.el) {
                console.warn("[pos_stock_where] uso fallback this.el");
                return this.el;
            }
            return null;
        };

        const ensureContainer = (host) => {
            let s = host.querySelector("#pos_where_container");
            if (!s) {
                s = document.createElement("section");
                s.id = "pos_where_container";
                s.className = "o_pos_product_info_where mt-2";
                host.appendChild(s);
                console.log("[pos_stock_where] container creado dentro de:", host);
            } else {
                s.innerHTML = "";
                console.log("[pos_stock_where] container reutilizado");
            }
            return s;
        };

        const renderWhere = () => {
            const host = findHost();
            if (!host) {
                console.warn("[pos_stock_where] render abortado: sin host");
                return;
            }
            const container = ensureContainer(host);

            const rows = Array.isArray(this._posWhere.rows) ? this._posWhere.rows : [];
            container.innerHTML = "";

            const h = document.createElement("h4");
            h.textContent = "Stock disponible"; 
            container.appendChild(h);

            if (!rows.length) {
                const em = document.createElement("em");
                em.textContent = "¡Stock no disponible!.";
                container.appendChild(em);
                return;
            }

            const ul = document.createElement("ul");
            ul.className = "list-unstyled mb-0";
            for (const r of rows) {
                const li = document.createElement("li");
                const qty = (r.qty || 0).toFixed(2);
                li.textContent = `${prettyName(r)}: ${qty}`;
                ul.appendChild(li);
            }
            container.appendChild(ul);
            console.log("[pos_stock_where] renderizado OK, filas:", rows.length);
        };

        const loadWhere = async (product) => {
            try {
                const rows = await orm.call(
                    "product.product",
                    "pos_where",
                    [product.id, posSvc.config.id],
                    {}
                );
                this._posWhere.rows = Array.isArray(rows) ? rows : [];
                this._posWhere.productId = product.id;
                console.log("[pos_stock_where] rows ->", this._posWhere.rows);
            } catch (e) {
                console.error("[pos_stock_where] pos_where RPC failed:", e);
                this._posWhere.rows = [];
            }
        };

        const safeRender = () => {
            renderWhere();
            setTimeout(renderWhere, 30);
        };

        onMounted(async () => {
            this.el?.setAttribute("data-pos-where-patched", "1");
            if (this.props?.product) {
                await loadWhere(this.props.product);
            }
            safeRender();
        });

        onPatched(() => {
            safeRender();
        });

        onWillUpdateProps(async (nextProps) => {
            if (nextProps?.product && nextProps.product.id !== this._posWhere.productId) {
                await loadWhere(nextProps.product);
                safeRender();
            }
        });
    },
});
