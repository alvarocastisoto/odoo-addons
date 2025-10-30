/** @odoo-module **/

console.log("iva_lineas cargado");

(function waitForPOSRoot() {

    // Devuelve el objeto del pedido (orden) que está activo en ese momento en el POS
    const posRoot = document.querySelector(".pos");
    if (!posRoot) {
        return setTimeout(waitForPOSRoot, 500);
    }


    // Devuelve el objeto del pedido (orden) que está activo en ese momento en el POSc
    function getActiveOrder() {
        if (window.posmodel && window.posmodel.get_order) {
            return window.posmodel.get_order();
        }
        return null;
    }

    //Añade los impuestos a las lineas de pedido
    function addTaxesToReceipt(receipt) {

        //Obtiene el objeto del pedido activo
        const order = getActiveOrder();
        if (!order) {
            console.warn("⚠️ No se pudo obtener el pedido activo del POS.");
            return;
        }

        //Obtiene todas las líneas de producto primero como html y luego como objetos
        const orderlinesHtml = receipt.querySelectorAll("li.orderline");
        const orderlinesModel = order.get_orderlines();

        //Itera simultáneamente sobre las líneas HTML y sus correspondientes modelos de datos de Odoo
        orderlinesHtml.forEach((lineEl, index) => {
            const lineModel = orderlinesModel[index];

            if (!lineModel) return;

            // Evita duplicar si ya se añadió el bloque de impuestos
            if (lineEl.querySelector(".pos-receipt-line-taxes")) return;

            const taxes = lineModel.get_taxes() || [];

            if (!taxes.length) return;

            const taxContainer = document.createElement("ul");
            taxContainer.classList.add("pos-receipt-line-taxes", "info-list", "ms-2");

            //Obtiene la información completa de precios de la línea
            const priceInfo = lineModel.get_all_prices();

            for (const tax of taxes) {

                let lineTaxAmount = 0;

                //Busca el valor exacto de IVA para el impuesto actual dentro de los detalles de priceInfo
                const taxDetail = priceInfo?.taxes?.find(t => t.id === tax.id);

                if (taxDetail) {
                    lineTaxAmount = taxDetail.amount;
                } else {
                    if (taxes.length === 1) {
                         lineTaxAmount = lineModel.get_tax() || 0;
                    } else {

                         console.warn(`⚠️ No se pudo obtener el detalle de IVA para ${lineModel.product.display_name}. Usando 0.00.`);
                    }
                }
                const li = document.createElement("li");

                // Mostramos la tasa (tax.amount) y el impuesto de IVA de Odoo.
                li.textContent = `${tax.amount}% (${lineTaxAmount.toFixed(2)} €)`;

                taxContainer.appendChild(li);
            }

            // Añade el bloque a la linea HTML
            lineEl.appendChild(taxContainer);
        });
    }


    //Es básicamente el hook que llama a la funcion que añade los impuestos a las lineas cuando se crea un nuevo recibo
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    const receipt = node.querySelector?.(".pos-receipt");
                    if (receipt) {
                        setTimeout(() => addTaxesToReceipt(receipt), 200);
                    }
                }
            }
        }
    });

    //Vigila todo el DOM del POS
    observer.observe(posRoot, { childList: true, subtree: true });
})();
