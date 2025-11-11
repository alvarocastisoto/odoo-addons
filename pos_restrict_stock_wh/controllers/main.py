# controllers/main.py
from odoo import http, _
from odoo.exceptions import AccessError


class PosRestrictStockWh(http.Controller):
    @http.route("/pos_restrict_stock_wh/where_available", type="json", auth="user")
    def where_available(self, product_id, config_id=None, company_id=None, limit=200):
        """Devuelve stock libre (qty - reserved) por ubicación interna del árbol del TPV.
        Árbol = child_of(default_location_src_id) del picking_type del pos.config dado.
        """
        env = http.request.env
        user = env.user

        if not user.has_group("point_of_sale.group_pos_user"):
            raise AccessError(_("No tiene permisos para consultar stock de POS."))

        # compañías permitidas para el usuario
        allowed_companies = set(env.companies.ids)
        if company_id:
            company_id = int(company_id)
            if company_id not in allowed_companies:
                raise AccessError(_("Compañía no permitida."))
            company_ids = [company_id]
        else:
            company_ids = list(allowed_companies)

        # pos.config requerido para saber el root
        if not config_id:
            raise AccessError(_("Falta config_id."))
        config = env["pos.config"].sudo().browse(int(config_id))
        if not config or not config.exists():
            raise AccessError(_("Configuración de TPV inválida."))

        ptype = config.picking_type_id
        root = ptype.default_location_src_id
        if not root:
            raise AccessError(
                _("El tipo de operación del TPV no tiene ubicación origen configurada.")
            )

        Quant = env["stock.quant"].sudo()  # mantiene allowed_company_ids del contexto
        data = Quant.read_group(
            domain=[
                ("product_id", "=", int(product_id)),
                ("location_id", "child_of", root.id),
                ("location_id.usage", "=", "internal"),
                ("company_id", "in", company_ids),
            ],
            fields=["quantity:sum", "reserved_quantity:sum"],
            groupby=["location_id"],
            limit=limit,
        )

        rows = []
        for rec in data:
            qty = rec.get("quantity") or 0.0
            res = rec.get("reserved_quantity") or 0.0
            free = qty - res
            if free < 0:
                free = 0.0
            rows.append(
                {
                    "location_id": rec["location_id"][0],
                    "location": rec["location_id"][1],
                    "free_qty": free,  # ← principal para el guard
                    "quantity": qty,
                    "reserved": res,
                }
            )
        return rows

    @http.route("/pos_restrict_stock_wh/where_available_all", type="json", auth="user")
    def where_available_all(self, product_id, company_id=None, limit=500):
        """Devuelve stock libre (qty - reserved) por TODA ubicación interna de la(s) compañía(s) permitidas.
        Sirve para proponer otras tiendas ajenas al árbol del POS actual."""
        env = http.request.env
        user = env.user

        if not user.has_group("point_of_sale.group_pos_user"):
            raise AccessError(_("No tiene permisos para consultar stock de POS."))

        allowed_companies = set(env.companies.ids)
        if company_id:
            company_id = int(company_id)
            if company_id not in allowed_companies:
                raise AccessError(_("Compañía no permitida."))
            company_ids = [company_id]
        else:
            company_ids = list(allowed_companies)

        Quant = env["stock.quant"].sudo()
        data = Quant.read_group(
            domain=[
                ("product_id", "=", int(product_id)),
                ("location_id.usage", "=", "internal"),
                ("company_id", "in", company_ids),
            ],
            fields=["quantity:sum", "reserved_quantity:sum"],
            groupby=["location_id"],
            limit=limit,
        )

        rows = []
        for rec in data:
            qty = rec.get("quantity") or 0.0
            res = rec.get("reserved_quantity") or 0.0
            free = max(qty - res, 0.0)
            rows.append(
                {
                    "location_id": rec["location_id"][0],
                    "location": rec["location_id"][1],
                    "free_qty": free,
                    "quantity": qty,
                    "reserved": res,
                }
            )
        return rows
