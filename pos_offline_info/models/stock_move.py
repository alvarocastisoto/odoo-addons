# -*- coding: utf-8 -*-
from odoo import api, fields, models
import logging
_logger = logging.getLogger(__name__)

class StockMove(models.Model):
    _inherit = "stock.move"

    pos_order_line_id = fields.Many2one(
        "pos.order.line",
        string="POS Order Line",
        index=True, readonly=True, ondelete="set null",
        help="Línea de pedido TPV que originó este movimiento.",
    )

    def _pos_src_line_and_loc(self):
        self.ensure_one()
        line = self.pos_order_line_id
        if not line and self.picking_id and self.picking_id.origin:
            order = self.env["pos.order"].search([
                "|", ("name", "=", self.picking_id.origin),
                     ("pos_reference", "=", self.picking_id.origin),
            ], limit=1)
            if order:
                line = order.lines.filtered(lambda l: l.product_id == self.product_id)[:1]
        loc = line and line.pos_src_location_id or False
        return line, loc

    def _pos_src_enforce_location(self):
        for move in self:
            line, loc = move._pos_src_line_and_loc()
            if line and not move.pos_order_line_id:
                move.pos_order_line_id = line.id
            _logger.info("POS SRC ENFORCE? move=%s state=%s line=%s loc=%s",
                         move.id, move.state, line and line.id, loc and loc.complete_name)
            if loc and getattr(loc, "usage", None) == "internal" and move.location_id != loc:
                if move.state in ("assigned", "partially_available"):
                    move._do_unreserve()
                move.location_id = loc.id
                move.move_line_ids.write({"location_id": loc.id})
                _logger.info("POS SRC ENFORCED: move %s -> %s", move.id, loc.display_name)

    @api.model_create_multi
    def create(self, vals_list):
        _logger.info("SM.create incoming vals: %s", vals_list)
        moves = super().create(vals_list)
        for m in moves:
            if not m.pos_order_line_id:
                line, _ = m._pos_src_line_and_loc()
                if line:
                    m.pos_order_line_id = line.id
            m._pos_src_enforce_location()
        return moves

    def _action_confirm(self, merge=True, merge_into=False):
        res = super()._action_confirm(merge=False, merge_into=merge_into)
        self._pos_src_enforce_location()
        return res

    def _action_assign(self):
        self._pos_src_enforce_location()
        res = super()._action_assign()
        self._pos_src_enforce_location()
        return res
