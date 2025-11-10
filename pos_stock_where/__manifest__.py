# __manifest__.py
{
  "name": "POS Stock Where (sublocations)",
  "version": "17.0.1.1.122",   # bump para romper caché
  "summary": "Muestra en POS el stock por sububicación bajo la ubicación origen.",
  "author": "Alvaro Casti Soto",
  "license": "LGPL-3",
  "depends": ["point_of_sale", "stock"],
  "assets": {
    "point_of_sale._assets_pos": [
      "pos_stock_where/static/src/js/where_buttons.js",
    #   "pos_stock_where/static/src/xml/where_templates.xml",
    #   "pos_stock_where/static/src/css/where.css",
    ],
  },
  "installable": True,
}
