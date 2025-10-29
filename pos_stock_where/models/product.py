# pos_stock_where/models/product.py
# -*- coding: utf-8 -*-
from odoo import api, models
import logging

_logger = logging.getLogger(__name__)

class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def pos_where(self, product_id, config_id):
        """Devuelve las filas de un único producto reutilizando el bulk."""
        res = self.pos_where_bulk([product_id], config_id) or {}
        return res.get(product_id, [])

    @api.model
    def pos_where_bulk(self, product_ids, config_id):
        """Devuelve ubicaciones internas y on-hand por producto (qty - reserved_qty),
        con path relativo al stock del almacén cuando aplique."""
        products = self.browse(product_ids)
        config = self.env["pos.config"].browse(config_id)
        if not products or not config.exists():
            return {}

        company_id = config.company_id.id

        # Mapa de stock_location raíz del almacén -> (nombre almacén, full path raíz)
        whs = self.env["stock.warehouse"].sudo().search([("company_id", "=", company_id)])
        wh_map = {
            w.lot_stock_id.id: (
                w.name or w.code or "Almacén",
                w.lot_stock_id.complete_name or w.lot_stock_id.display_name or "",
            )
            for w in whs
        }

        Quant = self.env["stock.quant"].sudo()
        StockLocation = self.env["stock.location"].sudo()

        # Agrupamos por producto y ubicación
        data = Quant.read_group(
            domain=[
                ("product_id", "in", products.ids),
                ("company_id", "=", company_id),
                ("location_id.usage", "=", "internal"),
                # OJO: no filtramos por quantity>0 para poder mostrar 0
            ],
            fields=["quantity:sum", "reserved_quantity:sum", "location_id", "product_id"],
            groupby=["product_id", "location_id"],
            lazy=False,
        )

        # Cache de localizaciones para no re-browsear
        loc_cache = {}
        def get_loc(loc_id):
            rec = loc_cache.get(loc_id)
            if not rec:
                rec = StockLocation.browse(loc_id).with_context(lang=self.env.user.lang)
                loc_cache[loc_id] = rec
            return rec

        rows_by_product = {pid: [] for pid in products.ids}
        for g in data:
            pid = g["product_id"][0] if isinstance(g["product_id"], (list, tuple)) else g["product_id"]
            loc_id = g["location_id"][0] if isinstance(g["location_id"], (list, tuple)) else g["location_id"]

            qty_total = float(g.get("quantity") or 0.0)
            qty_res   = float(g.get("reserved_quantity") or 0.0)
            qty = qty_total - qty_res  # on hand real

            loc = get_loc(loc_id)
            loc_full = loc.complete_name or loc.display_name or str(loc_id)

            # Derivar nombre de almacén y path relativo
            warehouse_name = ""
            path_rel = ""
            for stock_id, (w_name, stock_full) in wh_map.items():
                prefix = (stock_full or "").strip()
                if prefix and (loc_full == prefix or loc_full.startswith(prefix + "/")):
                    warehouse_name = w_name
                    path_rel = loc_full[len(prefix):].lstrip("/")
                    break
            if not warehouse_name:  # fallback robusto
                token = loc_full.split("/", 1)[0].strip()
                warehouse_name = token or "Almacén"
                path_rel = loc_full[len(token):].lstrip("/")

            display = warehouse_name if not path_rel else f"{warehouse_name} · {path_rel}"

            rows_by_product.setdefault(pid, []).append({
                "location_id": loc_id,
                "complete_name": loc_full,
                "qty": qty,
                "warehouse_name": warehouse_name,
                "path": path_rel,          # ← el front usará el último segmento del path
                "display_name": display,
            })

        # Ordena priorizando la ubicación por defecto
