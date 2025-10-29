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

scss
Copiar código
POS SRC UI→LINE
POS SRC MOVE VALS@line
POS SRC FIX AFTER CREATE
POS SRC ENFORCED
Limitaciones
Offline sin cache previo: se usará la ubicación por defecto del TPV.

Muchas líneas iguales: si faltase enlace directo, hay fallback por producto dentro del pedido (y se persiste).

Rendimiento: el cache front ayuda a evitar llamadas repetidas.

Estructura
bash
Copiar código
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

perl
Copiar código

---

### `pos_stock_where/README.md`

```markdown
# POS Stock Where (Odoo 17)

> API backend para “**Dónde hay stock**” en TPV: agrega `stock.quant` por **sub-ubicación interna**, calcula **ruta relativa** al almacén y devuelve filas **normalizadas** listas para cache/consumo en frontend.

## Características
- Endpoints:
  - `product.product.pos_where(product_id, config_id) -> list[dict]`
  - `product.product.pos_where_bulk(product_ids, config_id) -> dict[int, list[dict]]`
- Normaliza cada fila con:
  - `location_id`, `complete_name`, `qty`,
  - `warehouse_name`, `path` (ruta **relativa** al `lot_stock_id`), `display_name` (`“Almacén · path”`).
- Ordena priorizando la **ubicación por defecto** del TPV (`config.picking_type_id.default_location_src_id`).

## Requisitos
- Odoo 17 (CE/EE)
- `point_of_sale`, `stock`

## Instalación
1. Copia el módulo a tu `addons_path`.
2. Actualiza e instala **pos_stock_where**.
3. Si lo usas junto a `pos_offline_info`, actualiza ambos para recompilar assets del TPV.

## Uso
- Desde frontend (TPV), se invoca `pos_where(product_id, config_id)`.
- **Online**: lee backend y **cachea** el resultado.
- **Offline**: se usa el cache (guardado por `pos_offline_info`).

## Implementación (resumen)
- `models/product.py`
  - `pos_where(product_id, config_id)`: wrapper del bulk para un producto.
  - `pos_where_bulk(product_ids, config_id)`:
    - `read_group` sobre `stock.quant` con:
      - `("product_id","in", products.ids)`,
      - `("company_id","=", company_id)`,
      - `("location_id.usage","=","internal")`.
    - Detecta almacén comparando `complete_name` de la ubicación con los `lot_stock_id` de `stock.warehouse`.
    - Construye filas:
      ```json
      {
        "location_id": 42,
        "complete_name": "mar/Stock/arriba",
        "qty": 7.0,
        "warehouse_name": "mar",
        "path": "arriba",
        "display_name": "mar · arrba"
      }
      ```
    - **Orden**: primero `default_location_src_id` (si coincide), luego alfabético.

## Ejemplo (odoo shell)
```python
P = env["product.product"].browse(123)   # id de producto
cfg = env["pos.config"].search([], limit=1).id
rows = env["product.product"].pos_where(P.id, cfg)
for r in rows:
    print(r["display_name"], r["qty"])
Integración con POS
pos_offline_info usa esta API para:

Rellenar el panel “Dónde hay stock”.

Construir el selector de sub-ubicación por línea.

Los nombres mostrados en TPV usan solo el último tramo de path (p. ej., “arriba”, “abajo”).

Consideraciones
Puedes quitar el filtro por cantidad > 0 si quieres ver 0 (el módulo ya lo hace).

Cambios de multi-almacén: la detección por prefijo lot_stock_id.complete_name mantiene la ruta relativa estable.

Estructura
markdown
Copiar código
pos_stock_where/
├── __init__.py
├── __manifest__.py
└── models/
    └── product.py
Licencia
LGPL-3
