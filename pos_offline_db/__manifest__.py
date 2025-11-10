{
  "name": "POS Offline DB",
  "version": "17.0.1.0.122",
  "summary": "Para asegurarse de guardar los pedidos cuando se cae la conexión.",
  "author": "David Baquero Amaral",
  "license": "LGPL-3",
  "depends": ["point_of_sale"],
  "assets": {
    "point_of_sale._assets_pos": [
      "pos_offline_db/static/src/js/pos_offline_db.js",
      "pos_offline_db/static/src/js/pos_offline.js",
    ],
  },
  "installable": True
}
