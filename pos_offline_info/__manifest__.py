# __manifest__.py
{
    "name": "POS Offline Product Info",
    "version": "17.0.1.0.22",
    "depends": ["point_of_sale", "stock", "pos_stock_where"],
    "author": "Alvaro casti Soto",
    "category": "Point of Sale",
    "summary": "Cache product info for offline POS usage",
    "description": """
        This module enhances the Point of Sale (POS) system by caching product information locally.
        It ensures that essential product details are available even when the POS is offline,
        improving the user experience and operational efficiency.
    """,
    "assets": {
        "point_of_sale._assets_pos": [
            "pos_offline_info/static/src/js/session_reservations.js",
            "pos_offline_info/static/src/js/reservations_on_validate.js",
            "pos_offline_info/static/src/js/auto_flush_on_online.js",
            "pos_offline_info/static/src/js/post_sale_refresh.js",
            "pos_offline_info/static/src/js/prefetch_service.js",
            "pos_offline_info/static/src/js/patch_getproductinfo.js",
            "pos_offline_info/static/src/js/product_info_patch.js",
        ],
    },
    "installable": True,
}
