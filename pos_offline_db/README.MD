# pos_offline_db

Autor: David Baquero

Descripción
-----------
Módulo para Odoo 17 que fuerza el uso de IndexedDB en el Point of Sale (POS). Cuando el POS está sin conexión, los pedidos se almacenan localmente en IndexedDB para su posterior sincronización.

Características principales
- Almacena pedidos del POS en IndexedDB cuando no hay conexión.
- Permite la sincronización posterior de pedidos cuando la conexión se restablece.

Requisitos
- Odoo 17
- Punto de venta (Point of Sale)
- Navegador con soporte para IndexedDB (prácticamente todos los navegadores modernos)

Instalación
----------
1. Copia la carpeta del módulo a la carpeta de addons de tu instalación de Odoo.
2. Reinicia el servidor de Odoo.
3. Actualiza la lista de aplicaciones e instala el módulo desde la interfaz de Odoo.

Uso
---
Una vez instalado, el POS utilizará IndexedDB para almacenar los pedidos realizados mientras el terminal esté offline. Cuando el terminal recupere la conexión, los pedidos permanecerán en la base local hasta que se implemente/ejecute la lógica de sincronización.

Funcionamiento
--------------

Cuando se crea la sesión, abre el indexedDB por si se llega a caer la conexión. En caso de que no tenga conexión, bloquea la sincronización normal de odoo, añade el pedido al indexedDB y borra todas las referncias que pueda guardarse en cualquier otro lugar. Cuando vuelve la conexión, sube los datos del indexedDB a la base de datos de odoo y vacía los datos del indexed para que no haya en un futuro pedidos duplicados.

Nota sobre los assets
---------------------
Si renombraste la carpeta del módulo o la estructura difiere del ejemplo, actualiza las rutas de los assets en `__manifest__.py` para que apunten correctamente a los archivos JS/CSS incluidos.

Ejemplo (si la carpeta del módulo se llama `mi_nombre_modulo`):

```py
'assets': {
    'point_of_sale.assets': [
        'mi_nombre_modulo/static/src/js/pos_offline_db.js',
        'mi_nombre_modulo/static/src/js/pos_offline.js',
    ],
},
```

Estructura sugerida del módulo
------------------------------
```
pos_offline_db/
├─ __init__.py
├─ __manifest__.py
├─ models/
│  └─ __init__.py
├─ static/
│  └─ src/
│     └─ js/
        ├─ pos_offline_db.js
        └─ pos_offline.js

Contacto y contribuciones
-------------------------
Autor: David Baquero

Si quieres contribuir, por favor abre un issue o un pull request en el repositorio del módulo. Agradezco reportes de errores, propuestas de mejora y parches.
