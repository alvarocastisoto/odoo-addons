# __manifest__.py
{
    "name": "POS Offline Product Info",
    "version": "17.0.1.0.82",
    "depends": ["point_of_sale", "stock", "pos_stock_where", "pos_restrict_stock_wh"],
    "author": "Alvaro Casti Soto",
    "license": "LGPL-3",
    "category": "Point of Sale",
    "summary": "Cache product info for offline POS usage",
    "description": """
        This module enhances the Point of Sale (POS) system by caching product information locally.
        It ensures that essential product details are available even when the POS is offline,
        improving the user experience and operational efficiency.
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
            "pos_offline_info/static/src/xml/product_info_where.xml",
        ],
    },
    "installable": True,
}
