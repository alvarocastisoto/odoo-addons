# POS Stock Where (Odoo 17)

**Nombre técnico:** `pos_stock_where`

Módulo de utilidad para el TPV (Point of Sale) de Odoo 17 que amplía la visibilidad del inventario. Permite consultar la disponibilidad de un producto en **todas las ubicaciones internas** de la compañía, no solo en la tienda actual.

Funciona como un módulo independiente para consultas online o como proveedor de datos ("Informante") para sistemas offline más complejos.

---

## 🚀 Características Principales

* **Visibilidad Multi-Almacén:** Muestra el stock agrupado por Almacén y Sububicación (Estantería, Pasillo, etc.).
* **Optimización SQL:** Utiliza `read_group` en el backend para agregar cantidades masivamente sin iterar objetos Python, garantizando alto rendimiento incluso con miles de quants.
* **Normalización de Nombres:** Convierte rutas técnicas (`WH/Stock/Shelf 1`) en nombres legibles para el cajero (`Almacén Central · Shelf 1`).
* **Integración Transparente:**
    * Si se instala solo: Inyecta la información en el popup de info del producto (`ProductInfoPopup`).
    * Si se detecta `pos_offline_info`: Cede el control de la visualización para evitar conflictos y actúa como proveedor de datos backend.

---

## 📋 Requisitos

* **Odoo 17** (POS basado en OWL).
* Módulos dependientes:
    * `point_of_sale`
    * `stock`

---

## 🛠️ Arquitectura Técnica

### Backend (`models/product.py`)
* **Método `pos_where_bulk`:**
    * Recibe una lista de IDs de productos.
    * Realiza una consulta agregada (`read_group`) sobre `stock.quant` filtrando por `usage='internal'`.
    * Mapea los IDs de ubicación a la estructura de almacenes (`stock.warehouse`) para generar etiquetas amigables.
    * Ordena los resultados priorizando la ubicación por defecto de la tienda actual.
* **Seguridad:** Utiliza `sudo()` acotado estrictamente a lectura de cantidades y nombres, filtrando siempre por la `company_id` de la configuración del TPV.

### Frontend (`where_buttons.js`)
* Parchea `ProductInfoPopup` para cargar los datos de stock al montar el componente.
* Implementa detección de conflictos: verifica si `ProductInfoPopup.prototype.__pos_where_owner__` está definido. Si otro módulo (como `pos_offline_info`) ya ha reclamado la gestión del popup, este módulo se inhibe visualmente para no duplicar información.

---

## 📖 Uso

1.  En el TPV, abre la ficha de información de cualquier producto (icono "Info").
2.  Se desplegará una sección nueva mostrando el desglose de stock.
3.  Podrás ver qué cantidad exacta hay en el Almacén Central, Tiendas Satélite o ubicaciones de reserva.

---

## 📦 Instalación

1.  Clonar o copiar la carpeta `pos_stock_where` en tu directorio de addons.
2.  Actualizar la lista de aplicaciones.
3.  Instalar **POS Stock Where**.

---

## 📄 Licencia y Autoría

* **Licencia:** LGPL-3
* **Autor:** Álvaro Casti Soto (`alvarocastisoto`)
