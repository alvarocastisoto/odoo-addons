{
    "name": "POS Offline Product Info",
    "version": "17.0.1.0.60",
    "summary": "Precarga y cachea info de producto para ProductInfoPopup (offline).",
    "author": "Galvintec / Álvaro",
    "license": "LGPL-3",
    "depends": ["point_of_sale", "stock", "pos_stock_where"],
    "assets": {
        "point_of_sale._assets_pos": [
            "pos_offline_info/static/src/js/offline_cache.js",
            "pos_offline_info/static/src/js/patch_getproductinfo.js",
            "pos_offline_info/static/src/js/product_info_patch.js",
        ],
    },
    "installable": True,
}
