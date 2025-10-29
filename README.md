POS Offline: selección de sub-ubicación por línea + “Dónde hay stock” cacheado (Odoo 17)

Ventas desde sub-ubicaciones concretas por línea de ticket, con sincronización online/offline y panel “Dónde hay stock” en la ficha de producto del TPV.

Índice

Resumen

Módulos incluidos

Requisitos

Instalación

Configuración

Cómo funciona

Flujo UX (frontend TPV)

Flujo backend (POS/stock)

Diagrama de flujo

API “dónde hay stock”

Cache offline (estructura)

Parámetros rápidos de UI

Verificación rápida / Debug

Casos borde y limitaciones

Estructura de archivos

Licencia

Resumen

El TPV puede apuntar a la ubicación padre (p. ej., mar/Stock), pero cada línea de pedido se puede descontar desde una sub-ubicación (p. ej., mar/Stock/arriba o mar/Stock/abajo).

En la ficha de producto del TPV se muestra “Dónde hay stock” por sub-ubicación (con comportamiento offline-first, cacheando en el navegador).

La elección de sub-ubicación viaja en el payload de la línea. El backend crea y corrige (si hiciera falta) los stock.move para que el location_id de salida sea la sub-ubicación elegida.

Si un movimiento ya estaba reservado, se des-reserva, se cambia el origen y se vuelve a asignar, garantizando coherencia.

Módulos incluidos

pos_offline_info

Frontend: selector de sub-ubicación por línea al validar el ticket; parchea PaymentScreen.validateOrder() y _save_to_server() para inyectar la selección en el payload.

Backend: enlaza stock.move → pos.order.line y fuerza/corrige location_id de los movimientos según la sub-ubicación elegida.

Añade la vista a la línea de TPV para ver/filtrar pos_src_location_id.

QWeb para integrar “Dónde hay stock” en el popup de info de producto.

pos_stock_where

Backend: API product.product.pos_where(...) y pos_where_bulk(...) que obtiene, por stock.quant, el stock por sub-ubicaciones (y lo normaliza con ruta relativa al almacén).

Diseñado para alimentar el panel de “Dónde hay stock” y el selector del POS (con cache local).

Dependencias: point_of_sale, stock, y si usas restricciones, pos_restrict_stock_wh.

Requisitos

Odoo 17 (CE o EE).

TPV configurado con su almacén (apuntando al stock padre). Las sub-ubicaciones deben ser de tipo “interna”.

Navegador con localStorage disponible (modo offline del POS).

Instalación

Añade el repo a tu addons_path (Docker/Doodba o instalación estándar).

Actualiza lista de apps y instala:

pos_offline_info

pos_stock_where

(Opcional) Instala pos_restrict_stock_wh si quieres limitar desde qué almacén/ubicación se opera.

Recompila assets si fuera necesario:

Sube la version en __manifest__.py o actualiza módulos con -u pos_offline_info,pos_stock_where.

Configuración

En TPV > Configuración, asegúrate de que el TPV apunta a la ubicación de stock padre (tu lot_stock_id).

Crea (si no existen) sub-ubicaciones internas, p. ej.:

mar/Stock/arriba

mar/Stock/abajo

El módulo no cambia tu stock_location_id del TPV; seleccionas sub-ubicación por línea al validar.

Cómo funciona
Flujo UX (frontend TPV)

Al abrir el Product Info Popup, el TPV consulta product.product.pos_where(product_id, config_id).

Online: lee backend y cachea en localStorage.

Offline: muestra datos del cache.

Al validar el pedido, por cada línea:

Si hay varias sub-ubicaciones candidatas con stock (o simplemente varias rutas), abre un selector para elegir el origen.

Si solo hay una opción, se elige automáticamente.

Si no hay cache (offline puro), ofrece la ubicación por defecto del TPV.

Antes del _save_to_server, se inyecta pos_src_location_id en el payload de la línea.

Flujo backend (POS/stock)

_order_fields(...): garantiza que las líneas se creen como (0,0,vals) y registra si viene pos_src_location_id desde UI.

pos.order._prepare_stock_move_vals(picking, line, qty, **kw):

Enlaza stock.move.pos_order_line_id = line.id.

Si line.pos_src_location_id es interna y el picking es de salida, fija vals["location_id"] a esa sub-ubicación.

_pos_src_fix_moves() tras crear pickings o al marcar pagado:

Si algún move no quedó enlazado, lo vincula por fallback (producto dentro del pedido).

Si el location_id no coincide con la sub-ubicación elegida, se des-reserva, se cambia el origen y se reasigna.

En stock.move:

Campo pos_order_line_id persistente.

create, _action_confirm(merge=False), _action_assign() llaman a _pos_src_enforce_location() para asegurar el location_id correcto y evitar merges peligrosos.

Diagrama de flujo
[TPV: Product Info] --pos_where--> [Backend: read_group stock.quant]
       |                                     |
       v                                     v
  Cache local LS <--- normaliza path ---- filas {location_id, path, qty}

[Validar Pedido] -> por línea -> [Selector sub-ubicación]
       |                              |
       v                              v
inject pos_src_location_id   payload con pos_src_location_id

                 [Backend: crear pickings/moves]
                 |    enlaza move→line, fija location_id
                 v
        _pos_src_fix_moves() / _pos_src_enforce_location()
                    des-reserva → cambia origen → asigna

API “dónde hay stock”
product.product.pos_where(product_id, config_id) -> list[dict]

Wrapper para un solo producto. Usa internamente pos_where_bulk.

product.product.pos_where_bulk(product_ids, config_id) -> dict[int,list[dict]]

read_group sobre stock.quant con usage="internal", agrupado por product_id y location_id.

Detecta el almacén comparando complete_name con los lot_stock_id de los almacenes de la compañía.

Devuelve filas normalizadas por producto:

{
  "location_id": 123,
  "complete_name": "mar/Stock/arriba",
  "qty": 5.0,
  "warehouse_name": "mar",
  "path": "arriba",
  "display_name": "mar · arriba"
}


Ordena priorizando la ubicación por defecto del TPV y luego alfabético.

Cache offline (estructura)

Clave:

POS_OFFLINE_INFO/v17/{db}/{company_id}/{config_id}


Estructura:

{
  "byProduct": {
    "123": {
      "where": [ { "location_id": ..., "path": "...", "qty": ... }, ... ],
      "...": {}
    }
  },
  "ts": 1730..., 
  "version": 1
}

Parámetros rápidos de UI

En pos_offline_info/static/src/js/choose_location_on_validate.js:

const SHOW_QTY_IN_SELECTOR = false; // true para mostrar cantidad en el selector
const LABEL_QTY = "disponible";     // etiqueta en castellano para la cantidad


En el popup de info de producto, los nombres de ubicación se muestran con solo el último tramo del path (“arriba”, “abajo”…). (Si quisieras incluir más tramos, puedes ampliar la función que calcula la etiqueta).

Verificación rápida / Debug
Comandos en odoo shell
# Último pedido y su picking
o = env["pos.order"].search([], order="id desc", limit=1)
p = o.picking_ids[:1]
print("ORDER:", o.name, "PICK:", p.mapped("name"), "ORIGIN:", p.origin)

# Inspección de moves: origen real y enlace con la línea
for m in p.move_ids_without_package:
    print("MOVE", m.id,
          "src:", m.location_id.complete_name,
          "line_id:", (m.pos_order_line_id and m.pos_order_line_id.id) or False,
          "line_src:", (m.pos_order_line_id and m.pos_order_line_id.pos_src_location_id and
                        m.pos_order_line_id.pos_src_location_id.complete_name) or False)

# Confirmar que tu override está activo
import inspect
PO = env["pos.order"]
print("pos.order._prepare_stock_move_vals:", PO._prepare_stock_move_vals.__func__.__module__)

Logs útiles para grep

POS SRC UI→LINE

POS SRC MOVE VALS@line

POS SRC FIX AFTER CREATE

POS SRC ENFORCED

Ejemplo:

docker compose logs -f odoo | grep -E "POS SRC (UI→LINE|MOVE VALS|FIX AFTER|ENFORCED)"

Casos borde y limitaciones

Offline sin cache previo: si nunca abriste la ficha de producto en online, el selector solo propondrá la ubicación por defecto del TPV.

Varias líneas del mismo producto: si faltara el enlace directo move → line (no debería), el backend hace fallback por producto dentro del pedido y persistirá el enlace.

Merges de movimientos: se fuerza merge=False en _action_confirm para evitar mezclar location_id distintos.

Rendimiento: read_group inicial puede costar con catálogos muy grandes, pero el cache en el front lo compensa.

Estructura de archivos
odoo-addons/
├── pos_offline_info/
│   ├── __init__.py
│   ├── __manifest__.py
│   ├── models/
│   │   ├── pos_order.py          # inyección pos_src_location_id en moves, fix post-creación
│   │   ├── pos_order_line.py     # campo pos_src_location_id en líneas
│   │   ├── stock_move.py         # campo pos_order_line_id y enforcement de location_id
│   │   └── stock_picking.py      # si aplica: hooks adicionales
│   ├── static/
│   │   ├── src/js/
│   │   │   └── choose_location_on_validate.js   # selector y hook de inyección
│   │   └── src/xml/
│   │       └── product_info_where.xml          # bloque “Dónde hay stock” en popup
│   └── views/
│       └── pos_order_line_views.xml            # añadir campo en vistas
└── pos_stock_where/
    ├── __init__.py
    ├── __manifest__.py
    └── models/
        └── product.py                          # pos_where() y pos_where_bulk()

Licencia

pos_offline_info: LGPL-3 (según __manifest__.py).

pos_stock_where: LGPL-3 (o la indicada en su manifiesto).

Si publicas el repo, añade una LICENSE explícita y revisa los manifiestos para mantener consistencia.

Extra: checklist de despliegue

 Módulos copiados al addons_path.

 Dependencias instaladas: point_of_sale, stock (+ pos_restrict_stock_wh si lo usas).

 Actualizar módulos (-u pos_offline_info,pos_stock_where) o subir version en manifest para recompilar assets.

 Confirmar en odoo shell que los overrides están activos.

 Prueba online: abrir ficha de producto → ver “Dónde hay stock”.

 Prueba validación: ticket con un producto que exista en 2 sub-ubicaciones → aparece selector, elegir una → el stock.move.location_id debe ser esa sub-ubicación.

 Prueba offline: cortar red, usar cache, validar → al volver online, verificar moves con origen correcto.
