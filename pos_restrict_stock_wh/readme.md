# pos_restrict_stock_wh — Odoo 17 CE

Restringe las ventas del **TPV** a un conjunto de **ubicaciones internas permitidas** y evita vender productos **sin stock** en dichas ubicaciones. Ideal para tiendas con sub-ubicaciones (p. ej. `tienda/stock/arriba`, `tienda/stock/abajo`).

- **Compatibilidad:** Odoo 17 **Community**  
- **Dependencias:** `point_of_sale`, `stock`  
- **Licencia:** LGPL-3  
- **Estado:** Producción

---

## Índice
- [¿Qué aporta?](#qué-aporta)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Uso](#uso)
- [Integración recomendada](#integración-recomendada)
- [Cómo funciona (técnico)](#cómo-funciona-técnico)
- [Compatibilidad y límites](#compatibilidad-y-límites)
- [Solución de problemas](#solución-de-problemas)
- [Créditos](#créditos)
- [Licencia](#licencia)

---

## ¿Qué aporta?
- ✅ **Lista blanca** de ubicaciones fuente por **TPV** (en `Ajustes del TPV`).
- ✅ **Bloqueo** de la venta si **no hay stock** en las ubicaciones permitidas.
- ✅ Mensajes de error claros en el TPV cuando falta stock.
- ✅ Soporte **multi-almacén** y **multi-compañía**.
- ✅ Encaja con flujos de tienda con **sub-ubicaciones reales**.

> Si no configuras nada, Odoo seguirá usando el **origen estándar** del TPV (ubicación del tipo de picking).

---

## Requisitos
- Odoo 17 **Community**.
- Módulos: `point_of_sale`, `stock`.

---

## Instalación
1. Copia esta carpeta `pos_restrict_stock_wh` a tu ruta de _addons_.  
2. Reinicia Odoo y **Actualiza lista de aplicaciones**.  
3. Instala **pos_restrict_stock_wh** desde **Apps**.

> Con Doodba/Docker: añade el módulo al `addons.yaml`, reconstruye imagen/volúmenes y actualiza.

---

## Configuración
1. Ve a **Punto de Venta → Configuración → TPV**.  
2. En tu configuración de TPV, localiza el bloque **Ubicaciones permitidas (venta)**.  
3. Añade **todas las sub-ubicaciones internas** desde las que este TPV puede descontar stock.  
4. (Opcional) Activa **Permitir vender sin stock** si quieres solo **avisar** (en lugar de bloquear).

---

## Uso
- Al **añadir** productos o **validar** el pedido, el módulo calcula la disponibilidad **solo** en las ubicaciones permitidas.
- Si el stock **agregado** en esas ubicaciones es **0**, se **bloquea** la acción (o se muestra aviso si habilitaste la opción).

---

## Integración recomendada
Este módulo brilla junto a otros de este repositorio:

- **`pos_stock_where`**: muestra en el *Product Info* **dónde** hay stock (por sub-ubicación).  
- **`pos_offline_info`**: cachea info para **modo offline** y permite **elegir sub-ubicación por línea** al validar.  
  - Con ambos, el vendedor elige “arriba/abajo” y esta restricción garantiza que solo se use **ubicación permitida**.

---

## Cómo funciona (técnico)
- **Servidor (Python):**
  - Extensión de `pos.config` con un campo **Many2many** de ubicaciones **internas** permitidas.
  - Helpers que calculan stock **agregado** filtrando `stock.quant` por `location_id` ∈ permitidas.
  - Hooks en creación/validación de `pos.order` para **impedir** ventas sin stock en dichas ubicaciones (o avisar).

- **Cliente (POS/JS):**
  - Parches ligeros en TPV para mostrar mensajes de error/aviso cuando la disponibilidad es 0 en las ubicaciones permitidas.
  - No modifica flujos de cobro; solo **valida** la disponibilidad en el momento oportuno.

> Si usas `pos_offline_info`, los movimientos de salida pueden **forzarse** a la sub-ubicación elegida por línea (vía `location_id` en `stock.move`).

---

## Compatibilidad y límites
- Diseñado para **Odoo 17 CE**.  
- Soporta **multi-compañía** (filtra por compañía del TPV).  
- Si tu stock se gestiona con reglas especiales (p. ej., _packaging_ complejo, rutas MTO/MTS mixtas), revisa el flujo en un entorno de pruebas.

---

## Solución de problemas
- **“No hay stock en ubicaciones permitidas”**  
  - Revisa la **lista de ubicaciones** en el TPV.  
  - Comprueba `Inventario → Informes → Existencias por ubicación` para esas sub-ubicaciones.  
- **Se permite vender sin stock**  
  - Desactiva **Permitir vender sin stock** en la configuración del TPV.  
- **Con `pos_offline_info` no me fuerza el origen**  
  - Verifica que el selector por línea está activo y que el `location_id` llega al `stock.move`.  
  - Mira los logs del servidor buscando trazas del módulo.

---

## Créditos
- Autor: **Álvaro Castiñeira** ([@alvarocastisoto](https://github.com/alvarocastisoto))

---

## Licencia
LGPL-3. Consulta el fichero `LICENSE` si procede.
