{
    "name": "POS Editar ticket",
    "version": "17.0.1.0.0",
    "category": "Sales/Point of Sale",
    "depends": ["point_of_sale"],
    "assets": {
        "point_of_sale._assets_pos": [
            'pos_edit_receipt/static/src/lib/qrcode.min.js',
            "pos_edit_receipt/static/src/js/test_conexion.js",
            "pos_edit_receipt/static/src/js/iva_lineas_productos.js",
            "pos_edit_receipt/static/src/js/separador.js",
            "pos_edit_receipt/static/src/css/styles.css",
        ]
    },
    "installable": True,
}
