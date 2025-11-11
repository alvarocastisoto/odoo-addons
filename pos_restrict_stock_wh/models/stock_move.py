# -*- coding: utf-8 -*-
from odoo import models, fields

class StockMove(models.Model):
    _inherit = "stock.move"

    pos_order_line_id = fields.Many2one(
        "pos.order.line",
        string="Línea TPV",
        index=True,
        ondelete="set null",
    )
