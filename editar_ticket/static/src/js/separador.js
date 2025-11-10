/** @odoo-module **/

console.log("separador cargado");


//Espera a que el POS esté listo
(function waitForPOSRoot() {
    const posRoot = document.querySelector(".pos");
    if (!posRoot) {
        return setTimeout(waitForPOSRoot, 500);
    }

    //console.log("POS root encontrado");


    //Aplica formato a los numeros porque unos venian como float
    function formatNumber(value) {
        const num = parseFloat(value);
        if (!isNaN(num)) {
            return num.toLocaleString("es-ES", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
        }
        return value ?? "";
    }

    //Busca la parte de impuestos y sustituye lo que habia dentro por una tabla
    //añadiendo el nombre del producto también

    function enhanceTaxBlock(receipt) {

        const taxBlock = receipt.querySelector(".pos-receipt-taxes");
        if (!taxBlock || taxBlock.dataset.enhanced) return;

        const order = window.posmodel?.get_order?.();
        if (!order) {
            console.warn("⚠️ No se pudo obtener el pedido activo del POS.");
            return;
        }

        taxBlock.innerHTML = "";


        const table = document.createElement("table");
        table.classList.add("pos-tax-table");


        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        ["Producto", "Impuesto", "Importe", "Base", "Total"].forEach((title) => {
            const th = document.createElement("th");
            th.textContent = title;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);


        const tbody = document.createElement("tbody");

        for (const line of order.get_orderlines()) {
            const taxes = line.get_taxes?.() || [];
            if (!taxes.length) continue;

            for (const tax of taxes) {
                const taxAmount = line.get_tax?.() || tax.amount || 0;
                const base = line.get_base_price?.() || 0;
                const total = line.get_price_with_tax?.() || 0;

                const tr = document.createElement("tr");

                const cols = [
                    line.product.display_name || "",
                    `${tax.amount}%`,
                    formatNumber(taxAmount),
                    formatNumber(base),
                    formatNumber(total),
                ];

                cols.forEach((cellText) => {
                    const td = document.createElement("td");
                    td.textContent = cellText;
                    tr.appendChild(td);
                });

                tbody.appendChild(tr);
            }
        }

        table.appendChild(tbody);


        const tfoot = document.createElement("tfoot");
        const trTotal = document.createElement("tr");
        const totalTax = order.get_total_tax?.() || 0;
        const totalBase = order.get_total_without_tax?.() || 0;
        const total = order.get_total_with_tax?.() || 0;

        const totalCols = [
            "TOTAL",
            "",
            formatNumber(totalTax),
            formatNumber(totalBase),
            formatNumber(total),
        ];

        totalCols.forEach((cellText) => {
            const td = document.createElement("td");
            td.textContent = cellText;
            trTotal.appendChild(td);
        });

        tfoot.appendChild(trTotal);
        table.appendChild(tfoot);


        taxBlock.appendChild(table);
        taxBlock.dataset.enhanced = "1";

        //console.log("💈 Tabla de impuestos renderizada correctamente.");
    }


    //Es básicamente el hook que llama a la funcion que crea la tabla cuando se crea un nuevo recibo
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    const receipt = node.querySelector?.(".pos-receipt");
                    if (receipt) {
                        enhanceTaxBlock(receipt);
                    }
                }
            }
        }
    });

    //Vigila todo el DOM del POS
    observer.observe(posRoot, { childList: true, subtree: true });
})();
