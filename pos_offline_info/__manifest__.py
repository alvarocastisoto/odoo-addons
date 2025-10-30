# __manifest__.py
{
    "name": "POS Offline Product Info",
    "version": "17.0.1.0.87",  # súbela para forzar recompilar assets
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
            "pos_offline_info/static/src/js/session_reservations.js",
            "pos_offline_info/static/src/js/reservations_on_validate.js",
            "pos_offline_info/static/src/js/auto_flush_on_online.js",
            "pos_offline_info/static/src/js/post_sale_refresh.js",
            "pos_offline_info/static/src/js/prefetch_service.js",
            "pos_offline_info/static/src/js/patch_getproductinfo.js",
            "pos_offline_info/static/src/js/product_info_patch.js",
            "pos_offline_info/static/src/js/choose_location_on_validate.js",
        ],
        "web.assets_qweb": [  # <-- aquí, no "qweb"
            "pos_offline_info/static/src/xml/product_info_where.xml",
        ],
    },
    "installable": True,
}
