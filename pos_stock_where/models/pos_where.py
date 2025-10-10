from odoo import api, fields, models

class PosConfig(models.Model):
    _inherit = "pos.config"

    show_sublocation_stock = fields.Boolean(
        string="Mostrar stock por sububicación (POS)", default=True
    )
    sublocation_scope = fields.Selection(
        [("immediate", "Solo hijas directas"), ("all", "Todas las descendientes")],
        default="immediate",
        string="Ámbito sububicaciones (informativo)",
        help="Cómo agrupar el desglose mostrado en el POS. No afecta a la restricción de venta.",
    )

class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def pos_where(self, product_id, config_id):
        """Devuelve [{location_id, complete_name, qty, is_origin}] bajo el origen del POS."""
        product = self.browse(product_id)
        config = self.env["pos.config"].browse(config_id)
        if not product.exists() or not config.exists():
            return []

        picking_type = config.picking_type_id
        root = picking_type.default_location_src_id
        if not root:
            return []

        if config.sublocation_scope == "all":
            locs = self.env["stock.location"].search(
                [("id", "child_of", root.id), ("usage", "=", "internal")]
            )
            top_children = self.env["stock.location"].search(
                [("location_id", "=", root.id), ("usage", "=", "internal")]
            )
            buckets = top_children or [root]
        else:
            buckets = self.env["stock.location"].search(
                [("location_id", "=", root.id), ("usage", "=", "internal")]
            ) or [root]

        res = []
        for loc in buckets:
            rg = self.env["stock.quant"].read_group(
                [
                    ("product_id", "=", product.id),
                    ("location_id", "child_of", loc.id),
                ],
                ["quantity:sum", "reserved_quantity:sum"],
                []
            )
            qty = ((rg[0]["quantity"] if rg else 0.0) -
                   (rg[0]["reserved_quantity"] if rg else 0.0))
            res.append({
                "location_id": loc.id,
                "complete_name": loc.complete_name,
                "qty": qty,
                "is_origin": loc.id == root.id,
            })

        return sorted(res, key=lambda x: x["complete_name"])
