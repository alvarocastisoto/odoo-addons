# POS Offline Product Info (Odoo 17)

**Nombre técnico:** `pos_offline_info`

Módulo avanzado para el TPV (Point of Sale) de Odoo 17 diseñado para escenarios **offline-first** con gestión multi-almacén. Permite operar con confianza sin conexión, garantizando la consistencia del inventario y la correcta asignación de ubicaciones de stock.

---

## 🚀 Características Principales

* **Caché Offline Robusta:** Almacenamiento local (IndexedDB) de **información de producto** y **stock por ubicaciones**, persistente entre sesiones.
* **Selección de Ubicación por Línea:** El cajero puede seleccionar (o el sistema auto-asigna) la **sububicación de origen** específica para cada línea del ticket.
* **Enrutado de Stock Inteligente:** Reencaminado automático de los `stock.move` en el backend para respetar la sububicación elegida en el frontend.
* **Control de Stock en Tiempo Real (Overlay):** Visualización del stock disponible descontando en tiempo real:
    * **Reservas de sesión:** Productos en el carrito actual.
    * **Tickets offline:** Ventas validadas sin conexión pendientes de sincronizar.
* **Modo Offline Visual:** Heartbeat de conectividad con banner visual **“Trabajando sin conexión”**.
* **Sincronización Automática:** Auto-flush de pedidos y refresco selectivo de stock al recuperar la conexión.

---

## 📋 Requisitos

* **Odoo 17** (POS basado en OWL).
* Módulos dependientes:
    * `point_of_sale`
    * `stock`
    * `pos_stock_where`
    * `pos_restrict_stock_wh`

---

## 🎯 Objetivo

Mejorar el TPV nativo para soportar operativas complejas de almacén sin depender de una conexión permanente:

1.  **Decisión en el borde:** El cajero decide desde qué estantería/ubicación sale el producto.
2.  **Integridad de datos:** Los movimientos de stock se crean y corrigen en el backend para reflejar esa decisión.
3.  **Continuidad de negocio:** El POS sigue mostrando información útil (precios, stock teórico y real) aunque no haya red.

---

## 🛠️ Arquitectura Técnica

### 1. Heartbeat & Detección Offline
* **Endpoint:** `/pos_offline_info/ping` (Respuesta 204).
* **Frontend:** `offline_heartbeat.js` realiza sondeos periódicos con *backoff* exponencial.
* **UI:** Gestiona la variable global `window.__pos_rpc_down__` y muestra el banner `#pos-offline-banner` cuando la conexión cae.

### 2. Caché Offline (IndexedDB)
* **Motor:** `cache_indexeddb.js` gestiona una base de datos `POS_OfflineCache` con dos *stores*:
    * `info`: Datos maestros de producto (precios, impuestos, etc.).
    * `where`: Niveles de stock por ubicación.
* **Migración:** Incluye `migrateLS2IDBIfAny` para migrar datos legacy de `localStorage` a `IndexedDB` al inicio (`idb_bootstrap.js`).
* **Prefetching:** `prefetch_service.js` carga masivamente los datos al abrir la sesión del POS.

### 3. Gestión de Stock y Overlay de Reservas

#### Backend (`models/product.py`)
* Método `pos_product_info_bulk`: Normaliza la estructura de datos (`_safe_info`) asegurando que campos críticos (`qty_available`, `virtual_available`, `pricelists`) siempre existan para evitar errores en el frontend.

#### Frontend (`PosStore` & `ProductInfoPopup`)
* **Parcheo de `getProductInfo`:**
    * *Online:* Consulta al servidor y actualiza la caché.
    * *Offline:* Lee de IndexedDB, "endurece" la estructura de datos y calcula márgenes/costes al vuelo.
* **Cálculo de Stock Real:**
    * Carga el stock base (`where`) desde caché o backend.
    * Aplica un **Overlay de Reservas**: Resta las cantidades de la sesión actual (`session_reservations.js`) y las ventas offline persistidas (`reservations_on_validate.js`).
    * Muestra un árbol desglosado por **Almacén > Sububicación**.

### 4. Selección de Ubicación (Frontend)
* **Validación de Pedido:** Antes de validar, si una línea no tiene ubicación asignada:
    * Filtra ubicaciones permitidas (`allowed_locations_cache.js`).
    * Si hay >1 opción, abre un `SelectionPopup` para que el usuario elija.
* **Persistencia:** Guarda la elección en `pos_src_location_id` dentro de la línea del pedido y en un mapa interno para su envío al servidor.

### 5. Enrutado de Movimientos (Backend)
Lógica compleja en `pos_order.py`, `stock_move.py` y `stock_picking.py` para garantizar la integridad del inventario:

* **`pos.order.line`:** Nuevo campo `pos_src_location_id`.
* **`stock.move`:** Nuevo campo `pos_order_line_id`.
* **Hook `_pos_src_fix_moves`:** Se ejecuta tras la creación del picking.
    * Fuerza `location_id` en el movimiento y en sus `move_line_ids` para coincidir con la elección del POS.
    * Gestiona la des-reserva y re-asignación si la ubicación estándar difiere de la elegida.
    * Añade sufijo `[pos_src:Ubicación]` al nombre del movimiento para trazabilidad.

### 6. Sincronización y Auto-Flush
* **`auto_flush_on_online.js`:** Escucha el evento `window.online`.
* Al recuperar conexión:
    1.  Verifica conectividad real (HTTP Ping).
    2.  Empuja los pedidos pendientes (`push_orders`).
    3.  Solicita al backend el stock actualizado (`pos_where_bulk`) solo de los productos afectados.
    4.  Limpia las reservas persistidas locales.

---

## 📂 Estructura del Módulo

```text
pos_offline_info/
├── __manifest__.py
├── controllers/
│   └── ping.py                 # Endpoint de latido
├── models/
│   ├── pos_order.py            # Lógica de enrutado de movimientos
│   ├── pos_order_line.py       # Campo ubicación origen
│   ├── product.py              # Normalización de info producto
│   ├── stock_move.py           # Enforce location en movimientos
│   └── stock_picking.py        # Emparejamiento movimientos-líneas
├── static/
│   ├── src/
│   │   ├── css/
│   │   │   └── offline_banner.css
│   │   ├── js/
│   │   │   ├── auto_flush_on_online.js
│   │   │   ├── cache_indexeddb.js
│   │   │   ├── choose_location_on_validate.js
│   │   │   ├── idb_bootstrap.js
│   │   │   ├── offline_heartbeat.js
│   │   │   ├── patch_getproductinfo.js
│   │   │   ├── prefetch_service.js
│   │   │   ├── product_info_patch.js
│   │   │   ├── reservations_on_validate.js
│   │   │   └── session_reservations.js
│   │   └── xml/
│   │       ├── product_info_inventory.xml
│   │       ├── product_info_patch.xml
│   │       └── product_info_where.xml
└── views/
    └── pos_order_line_views.xml




📦 Instalación
Clonar o copiar la carpeta pos_offline_info en tu directorio de addons de Odoo.

Reiniciar el servicio de Odoo.

Activar el Modo Desarrollador.

Actualizar la lista de aplicaciones.

Buscar e instalar POS Offline Product Info.

⚙️ Configuración
Asegúrate de que el picking_type_id (Tipo de operación) de tu TPV tiene una Ubicación de Origen configurada correctamente.

Define las ubicaciones internas (hijas) bajo esa ubicación raíz para permitir la selección múltiple.

(Opcional) Revisa la vista de lista de Líneas de Pedido TPV en el backend para verificar que la columna "Ubicación origen (POS)" se rellena correctamente tras las ventas.

📖 Uso
En Modo Online
Abre el popup de información de producto (icono "Info").

Verás el desglose de Stock por Almacén / Ubicaciones. Las cantidades mostradas son el resultado de:

Stock real en backend.

(-) Menos líneas en el carrito actual.

(-) Menos tickets offline no sincronizados.

Al pagar, si un producto tiene stock en múltiples sububicaciones, aparecerá un popup para seleccionar el origen.

En Modo Offline
Aparecerá un banner rojo: “Trabajando sin conexión”.

Toda la información de productos y stock se lee desde IndexedDB.

Puedes seguir vendiendo. Las ventas se guardan localmente y se visualizan como "reservas persistidas" en el popup de info de stock, evitando vender lo que ya no tienes.

Recuperación de Conexión
El banner desaparece.

El sistema sincroniza automáticamente los pedidos.

El stock local se refresca y las reservas temporales se limpian.

📄 Licencia y Autoría
Licencia: LGPL-3

Autor: Álvaro Casti Soto (alvarocastisoto)
