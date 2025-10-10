from odoo import http

class PosRestrictStockWh(http.Controller):
    @http.route("/pos_restrict_stock_wh/where_available", type="json", auth="user")
    def where_available(self, product_id):
        env = http.request.env
        Quant = env["stock.quant"].sudo()
        res = Quant.read_group(
            domain=[
                ("product_id", "=", int(product_id)),
                ("quantity", ">", 0),
                ("location_id.usage", "=", "internal"),
            ],
            fields=["quantity:sum"],
            groupby=["location_id"],
        )
        return [{"location": r["location_id"][1], "qty": r["quantity"]} for r in res]
