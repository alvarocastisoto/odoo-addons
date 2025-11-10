from odoo import fields, models

class PosConfig(models.Model):
    _inherit = "pos.config"

    restrict_out_of_stock = fields.Boolean(
        string="Restringir venta sin stock (ubicación POS)",
        help="Bloquea pedidos en el TPV si en la ubicación origen del POS no hay stock suficiente.",
    )
