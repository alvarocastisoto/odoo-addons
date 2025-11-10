{
    "name": "POS Restrict Stock per Warehouse",
    "summary": "Bloquea añadir líneas en POS si no hay stock en el árbol del TPV.",
    "version": "17.0.1.0.37",
    "license": "LGPL-3",
    "author": "Alvaro Casti Soto",
    "website": "https://github.com/alvarocastisoto/odoo-addons",
    "depends": ["point_of_sale", "stock"],
    "data": [
        "views/pos_config_views.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "pos_restrict_stock_wh/static/src/js/block_on_add.js",
        ],
    },
    "installable": True,
    "application": False,
}
