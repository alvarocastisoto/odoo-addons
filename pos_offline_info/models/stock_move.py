# -*- coding: utf-8 -*-
from odoo import api, fields, models
import logging
_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = "stock.picking"

    pos_src_cross_store_ok = fields.Boolean(
        string="POS cross-store OK",
        help="Permite servir desde otra tienda/ubicación sin forzar la raíz del POS."
    )

class StockMove(models.Model):
    _inherit = "stock.move"

    pos_order_line_id = fields.Many2one(
        "pos.order.line",
        string="POS Order Line",
        index=True, readonly=True, ondelete="set null",
        help="Línea de TPV que originó este movimiento.",
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

    def _pos_src_get_allowed_ids(self, picking):
        if not picking or picking.picking_type_id.code != "outgoing":
            return set(), None
        root = picking.picking_type_id.default_location_src_id
        if not root:
            return set(), None
        ids = self.env["stock.location"].search([
            ("id", "child_of", [root.id]),
            ("usage", "=", "internal"),
        ]).ids
        return set(ids), root

    def _pos_src_enforce_location(self):
        for move in self:
            # 1) Nunca tocar moves ya cerrados
            if move.state == "done":
                _logger.info("POS SRC SKIP: move=%s ya está done", move.id)
                continue

            # 2) Si la línea del TPV trae una ubicación explícita, se usa SIEMPRE
            line, loc = move._pos_src_line_and_loc()
            if line and loc:
                if move.location_id != loc:
                    if move.state in ("assigned", "partially_available"):
                        move._do_unreserve()
                    move.location_id = loc.id
                    move.move_line_ids.write({"location_id": loc.id})
                    _logger.info("POS SRC BYPASS: move %s -> %s (desde pos_src_location_id)", move.id, loc.display_name)
                continue  # no comprobamos árbol ni raíz del POS

            # 3) Sin ubicación explícita, comportamiento anterior (mismo árbol que el POS)
            allowed_ids, root = self._pos_src_get_allowed_ids(move.picking_id)
            if allowed_ids and move.location_id.id not in allowed_ids and root:
                if move.state in ("assigned", "partially_available"):
                    move._do_unreserve()
                move.location_id = root.id
                move.move_line_ids.write({"location_id": root.id})
                _logger.info("POS SRC GUARD (fallback): move %s -> %s", move.id, root.display_name)

    @api.model_create_multi
    def create(self, vals_list):
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
