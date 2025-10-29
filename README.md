Odoo Addons (POS · Stock · Offline) — by Álvaro Castiñeira

Colección de módulos para Odoo 17 Community centrados en TPV (Point of Sale), multi-almacén, y mejoras de operación offline. El objetivo es cubrir necesidades reales de tienda: elegir sub-ubicación de salida, limitar desde qué almacenes se puede vender, y exponer de forma clara “dónde hay stock” directamente en el POS.

⚙️ Probado con Odoo 17 CE (Docker/Doodba). Licencia LGPL-3.

Índice

Módulos incluidos

pos_stock_where

pos_restrict_stock_wh

Instalación

Uso rápido

Compatibilidad y dependencias

Consejos de desarrollo (Docker/Doodba)

Roadmap

Licencia

Soporte

Módulos incluidos
pos_stock_where

Qué hace

Añade un endpoint seguro (server) que consolida “dónde hay stock” por producto usando stock.quant (agrupado por location_id, solo ubicaciones internas y compañía del TPV).

En el front del POS, muestra esta información en el Product Info y la caché offline en localStorage, para poder consultarla aunque se caiga la conexión.

Normaliza la ruta de ubicación para mostrar solo el último segmento en el selector (p. ej., arriba / abajo), evitando rutas largas.

Cómo funciona (resumen técnico)

Backend: read_group sobre stock.quant → compone filas por producto con:

location_id, complete_name, qty (on-hand), warehouse_name, path relativo al lot_stock_id del almacén.

Ordena priorizando la ubicación base del POS (si aplica) y nombre.

Frontend:

Capa de caché en localStorage por base de datos/compañía/config del POS.

El selector de ubicación en el flujo de pago muestra opciones únicas por location_id y solo el “leaf” (último segmento).

Literal en castellano; la cantidad es opcional y puede ocultarse.

Cuándo usarlo

Si quieres visualizar rápidamente en qué sub-ubicación hay existencias por producto desde el TPV (con o sin conexión).

pos_restrict_stock_wh

Qué hace

Restringe desde qué almacenes/ubicaciones se puede vender en el POS.

Evita ventas desde almacenes no permitidos (útil con múltiples tiendas o backstores).

Cómo funciona (resumen técnico)

Añade lógica de validación en POS para forzar que las órdenes y reservas/movimientos salgan solo de ubicaciones permitidas por configuración.

Cuándo usarlo

Si tienes varios almacenes/sub-ubicaciones y necesitas garantizar que cada TPV solo descuente stock de las zonas que le correspondan.

Instalación

Para Odoo 17 CE. Si usas Doodba + Docker, revisa también la sección de desarrollo.

Clona o copia este repo en un directorio que esté en tu addons_path.

Actualiza la lista de Apps en Odoo.

Instala los módulos deseados desde Apps:

pos_stock_where

pos_restrict_stock_wh

Reinicia el servicio de Odoo tras instalar (recomendado si hay JS/CSS).

Cuando modifiques JS del POS, incrementa version en __manifest__.py para romper caché de assets y recarga el POS.

Comandos útiles (Docker estándar)
# actualizar apps + instalar módulo
odoo -d <DB> -u pos_stock_where,pos_restrict_stock_wh --stop-after-init


Con Doodba:

docker compose up -d
docker compose logs -f odoo

Uso rápido
Flujo recomendado (multi-ubicación bajo un almacén “padre”)

Configura tu almacén principal con sub-ubicaciones internas (p. ej., mar/Stock/arriba, mar/Stock/abajo).

En Ajustes del TPV, apunta el POS a la ubicación padre del almacén (p. ej., mar/Stock).

El módulo no “rompe” el picking: seguirá saliendo del padre, pero te permitirá elegir la sub-ubicación de origen por línea.

En el POS, al pagar:

Para cada línea sin origen fijado, se abrirá un selector de ubicación con las sub-ubicaciones donde hay stock (o la del POS por defecto si no hay datos).

Se muestra solo el último segmento (ej.: arriba / abajo), en castellano.

Al validar el ticket:

La línea viaja con pos_src_location_id.

Los stock.move se crean/vinculan a la pos.order.line y se reubican a la sub-ubicación elegida, re-reservando si fuese necesario.

Conexión caída: el POS sigue mostrando los datos cacheados (“dónde hay”) y deja elegir sub-ubicación igualmente; al volver online, se sincroniza.

Compatibilidad y dependencias

Versión: Odoo 17.0 (Community).

Depende: point_of_sale, stock.
Algunos flujos combinan bien con pos_restrict_stock_wh.

Multi-compañía: el cálculo de “dónde hay” filtra por company_id del TPV.

Ubicaciones: solo internas; se ignoran vistas/otras usage.

Consejos de desarrollo (Docker/Doodba)

Romper caché de assets: sube version en __manifest__.py al tocar JS/OWL.

Logs útiles:

Busca trazas propias en el contenedor:

docker compose logs -f odoo | grep "POS SRC"


Verificación Rápida en odoo shell:

Inspeccionar último picking y sus moves:

o = env["pos.order"].search([], order="id desc", limit=1)
p = o.picking_ids[:1]
for m in p.move_ids_without_package:
    print("MOVE", m.id,
          "src:", m.location_id.complete_name,
          "line_id:", (m.pos_order_line_id and m.pos_order_line_id.id) or False,
          "line_src:", (m.pos_order_line_id and m.pos_order_line_id.pos_src_location_id and m.pos_order_line_id.pos_src_location_id.complete_name) or False)


Estructura de caché (front):

localStorage clave: POS_OFFLINE_INFO/v17/<db>/<company>/<config>

Guarda por product_id → where[] (filas normalizadas por ubicación).

Roadmap

Modo “solo online/offline forzado” con indicadores en UI.

Métricas de tiempo de refresco y recacheo granular por evento.

Extender soporte a Odoo 18/19 (cuando encaje).

Tests unitarios para fallback de enlaces pos_order_line_id ↔ stock.move.

Licencia

LGPL-3. Revisa el encabezado de cada módulo para detalles.

Soporte

Issues y mejoras: abre un Issue en GitHub con pasos y logs.

Pull Requests bienvenidos 😊
