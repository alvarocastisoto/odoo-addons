# POS Restrict Stock & Logistics (Odoo 17)

**Nombre técnico:** `pos_restrict_stock_wh`

Módulo avanzado de logística y control para el TPV de Odoo 17. Transforma el punto de venta en un nodo logístico capaz de gestionar **Pasillo Infinito (Endless Aisle)** y **Cross-Docking**.

Bloquea ventas sin stock local, propone alternativas desde otros almacenes y divide automáticamente los albaranes de entrega según el origen real de la mercancía.

---

## 🚀 Características Principales

* **Bloqueo Inteligente:** Impide añadir productos al carrito si no hay stock físico suficiente en el árbol de ubicaciones de la tienda (configurable).
* **Venta Cruzada (Cross-Selling):** Si no hay stock local, busca disponibilidad en otros almacenes de la compañía.
* **Selector de Origen y Modo:** Permite al cajero elegir:
    * **Ubicación de Origen:** ¿Sale de Tienda o de Almacén Central?
    * **Modo de Cumplimiento:** ¿El cliente se lo lleva (`Pickup`) o se envía (`Ship`)?
* **Split Picking (División de Albaranes):** Rompe la limitación nativa de Odoo. Un solo ticket de venta genera **múltiples albaranes de salida (`stock.picking`)** si los productos salen de ubicaciones distintas.
* **Trazabilidad:** Inyecta la ubicación de origen elegida en cada línea del pedido y en los movimientos de stock (`stock.move`).

---

## 📋 Requisitos

* **Odoo 17**.
* Módulos dependientes:
    * `point_of_sale`
    * `stock`
    * `pos_stock_where` (Recomendado para la búsqueda de stock global).

---

## ⚙️ Configuración

1.  Ir a **Punto de Venta > Configuración > Ajustes**.
2.  Seleccionar el TPV deseado.
3.  Activar la opción: **"Restringir venta sin stock (ubicación POS)"**.
    * *Activado (Check):* Bloquea la venta si el stock local es insuficiente y lanza el asistente de búsqueda en otros almacenes.
    * *Desactivado:* Comportamiento estándar de Odoo (permite negativos).

---

## 🛠️ Arquitectura Técnica

### Frontend (Guardia de Stock)
* **`block_on_add.js`:** Intercepta `addProductToCurrentOrder` y `set_quantity`.
* **Lógica de Bloqueo:** Calcula el stock disponible en tiempo real:
    $$Disponible = StockFísico - ReservasSesión - ReservasOffline$$
* **Integración Offline:** Compatible con `pos_offline_info`. Si no hay red, consulta la caché local (IndexedDB) para decidir si permite la venta.

### Backend (Motor Logístico)
* **`pos_order.py` (`_create_picking`):**
    * Intercepta la creación de albaranes.
    * Agrupa las líneas del pedido por `pos_src_location_id`.
    * Si detecta múltiples orígenes, genera N albaranes (`stock.picking`) independientes.
    * Marca los pickings con `pos_src_cross_store_ok=True` para coordinarse con otros módulos.
    * Añade una "marca de agua" al nombre del movimiento (ej: `[pos_src: Almacén Central]`) para facilitar la auditoría visual.

---

## 📖 Flujo de Uso (Ejemplo)

1.  **Escenario:** El cliente quiere 2 unidades del "Producto X". En tienda solo queda 1, pero hay 50 en el Almacén Central.
2.  **Acción:** El cajero escanea el producto.
3.  **Bloqueo:** El sistema avisa: "Solo queda 1 unidad aquí. ¿Buscar en otras ubicaciones?".
4.  **Decisión:** El cajero selecciona:
    * 1 unidad de **Tienda** (Recogida).
    * 1 unidad de **Almacén Central** (Envío a domicilio).
5.  **Resultado:** Se genera un único ticket de venta, pero en el backend se crean dos albaranes de salida distintos, descontando stock correctamente de cada sitio.

---

## 📦 Instalación

1.  Clonar o copiar la carpeta `pos_restrict_stock_wh` en tu directorio de addons.
2.  Actualizar la lista de aplicaciones.
3.  Instalar **POS Restrict Stock & Logistics**.

---

## 📄 Licencia y Autoría

* **Licencia:** LGPL-3
* **Autor:** Álvaro Casti Soto (`alvarocastisoto`)
