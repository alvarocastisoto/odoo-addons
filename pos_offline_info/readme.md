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
Expuesto en backoffice mediante views/pos_order_line_views.xml:

Vista árbol y formulario de pos.order.line con la columna “Ubicación origen”.

JS choose_location_on_validate.js:

Parchea Orderline para guardar pos_src_location_id en el JSON del pedido.

Parchea pos._save_to_server para inyectar la ubicación elegida en el payload
real que llega al backend.

Parchea PaymentScreen.validateOrder:

Antes de validar:

Para cada línea sin pos_src_location_id:

Obtiene las filas de stock (getWhereRows) desde la caché / backend.

Filtra según ubicaciones permitidas por config POS
(allowed_locations_cache.js).

Si hay:

0 opciones → usa la raíz por defecto del picking type.

1 opción → la asigna directamente a la línea.

>1 opciones → abre un SelectionPopup para que el usuario elija.

Tras la elección:

Guarda el pos_src_location_id en la línea y en un mapa
__SRC_LOC_BY_CID__ que luego usa _save_to_server.

5. Enrutado de movimientos de stock
PosOrder (models/pos_order.py)
_order_fields(ui_order):

Reescribe los comandos de líneas del POS para:

Tratar siempre las líneas como nuevas ((0, 0, vals)).

Respetar campos extra como pos_src_location_id que vienen del JSON.

_prepare_stock_move_vals(picking, line, qty, **kwargs):

Llama a super() y luego:

Enlaza el movimiento con la línea: pos_order_line_id = line.id.

Si el picking es de salida (outgoing) y la línea tiene
pos_src_location_id interna:

Fuerza location_id = esa sububicación.

Añade un sufijo [pos_src:Ubicación] al nombre del stock.move.

_pos_src_fix_moves():

Recorre todos los pickings de cada pedido:

Rellena pos_order_line_id si falta (buscando por producto).

Corrige location_id y move_line_ids si no coinciden con
pos_src_location_id, desreservando y reasignando cuando toca.

Se ejecuta tras:

_create_picking

_create_order_picking

action_pos_order_paid

StockMove (models/stock_move.py)
Campo pos_order_line_id en stock.move para enlazar con la línea POS.

_pos_src_line_and_loc():

Intenta recuperar (línea POS, ubicación) usando:

pos_order_line_id, o

picking.origin (name/pos_reference) + producto.

_pos_src_get_allowed_ids(picking):

Calcula la raíz y el conjunto de ubicaciones internas child_of la
ubicación origen del stock.picking.type del POS.

_pos_src_enforce_location():

Para cada movimiento:

Si está done, no toca nada.

Si la línea POS tiene pos_src_location_id:

Se asegura de que location_id y move_line_ids.location_id coincidan
con esa sububicación (desreservando y reasignando si hace falta).

Si no hay sububicación explícita:

Se asegura de que el movimiento no salga del árbol permitido por el POS
(forzándolo a la raíz si hace falta).

Overrides:

create, _action_confirm, _action_assign llaman a
_pos_src_enforce_location() para mantener coherencia durante todo
el ciclo de vida del movimiento.

StockPicking (models/stock_picking.py)
_create_picking_from_pos_order_lines(...):

Llama a la implementación estándar.

Después:

Empareja movimientos con líneas por product_id.

Rellena pos_order_line_id si falta.

Reescribe location_id y move_line_ids.location_id según
pos_src_location_id y vuelve a reservar (_action_assign()).

6. Reservas de sesión y offline
session_reservations.js:

Parchea:

Order.add_product

Order.remove_orderline

Orderline.set_quantity

PosStore.setup

Mantiene un mapa en memoria:

pos.sessionReserved = { pid: { lid: qty } }

Lanza el evento pos_offline_reservations_changed cuando cambia.

reservations_on_validate.js:

Parchea PaymentScreen._finalizeValidation:

Si está en modo offline-like (sin red o __pos_rpc_down__):

Calcula un delta { pid: { lid: qty } } para el pedido validado.

Lo acumula en localStorage en reservations_persisted.

Lanza pos_offline_reservations_changed.

auto_flush_on_online.js:

Servicio que escucha window.online.

Cuando vuelve la conexión:

Hace un httpPing al backend (HEAD /web + POST version_info).

Si la conexión es real:

Llama a pos.push_orders() para subir pedidos offline.

Reconstruye el mapa de reservas combinando:

reservations (legacy)

reservations_persisted

Pide al backend pos_where_bulk de los productos afectados y
actualiza la caché (where).

Borra esas reservas de localStorage.

Estructura del módulo
Rutas relevantes (nombre de carpeta asumido pos_offline_info):

Manifiesto

__manifest__.py

Controladores

controllers/ping.py

Modelos Python

models/pos_order.py

models/pos_order_line.py

models/product.py

models/stock_move.py

models/stock_picking.py

Vistas XML

views/pos_order_line_views.xml

static/src/xml/product_info_inventory.xml (opcional)

static/src/xml/product_info_patch.xml (opcional)

static/src/xml/product_info_where.xml (opcional)

JS (assets POS)

static/src/js/cache_indexeddb.js

static/src/js/idb_bootstrap.js

static/src/js/allowed_locations_cache.js

static/src/js/choose_location_on_validate.js

static/src/js/reservations_on_validate.js

static/src/js/session_reservations.js

static/src/js/auto_flush_on_online.js

static/src/js/post_sale_refresh.js

static/src/js/prefetch_service.js

static/src/js/patch_getproductinfo.js

static/src/js/product_info_patch.js

static/src/js/offline_heartbeat.js

CSS

static/src/css/offline_banner.css

Instalación
Copiar la carpeta pos_offline_info en la ruta de addons de Odoo.

Reiniciar el servicio de Odoo.

Activar el modo desarrollador en Odoo.

Actualizar la lista de aplicaciones.

Instalar POS Offline Product Info desde el menú de Apps.

Tras instalar / actualizar, Odoo recompilará los assets del POS y cargará
los JS/CSS definidos en __manifest__.py.

Configuración rápida
Asegúrate de que el picking_type_id del TPV tiene configurada una
ubicación origen (default_location_src_id) coherente.

Configura las ubicaciones internas / sububicaciones bajo esa raíz.

(Opcional) Revisa la vista de líneas de pedido (pos.order.line) en backoffice
para ver el campo “Ubicación origen”.

Uso
En el POS (online):

Abre el popup de info de producto:

Verás el árbol de “Stock por almacén / ubicaciones” con las cantidades
ya descontadas por:

Líneas en pedidos abiertos.

Tickets validados offline.

Al validar un pedido:

Para cada línea, si hay varias ubicaciones disponibles, el POS te
pedirá elegir desde qué sububicación servirla.

En el POS (offline):

El banner rojo indica que estás trabajando sin conexión.

La info de producto y stock se sirve desde la caché (IndexedDB / localStorage).

Las ventas validas se acumulan como reservas persistidas que se
restan en el overlay de stock.

Al volver la conexión:

El módulo empuja pedidos pendientes al backend.

Refresca la caché de stock (where) para los productos afectados.

Limpia las reservas persistidas que ya han sido sincronizadas.

Licencia y autoría
Licencia: LGPL-3

Autor: Álvaro Casti Soto (alvarocastisoto)

Copiar código
