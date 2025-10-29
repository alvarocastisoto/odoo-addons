# POS Offline Info (Odoo 17)

> Selección de **sub-ubicación por línea** en el TPV, con **cache offline** para “Dónde hay stock” y **enlace persistente** `stock.move → pos.order.line` que asegura que el **origen** del movimiento sea la sub-ubicación elegida por el usuario.

## Características
- **Selector por línea** al validar: si un producto está en varias sub-ubicaciones, el TPV solicita desde cuál **descontar**.
- **Inyección en payload**: `pos_src_location_id` viaja en la línea al backend, incluso con reconexiones o reintentos.
- **Enlace y enforcement backend**:
  - `stock.move.pos_order_line_id` enlaza el movimiento con su línea de ticket.
  - Se **fuerza/ajusta** `move.location_id` a la sub-ubicación elegida:
    - Si el move estaba reservado, **des-reserva → cambia origen → vuelve a asignar**.
    - Evita merges peligrosos (`_action_confirm(merge=False)`).
- **Popup de producto**: muestra “Dónde hay stock” y **cachea** datos en `localStorage` (online/offline).

## Requisitos
- Odoo 17 (CE/EE)
- `point_of_sale`, `stock`
- (Opcional) `pos_restrict_stock_wh`

## Instalación
1. Copia el módulo a tu `addons_path`.
2. Actualiza apps e instala **pos_offline_info**.
3. Sube la versión en `__manifest__.py` o actualiza con `-u pos_offline_info` para recompilar assets.

## Configuración
- El TPV debe apuntar al **padre** de stock (p. ej., `mar/Stock`).
- Crea sub-ubicaciones internas (p. ej., `mar/Stock/arriba`, `mar/Stock/abajo`).

## Uso (flujo)
1. En la ficha del producto (popup), se muestra **Dónde hay stock** (online) o datos del **cache** (offline).
2. Al **validar el pedido**:
   - Si hay varias ubicaciones candidatas, aparece un **selector** por línea.
   - Con una única opción, se aplica sin preguntar.
   - Sin datos (offline puro), se ofrece la **ubicación por defecto del TPV**.

## Detalles técnicos (frontend)
- Archivo: `static/src/js/choose_location_on_validate.js`
  - **Parcha** `PaymentScreen.validateOrder()` para mostrar el selector.
  - **Hook** a `pos._save_to_server()` para **inyectar** `pos_src_location_id` en cada línea antes de enviar.
  - Cache en `localStorage` bajo clave:
    ```
    POS_OFFLINE_INFO/v17/{db}/{company_id}/{config_id}
    ```
  - Parámetros rápidos:
    ```js
    // Muestra cantidad en el selector (false por defecto)
    const SHOW_QTY_IN_SELECTOR = false;
    const LABEL_QTY = "disponible";
    ```

## Detalles técnicos (backend)
- `models/pos_order.py`
  - `_order_fields`: asegura `(0,0,vals)` y capta `pos_src_location_id`.
  - `_prepare_stock_move_vals(picking, line, qty, **kw)`: enlaza `pos_order_line_id` y fija `location_id` si procede.
  - `_pos_src_fix_moves()`: corrige movimientos tras crear pickings / marcar pagado (enlace + origen + re-asignación).
- `models/stock_move.py`
  - Campo `pos_order_line_id = Many2one('pos.order.line')`.
  - `create`, `_action_confirm(merge=False)`, `_action_assign()` → `_pos_src_enforce_location()`.
- `static/src/xml/product_info_where.xml`
  - Bloque para mostrar “Dónde hay stock” y **solo el último tramo** del path (“arriba”, “abajo”…).

## Verificación (odoo shell)
```python
o = env["pos.order"].search([], order="id desc", limit=1)
p = o.picking_ids[:1]
for m in p.move_ids_without_package:
    print("MOVE", m.id,
          "src:", m.location_id.complete_name,
          "line_id:", (m.pos_order_line_id and m.pos_order_line_id.id) or False,
          "line_src:", (m.pos_order_line_id and m.pos_order_line_id.pos_src_location_id and
                        m.pos_order_line_id.pos_src_location_id.complete_name) or False)



Logs útiles:

POS SRC UI→LINE
POS SRC MOVE VALS@line
POS SRC FIX AFTER CREATE
POS SRC ENFORCED

Limitaciones

Offline sin cache previo: se usará la ubicación por defecto del TPV.

Muchas líneas iguales: si faltase enlace directo, hay fallback por producto dentro del pedido (y se persiste).

Rendimiento: el cache front ayuda a evitar llamadas repetidas.

Estructura
pos_offline_info/
├── __init__.py
├── __manifest__.py
├── models/
│   ├── pos_order.py
│   ├── pos_order_line.py
│   ├── stock_move.py
│   └── stock_picking.py
├── static/
│   ├── src/js/choose_location_on_validate.js
│   └── src/xml/product_info_where.xml
└── views/pos_order_line_views.xml

Licencia

LGPL-3
