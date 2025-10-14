import logging
from odoo import _, api, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

class PosOrder(models.Model):
    _inherit = "pos.order"

    def _pos_origin_location(self, config):
        return config.picking_type_id.default_location_src_id or config.stock_location_id

    def _free_qty_in_tree(self, product_id, root_loc_id):
        rg = self.env["stock.quant"].read_group(
            domain=[("product_id", "=", product_id),
                    ("location_id", "child_of", root_loc_id)],
            fields=["quantity:sum", "reserved_quantity:sum"],
            groupby=[],
        )
        if not rg:
            return 0.0
        qty = rg[0].get("quantity") or 0.0
        res = rg[0].get("reserved_quantity") or 0.0
        return qty - res

    def _extract_required_from_vals(self, vals):
        req = {}
        for cmd in vals.get("lines") or []:
            if not isinstance(cmd, (list, tuple)) or len(cmd) < 3:
                continue
            op, _id, data = cmd
            if op == 0 and isinstance(data, dict):
                qty = float(data.get("qty") or 0.0)
                if qty > 0:
                    pid = data.get("product_id")
                    if pid:
                        req[pid] = req.get(pid, 0.0) + qty
        return req

    def _check_required_map(self, req_map, location, label):
        if not req_map:
            return
        missing_names = []
        for pid, need in req_map.items():
            have = self._free_qty_in_tree(pid, location.id)
            if have < need:
                prod = self.env["product.product"].browse(pid)
                missing_names.append(prod.display_name)

        if missing_names:
            # Quita duplicados preservando orden
            unique = list(dict.fromkeys(missing_names))
            quoted = '", "'.join(unique)
            msg = _('Sin stock de: "%(names)s". Comprueba si hay en otras ubicaciones.') % {
                "names": quoted
            }
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
                    _logger.info("POS restrict stock: checking create() for POS '%s' at '%s'",
                                 config.display_name, loc.display_name)
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
                        qty = float(vals.get("qty") or 0.0)
                        if qty > 0 and vals.get("product_id"):
                            req[vals["product_id"]] = req.get(vals["product_id"], 0.0) + qty
                    _logger.info("POS restrict stock: checking create_from_ui for POS '%s' at '%s'",
                                 config.display_name, loc.display_name)
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
                        if l.qty > 0:
                            req[l.product_id.id] = req.get(l.product_id.id, 0.0) + l.qty
                    _logger.info("POS restrict stock: checking action_pos_order_paid for POS '%s' at '%s'",
                                 config.display_name, loc.display_name)
                    self._check_required_map(req, loc, "antes de pagar")
        return super().action_pos_order_paid()
