# __manifest__.py
{
    "name": "POS Offline Product Info",
    "version": "17.0.1.0.154",  # bump para recompilar assets
    "depends": ["point_of_sale", "stock", "pos_stock_where", "pos_restrict_stock_wh"],
    "author": "Alvaro Casti Soto",
    "license": "LGPL-3",
    "category": "Point of Sale",
    "summary": "Cache product info for offline POS usage",
    "description": """
        Cachea y muestra info de producto/stock en el POS (incluye ubicaciones) con soporte offline.
    """,
    "data": [
        "views/pos_order_line_views.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            # 1) IndexedDB primero (bootstrap + interceptores POS)
            "pos_offline_info/static/src/js/idb_bootstrap.js",
            "pos_offline_info/static/src/js/cache_indexeddb.js",
            # 2) Elección de sub-ubicación en VALIDATE (debe ir antes de reservations)
            "pos_offline_info/static/src/js/allowed_locations_cache.js",
            "pos_offline_info/static/src/js/choose_location_on_validate.js",
            # 3) Persistir reservas offline por producto/ubicación (usa lo elegido arriba)
            "pos_offline_info/static/src/js/reservations_on_validate.js",
            # 4) Reservas de sesión (bus de eventos para overlays en el popup)
            "pos_offline_info/static/src/js/session_reservations.js",
            # 5) Servicios auxiliares
            "pos_offline_info/static/src/js/auto_flush_on_online.js",
            "pos_offline_info/static/src/js/post_sale_refresh.js",
            "pos_offline_info/static/src/js/prefetch_service.js",
            # 6) Info de producto (cache + endurecido)
            "pos_offline_info/static/src/js/patch_getproductinfo.js",
            "pos_offline_info/static/src/js/product_info_patch.js",
            "pos_offline_info/static/src/js/offline_heartbeat.js",
            "pos_offline_info/static/src/css/offline_banner.css",
        ],
    },
    "installable": True,
}
