# Odoo Addons (POS · Stock · Offline) — by Álvaro Castiñeira

Colección de módulos para **Odoo 17 Community** orientados a **TPV**, **multi-almacén** y **operación offline**. Permiten:
- Elegir **sub-ubicación de salida** por línea en el cobro.
- Consultar **dónde hay stock** desde el POS (incluye **caché offline**).
- **Restringir** desde qué almacenes puede vender cada **TPV**.

> Probado con **Odoo 17 CE** (Docker/Doodba). Licencia **LGPL-3**.

---

## Índice

- [Módulos incluidos](#módulos-incluidos)
  - [pos_offline_info](#pos_offline_info)
  - [pos_stock_where](#pos_stock_where)
  - [pos_restrict_stock_wh](#pos_restrict_stock_wh)
- [Instalación](#instalación)
- [Uso rápido](#uso-rápido)
- [Compatibilidad y dependencias](#compatibilidad-y-dependencias)
- [Notas de desarrollo](#notas-de-desarrollo)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Roadmap](#roadmap)
- [Licencia](#licencia)

---

## Módulos incluidos

### `pos_offline_info`
**Qué aporta**
- **Selector de sub-ubicación** al validar el pago (por línea). Guarda `pos_src_location_id` y fuerza el `stock.move.location_id` de salida.
- **Caché offline** de info “dónde hay stock” para usar el popup de producto sin conexión.
- Re-asignación de movimientos para que el picking **salga desde la sub-ubicación** elegida, aunque el POS esté configurado en el padre (`/Stock`).

**Dónde está**
- Carpeta: `pos_offline_info/`

**Cómo se usa**
- En el cobro, si el producto existe en varias sub-ubicaciones, aparece un popup para **elegir** (p. ej. `arriba`/`abajo`).  
- El texto del selector es **en castellano** y puedes elegir mostrar u ocultar la cantidad disponible.

---

### `pos_stock_where`
**Qué aporta**
- Método backend `pos_where`/`pos_where_bulk` que devuelve, por producto, **todas las sub-ubicaciones internas** con su **disponible**.
- UI en el **Product Info Popup** para ver **dónde hay stock** (incluye integración con caché offline del módulo anterior).

**Dónde está**
- Carpeta: `pos_stock_where/`

**Cómo se usa**
- En la ficha del producto en el POS, abre el popup de info: verás las ubicaciones donde hay stock y su cantidad.  
- Funciona **online** y se apoya en la **caché** si no hay conexión.

---

### `pos_restrict_stock_wh`
**Qué aporta**
- **Restringe** qué **almacenes/ubicaciones** puede usar cada **TPV** (útil para multitienda).
- Evita vender accidentalmente desde ubicaciones no autorizadas.

**Dónde está**
- Carpeta: `pos_restrict_stock_wh/`

**Cómo se usa**
- Configura en el **TPV** las ubicaciones permitidas. El POS solo opera sobre ellas.

---

## Instalación

1. Copia las carpetas de módulos dentro de tu path de addons (o añade este repo a tu ruta de addons).
2. Actualiza la lista de módulos y **instala**:
   - `pos_stock_where`
   - `pos_restrict_stock_wh`
   - `pos_offline_info`
3. **Recompila assets** del POS (actualiza `version` en `__manifest__.py` si usas Doodba para forzar rebuild) y **reinicia** el contenedor/servicio.

> Orden recomendado: primero `pos_stock_where`, luego `pos_restrict_stock_wh`, y por último `pos_offline_info`.

---

## Uso rápido

- **Elegir sub-ubicación al pagar**: al validar, por cada línea se muestra un selector si hay varias sub-ubicaciones con stock. La elección se **inyecta** en el payload que sube a servidor y se enlaza al `stock.move` resultante.
- **Ver “dónde hay stock”**: desde el popup de info del producto. Si no hay red, se usa **caché local**.
- **Restringir almacenes del TPV**: define en la configuración del TPV qué ubicaciones están permitidas.

---

## Compatibilidad y dependencias

- Odoo **17.0 Community**.
- Depende de módulos base de **POS** y **Stock**.  
- `pos_offline_info` integra con `pos_stock_where` para la caché offline del “dónde hay stock”.
- Multicompañía soportada: el cómputo de stock se filtra por `company_id`.

---

## Notas de desarrollo

- Los JS del POS parchean de forma **no intrusiva** (OWL/patch) servicios como `PaymentScreen.validateOrder` y el guardado `_save_to_server`, inyectando `pos_src_location_id` por línea.
- En backend:
  - Se añade `pos_order_line_id` al `stock.move`.
  - Se fuerza `move.location_id` según la **sub-ubicación** elegida y se re-asignan reservas si hace falta.
- Para forzar rebuild de assets, sube `version` en el manifest (p. ej. `17.0.1.0.X`).

---

## Limitaciones conocidas

- Si varias líneas del mismo producto comparten picking, el enlace `move ↔ pos.order.line` se resuelve por **vínculo directo** y, si no existe, por **fallback** por producto (primera coincidencia).
- Si el TPV apunta a una **ubicación padre** (vista), el módulo reubica los `moves` a la **sub-ubicación** elegida; asegúrate de que las sub-ubicaciones son de **uso interno**.

---

## Roadmap

- Preferencias de **UI** para mostrar/ocultar cantidades en el selector.
- Mejoras en el **match** de líneas a movimientos cuando hay productos repetidos con lotes/series.
- Soporte de **trazas** (lotes/serial) en el flujo de sub-ubicación.

---

## Licencia

Este repositorio se publica bajo **LGPL-3**.
