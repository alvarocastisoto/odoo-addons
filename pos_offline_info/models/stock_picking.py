# -*- coding: utf-8 -*-
# pos_offline_info/models/stock_picking.py
from odoo import models
import logging
_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = "stock.picking"

    def _create_picking_from_pos_order_lines(self, location_dest_id, lines, picking_type, partner=False):
        """
        Crea los pickings con el flujo estándar y, justo después,
        para cada move:
          - enlaza pos_order_line_id con su línea de TPV
          - fuerza location_id = sububicación elegida (pos_src_location_id)
          - re-reserva si procede
        """
        pickings = super()._create_picking_from_pos_order_lines(location_dest_id, lines, picking_type, partner=partner)

        # Indexamos las líneas de TPV por producto para emparejar rápido
        lines_by_product = {}
        for l in lines:
            lines_by_product.setdefault(l.product_id.id, []).append(l)

        for p in pickings:
            # Solo salidas del POS
            if p.picking_type_id.code != "outgoing":
                continue

            for m in p.move_ids_without_package:
                cands = lines_by_product.get(m.product_id.id) or []
                line = cands and cands[0] or False

                # 2) Enlaza pos_order_line_id si falta
                if line and not m.pos_order_line_id:
                    m.pos_order_line_id = line.id

                # 3) Fuerza el origen a la sububicación elegida en la línea
                loc = line and getattr(line, "pos_src_location_id", False)
                if loc and getattr(loc, "usage", None) == "internal" and m.location_id != loc:
                    _logger.info("POS SRC PICK FIX: move %s %s  %s -> %s",
                                 m.id, m.product_id.display_name,
                                 m.location_id.display_name, loc.display_name)
                    # Si estaba reservado, libera antes de cambiar
                    if m.state in ("assigned", "partially_available"):
                        m._do_unreserve()
                    # Cambia origen en move y en sus move_lines
                    m.location_id = loc.id
                    m.move_line_ids.write({"location_id": loc.id})
                    # Vuelve a reservar desde la nueva ubicación
                    m._action_assign()

        return pickings
