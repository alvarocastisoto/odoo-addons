# controllers/main.py
from odoo import http, _
from odoo.exceptions import AccessError

class PosRestrictStockWh(http.Controller):
    @http.route("/pos_restrict_stock_wh/where_available", type="json", auth="user")
    def where_available(self, product_id, company_id=None, limit=50):
        """Devuelve ubicaciones internas con stock>0 para product_id,
        restringidas a las compañías del usuario o a company_id si se da."""
        env = http.request.env
        user = env.user
        if not user.has_group("point_of_sale.group_pos_user"):
            # Evita filtrar stock a usuarios que no operan POS
            raise AccessError(_("No tiene permisos para consultar stock de POS."))

        # Restringe por compañías permitidas (o explícita si se pasa y está permitida)
        allowed = set(env.companies.ids)
        if company_id:
            company_id = int(company_id)
            if company_id not in allowed:
                raise AccessError(_("Compañía no permitida."))
            company_ids = [company_id]
        else:
            company_ids = list(allowed)

        Quant = env["stock.quant"].sudo()  # sudo mantiene allowed_company_ids en el contexto
        data = Quant.read_group(
            domain=[
                ("product_id", "=", int(product_id)),
                ("quantity", ">", 0),
                ("location_id.usage", "=", "internal"),
                ("company_id", "in", company_ids),
            ],
            fields=["quantity:sum"],
            groupby=["location_id"],
            limit=limit,
        )
        # Estructura simple para UI
        return [{"location": rec["location_id"][1], "qty": rec["quantity"]} for rec in data]
