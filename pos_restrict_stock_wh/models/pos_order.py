# pos_restrict_stock_wh/models/pos_order.py
# -*- coding: utf-8 -*-
import logging
from odoo import _, api, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

class PosOrder(models.Model):
    _inherit = "pos.order"

    # ---------- helpers ----------
    def _pos_origin_location(self, config):
        return config.picking_type_id.default_location_src_id

    def _free_qty_in_tree(self, product_id, root_loc_id):
        Quant = self.env["stock.quant"]
        res = Quant.read_group(
            domain=[
                ("product_id", "=", product_id),
                ("location_id", "child_of", root_loc_id),
                ("location_id.usage", "=", "internal"),
                ("company_id", "in", self.env.companies.ids),
            ],
            fields=["quantity:sum", "reserved_quantity:sum"],
            groupby=[],
        )
        if not res:
            return 0.0
        qty = res[0].get("quantity") or 0.0
        reserved = res[0].get("reserved_quantity") or 0.0
        return qty - reserved

    # ---------- recibe campos extra desde el POS ----------
    @api.model
    def _order_fields(self, ui_order):
        """Asegura que cada línea hereda pos_src_location_id / pos_fulfillment_mode."""
        vals = super()._order_fields(ui_order)
        if "lines" in vals:
            new_lines = []
            for cmd in vals["lines"]:
                if (isinstance(cmd, (list, tuple)) and len(cmd) == 3
                        and isinstance(cmd[2], dict)):
                    line_vals = dict(cmd[2])
                    # vienen del front como enteros/strings -> Odoo hará el coercion
                    if "pos_src_location_id" in line_vals:
                        line_vals["pos_src_location_id"] = line_vals["pos_src_location_id"]
                    if "pos_fulfillment_mode" in line_vals:
                        line_vals["pos_fulfillment_mode"] = line_vals["pos_fulfillment_mode"]
                    new_lines.append([cmd[0], cmd[1], line_vals])
                else:
                    new_lines.append(cmd)
            vals["lines"] = new_lines
        return vals

    # ignora en los chequeos las líneas que ya traen origen alternativo
    def _extract_required_from_vals(self, vals):
        req = {}
        for cmd in vals.get("lines") or []:
            if not isinstance(cmd, (list, tuple)) or len(cmd) < 3:
                continue
            op, _id, data = cmd
            if op == 0 and isinstance(data, dict):
                if data.get("pos_src_location_id"):
                    continue
                qty = float(data.get("qty") or 0.0)
                pid = data.get("product_id")
                if qty > 0 and pid:
                    req[pid] = req.get(pid, 0.0) + qty
        return req

    def _check_required_map(self, req_map, location, label):
        if not req_map:
            return
        missing_names = []
        Product = self.env["product.product"].sudo()
        for pid, need in req_map.items():
            p = Product.browse(pid)
            if p.type != "product":
                continue
            have = self._free_qty_in_tree(pid, location.id)
            if have < need:
                missing_names.append(p.display_name)
        if missing_names:
            unique = list(dict.fromkeys(missing_names))
            quoted = '", "'.join(unique)
            msg = _('Sin stock de: "%(names)s". Comprueba si hay en otras ubicaciones.') % {"names": quoted}
            _logger.warning("POS restrict stock: %s", msg.replace("\n", " | "))
            raise UserError(msg)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            session = self.env["pos.session"].browse(vals.get("session_id"))
            config = session.config_id if session else self.env["pos.config"].browse(vals.get("config_id"))
            if config and getattr(config, "restrict_out_of_stock", False):
                loc = self._pos_origin_location(config)
                if loc:
                    req = self._extract_required_from_vals(vals)
                    _logger.info("POS restrict stock: checking create() at '%s'", loc.display_name)
                    self._check_required_map(req, loc, "creación")
        return super().create(vals_list)

    @api.model
    def create_from_ui(self, orders, draft=False):
        for o in orders:
            data = o.get("data") or {}
            session = self.env["pos.session"].browse(data.get("pos_session_id"))
            config = session.config_id if session else self.env["pos.config"].browse(data.get("config_id"))
            if config and getattr(config, "restrict_out_of_stock", False):
                loc = self._pos_origin_location(config)
                if loc:
                    req = {}
                    for line in data.get("lines", []):
                        vals = line[2] if isinstance(line, (list, tuple)) and len(line) > 2 else line
                        if vals.get("pos_src_location_id"):
                            continue
                        qty = float(vals.get("qty") or 0.0)
                        pid = vals.get("product_id")
                        if qty > 0 and pid:
                            req[pid] = req.get(pid, 0.0) + qty
                    _logger.info("POS restrict stock: checking create_from_ui at '%s'", loc.display_name)
                    self._check_required_map(req, loc, "pre-creación")
        return super().create_from_ui(orders, draft=draft)

    def action_pos_order_paid(self):
        for order in self:
            config = order.session_id.config_id
            if config and getattr(config, "restrict_out_of_stock", False):
                loc = self._pos_origin_location(config)
                if loc:
                    req = {}
                    for l in order.lines:
                        if l.qty > 0 and not l.pos_src_location_id:
                            req[l.product_id.id] = req.get(l.product_id.id, 0.0) + l.qty
                    _logger.info("POS restrict stock: checking before pay at '%s'", loc.display_name)
                    self._check_required_map(req, loc, "antes de pagar")
        return super().action_pos_order_paid()

    # ---------- creación de pickings por origen + bandera persistente ----------
    def _create_picking(self):
        """
        Si hay líneas con pos_src_location_id o varios orígenes, crea 1 picking por origen.
        Añade bandera persistente en el picking para permitir cross-store sin que otros módulos
        vuelvan a forzar la raíz del POS.
        """
        ctx_ok = dict(self.env.context, pos_src_cross_store_ok=True)
        Picking = self.env["stock.picking"].with_context(ctx_ok)
        Move = self.env["stock.move"].with_context(ctx_ok)

        for order in self:
            picking_type = order.session_id.config_id.picking_type_id
            default_src = picking_type.default_location_src_id
            dest = picking_type.default_location_dest_id or order.partner_id.property_stock_customer
            if not dest:
                dest = self.env.ref("stock.stock_location_customers")

            groups = {}
            multi_origen = False
            for line in order.lines:
                if line.qty <= 0 or line.product_id.type != "product":
                    continue
                src = line.pos_src_location_id or default_src
                key = src.id
                groups.setdefault(key, {"src": src, "lines": []})
                groups[key]["lines"].append(line)
                if src.id != default_src.id:
                    multi_origen = True

            if not groups or (not multi_origen and len(groups) == 1):
                _logger.info("POS picking: flujo estándar (un solo origen)")
                super(PosOrder, order.with_context(ctx_ok))._create_picking()
                continue

            _logger.info("POS picking: creando %s pickings por origen (cross-store OK)", len(groups))

            created_pickings = self.env["stock.picking"]
            for key, bucket in groups.items():
                src = bucket["src"]
                lines = bucket["lines"]

                vals_pick = order._prepare_picking_vals(order.partner_id, picking_type, src, dest)
                # bandera persistente en el picking
                vals_pick["pos_src_cross_store_ok"] = True
                picking = Picking.create(vals_pick)

                mv_vals = []
                for l in lines:
                    try:
                        mv = order._prepare_order_line_move(l, picking)
                    except Exception:
                        mv = {
                            "name": l.name or l.product_id.display_name,
                            "product_id": l.product_id.id,
                            "product_uom": l.product_uom_id.id,
                            "product_uom_qty": abs(l.qty),
                            "location_id": src.id,
                            "location_dest_id": dest.id,
                            "picking_id": picking.id,
                            "company_id": order.company_id.id,
                        }
                    # forzar origen + enlazar siempre la línea del TPV
                    mv["location_id"] = src.id
                    mv["picking_id"] = picking.id
                    mv["pos_order_line_id"] = l.id
                    mv_vals.append(mv)

                if mv_vals:
                    moves = Move.create(mv_vals)
                    picking.with_context(ctx_ok)._action_confirm()
                    picking.with_context(ctx_ok)._action_assign()
                    for m in moves:
                        m.quantity_done = m.product_uom_qty
                    picking.with_context(ctx_ok)._action_done()

                created_pickings |= picking

            if created_pickings:
                order.write({"picking_id": created_pickings[-1].id})
                order.picking_ids |= created_pickings

        return True
