# -*- coding: utf-8 -*-
from odoo import api, models
import logging
_logger = logging.getLogger(__name__)

class PosOrder(models.Model):
    _inherit = "pos.order"

    @api.model
    def _order_fields(self, ui_order):
        vals = super()._order_fields(ui_order)
        if "lines" in vals:
            new_lines = []
            for cmd in vals["lines"]:
                if isinstance(cmd, (list, tuple)) and len(cmd) == 3 and isinstance(cmd[2], dict):
                    line_vals = dict(cmd[2])
                    if "pos_src_location_id" in line_vals:
                        _logger.info("POS SRC UI→LINE: %s", line_vals["pos_src_location_id"])
                    new_lines.append((0, 0, line_vals))
                else:
                    new_lines.append(cmd)
            vals["lines"] = new_lines
        return vals

    # FIRMA CORRECTA EN ODOO 17: (picking, line, qty, **kwargs)
    def _prepare_stock_move_vals(self, picking, line, qty, **kwargs):
        """El move nace ya enlazado a la línea y con la sububicación elegida."""
        vals = super()._prepare_stock_move_vals(picking, line, qty, **kwargs)

        # Enlace explícito a la línea POS
        vals["pos_order_line_id"] = line.id

        # Forzar origen = sububicación elegida
        loc = getattr(line, "pos_src_location_id", False)
        if (
            picking
            and picking.picking_type_id.code == "outgoing"
            and loc
            and getattr(loc, "usage", None) == "internal"
        ):
            vals["location_id"] = loc.id
            base_name = vals.get("name") or line.product_id.display_name
            vals["name"] = f"{base_name} [pos_src:{loc.display_name}]"
            _logger.info("POS SRC MOVE VALS@line: line %s → %s (qty %s)", line.id, loc.display_name, qty)

        return vals

    def _pos_src_fix_moves(self):
        """También corrige después (incluso si el picking ya está en done)."""
        for order in self:
            # ❗️Quitamos el filtro por estado para no perdernos pickings cerrados muy rápido
            for picking in order.picking_ids:
                for move in picking.move_ids_without_package:
                    line = move.pos_order_line_id or order.lines.filtered(lambda l: l.product_id == move.product_id)[:1]
                    if line and not move.pos_order_line_id:
                        move.pos_order_line_id = line.id
                    loc = line and line.pos_src_location_id or False
                    if loc and getattr(loc, "usage", None) == "internal" and move.location_id != loc:
                        _logger.info("POS SRC FIX AFTER CREATE: move %s %s -> %s",
                                     move.id, move.product_id.display_name, loc.display_name)
                        if move.state in ("assigned", "partially_available"):
                            move._do_unreserve()
                        move.location_id = loc.id
                        move.move_line_ids.write({"location_id": loc.id})
                        move._action_assign()

    def _create_picking(self):
        res = super()._create_picking()
        self._pos_src_fix_moves()
        return res

    def _create_order_picking(self):
        res = super()._create_order_picking()
        self._pos_src_fix_moves()
        return res

    def action_pos_order_paid(self):
        res = super().action_pos_order_paid()
        self._pos_src_fix_moves()
        return res
