# -*- coding: utf-8 -*-
from odoo import fields, models

class PosOrderLine(models.Model):
    _inherit = "pos.order.line"

    pos_src_location_id = fields.Many2one(
        "stock.location",
        string="Ubicación origen (POS)",
        help="Origen de stock elegido en el TPV para esta línea.",
        ondelete="restrict",
    )
