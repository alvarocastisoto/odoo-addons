# POS Offline Product Info (Odoo 17)

Módulo para TPV de Odoo 17 que añade:

- Caché offline de **información de producto** y **stock por ubicaciones**.
- Selección de **sububicación de origen por línea de ticket**.
- Reencaminado de los `stock.move` para respetar esa sububicación.
- Overlay de **reservas de sesión** y **tickets offline** sobre el stock mostrado.
- Heartbeat de conectividad con **banner visual** “Trabajando sin conexión”.
- Auto-flush de pedidos y refresco de stock cuando vuelve la conexión.

Nombre técnico del módulo: `pos_offline_info`.

---

## Requisitos

- Odoo **17** (POS nuevo, OWL).
- Módulos instalados:
  - `point_of_sale`
  - `stock`
  - `pos_stock_where`
  - `pos_restrict_stock_wh`

---

## Objetivo

Mejorar el TPV de Odoo para un escenario **offline-first** con multi-almacén:

- El cajero puede elegir **desde qué sububicación** sale cada línea.
- Los movimientos de stock se crean y corrigen para respetar esa elección.
- El POS sigue funcionando y mostrando información útil aunque no haya red.
- Las ventas realizadas sin conexión se reflejan en el stock que ve el propio TPV
  (mientras el servidor no puede actualizar todavía).

---

## Características principales

### 1. Heartbeat & modo offline

- Ruta HTTP `/pos_offline_info/ping` que responde **204** sin cuerpo.
- Servicio JS `offline_heartbeat.js`:
  - Hace `fetch` periódico al ping.
  - Marca `window.__pos_rpc_down__` según el resultado.
  - Muestra un banner fijo (`#pos-offline-banner`) con el mensaje  
    **“Trabajando sin conexión”** cuando detecta caída.
- Controla reintentos con backoff y pausa cuando la pestaña está oculta.

### 2. Caché offline de producto + stock (`info` / `where`)

- `cache_indexeddb.js`:
  - BD `indexedDB` llamada `POS_OfflineCache`.
  - Dos stores:
    - `info`: información de producto (precios, impuestos, etc.).
    - `where`: stock por ubicación.
  - Claves parametrizadas por:
    - BD, compañía, configuración de POS (`db/cmp/cfg`).
- Soporte de migración desde localStorage:
  - `migrateLS2IDBIfAny` copia datos antiguos (`byProduct[...]`) a IndexedDB.
  - `pos_idb_bootstrap.js` ejecuta la migración al arrancar el POS.
- `prefetch_service.js`:
  - Al abrir el POS, precarga:
    - `pos_where_bulk` para todos los productos → `where`.
    - `pos_product_info_bulk` por bloques → `info`.

### 3. Stock por ubicaciones + overlay de reservas

- Backend (`product.py`):
  - Método `product.product.pos_product_info_bulk(product_ids, config_id, qty)`:
    - Llama a `get_product_info_pos`.
    - Normaliza la estructura (`_safe_info`) para que siempre haya:
      - `all_prices`, `pricelists`, `warehouses`, `suppliers`, `variants`, etc.
    - Rellena `availability` con `qty_available` y `virtual_available`.
- Frontend (`patch_getproductinfo.js` + `product_info_patch.js`):
  - Parchea `PosStore.getProductInfo`:
    - **Online**:
      - Llama al método original.
      - Guarda en IndexedDB (`info`).
    - **Offline / error**:
      - Lee desde IndexedDB / localStorage.
      - “Endurece” la estructura para que el front no reviente.
      - Calcula y añade:
        - Coste unitario, margen unitario, margen %.
        - Coste y margen total del producto dentro del ticket actual.
  - Parchea `ProductInfoPopup` para:
    - Cargar `where` (stock por ubicaciones) desde:
      - Backend (`pos_where`), o
      - Caché (`where` de IndexedDB / localStorage).
    - Aplicar overlay de reservas:
      - **Sesión** (`session_reservations.js`): pedidos abiertos.
      - **Offline persistido** (`reservations_on_validate.js`): tickets validados sin conexión.
    - Agrupar resultados por almacén y sububicación, mostrando:
      - Total por almacén.
      - Lista de sububicaciones con stock > 0.
    - Ocultar el resumen estándar de inventario del popup y sustituirlo por el árbol propio.

Además, hay plantillas QWeb opcionales (`product_info_inventory.xml`, `product_info_patch.xml`,
`product_info_where.xml`) que extienden `point_of_sale.ProductInfoPopup` para inyectar
el bloque de “Stock por almacén / Ubicaciones” en el HTML.

### 4. Selección de sububicación por línea de ticket

- Campo nuevo en `pos.order.line`:

  ```python
  pos_src_location_id = fields.Many2one(
      "stock.location",
      string="Ubicación origen (POS)",
      help="Origen de stock elegido en el TPV para esta línea.",
      ondelete="restrict",
  )
