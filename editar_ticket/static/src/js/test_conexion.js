/** @odoo-module **/

console.log("test_conexion cargado");

(function waitForPOSRoot() {

    // Verifica si ha cargado la libreria que se usará para generar el QR en el navegador
    if (typeof QRCode === 'undefined') {
        console.error("Error: La librería qrcode.min.js no se ha cargado correctamente.");
        return setTimeout(waitForPOSRoot, 500);
    }

    // Espera a que exista el elemento DOM principal del POS
    const posRoot = document.querySelector('.pos');
    if (!posRoot) {
        return setTimeout(waitForPOSRoot, 500);
    }

    // Identificador del contenedor de texto y QR
    const QR_ELEMENT_SELECTOR = '#posqrcode';
    const TEXT_BLOCK_CLASS = '.pos-receipt-order-data';

    //Extrae la URL de la factura del DOM.
    function getFacturaUrl(qrElement) {
        if (qrElement && qrElement.nodeName === 'IMG') {
            const urlFromTitle = qrElement.getAttribute('title');
            if (urlFromTitle) {
                return urlFromTitle;
            }
        }

        // Ya que el texto de escaneo contiene la URL, lo buscamos.
        const allData = document.querySelectorAll(TEXT_BLOCK_CLASS);
        let linkText;
        allData.forEach(el => {
            if (el.textContent.includes('http')) {
                linkText = el.textContent.trim();
            }
        });
        if (linkText) {
            const urlMatch = linkText.match(/(https?:\/\/[^\s]+)/);
            return urlMatch ? urlMatch[0] : null;
        }

        return null;
    }

    //Genera el código QR de forma local
    function generateAndShowQR(qrContainer, facturaUrl) {
        qrContainer.innerHTML = '';
        if (!facturaUrl) {
            console.log("No se encontró la URL de la factura para generar el QR.");
            return;
        }
        const qrDiv = document.createElement('div');
        qrContainer.appendChild(qrDiv);

        try {
            new QRCode(qrDiv, {
                text: facturaUrl,
                width: 180,
                height: 180,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
            // console.log("✅ QR de factura generado localmente.");
        } catch (e) {
            console.error("❌ Error al generar el QR con la librería:", e);
        }
    }

    //Comprueba si el servidor de Odoo es realmente accesible como check extra de conexion
    async function isOdooReachable() {
        try {
            const response = await fetch("/web", {
                method: "GET",
                cache: "no-store",
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }


    async function updateOfflineElementsVisibility() {


        // Comprueba si hay conexion a nivel local y si es accesible el servidor
        let isOnline = navigator.onLine;
        if (isOnline) {
            const reachable = await isOdooReachable();
            if (!reachable) isOnline = false;
        }

        //Se sacan y validan los elementos a ocultar

        let qrElement = document.querySelector(QR_ELEMENT_SELECTOR);
        if (!qrElement) return;

        const textElement = qrElement.previousElementSibling;
        const isTextElementValid = textElement && textElement.classList.contains(TEXT_BLOCK_CLASS.replace('.', ''));


        //Si se confirma que está online oculta el QR y el mensaje de escanear
        if (isOnline) {
            qrElement.style.display = 'none';

            if (isTextElementValid) {
                textElement.style.display = 'none';
            }

            console.log("🟢 POS en línea");

        } else {

            // Muestra el texto
            if (isTextElementValid) {
                textElement.style.display = '';
            }

            // 4. Transforma o prepara el contenedor y crea el QR
            if (qrElement.nodeName === 'IMG') {
                const facturaUrl = getFacturaUrl(qrElement);

                const newDiv = document.createElement('div');
                newDiv.id = qrElement.id;
                newDiv.className = qrElement.className;
                newDiv.style.display = '';

                qrElement.parentNode.replaceChild(newDiv, qrElement);
                qrElement = newDiv;

                generateAndShowQR(qrElement, facturaUrl);

            } else if (qrElement.nodeName === 'DIV') {
                const facturaUrl = getFacturaUrl(qrElement);
                qrElement.style.display = '';
                generateAndShowQR(qrElement, facturaUrl);
            }

            console.log("🔴 POS sin conexión");
        }
    }


    //Es básicamente el hook que llama a la funcion para adaptar la visibilidad cuando se crea un nuevo recibo
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1 && node.querySelector?.('.pos-receipt')) {
                    setTimeout(updateOfflineElementsVisibility, 50);
                }
            }
        }
    });

    //Vigila todo el DOM del POS
    observer.observe(posRoot, { childList: true, subtree: true });

    //Son los checks de que se haya recuperado o perdido la conexion
    window.addEventListener("online", updateOfflineElementsVisibility);
    window.addEventListener("offline", updateOfflineElementsVisibility);

    //Establece el estado inicial
    setTimeout(updateOfflineElementsVisibility, 100);

})();
