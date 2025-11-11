# -*- coding: utf-8 -*-
from odoo import api, fields, models

class PosOrderLine(models.Model):
    _inherit = "pos.order.line"

    # Origen elegido en el TPV (location interna)
    pos_src_location_id = fields.Many2one(
        "stock.location", string="POS Source Location", index=True
    )
    # (opcional) modo de cumplimiento
    pos_fulfillment_mode = fields.Selection(
        selection=[("pickup","Recogida"), ("ship","Envío")],
        string="Fulfillment Mode"
    )

    def _prepare_stock_moves(self, picking):
        """Odoo 17: esta es la ruta estándar de generación de moves desde la línea."""
        moves = super()._prepare_stock_moves(picking)
        if self.pos_src_location_id:
            for vals in moves:
                # fuerza la ubicación origen del movimiento
                vals["location_id"] = self.pos_src_location_id.id
        return moves

    # Compatibilidad por si tu versión/custom usa este método:
    def _get_move_vals(self, picking, price_unit, qty):
        vals = super()._get_move_vals(picking, price_unit, qty)
        if self.pos_src_location_id:
            vals["location_id"] = self.pos_src_location_id.id
        return vals
