# pos_stock_where/models/product.py
from odoo import api, models
import logging
_logger = logging.getLogger(__name__)

class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def pos_where_bulk(self, product_ids, config_id):

        products = self.browse(product_ids)
        config = self.env['pos.config'].browse(config_id)
        if not products or not config.exists():
            return {}

        company_id = config.company_id.id
        whs = self.env['stock.warehouse'].sudo().search([('company_id', '=', company_id)])
        wh_map = {w.lot_stock_id.id: (
            w.name or w.code or "Almacén",
            w.lot_stock_id.complete_name or w.lot_stock_id.display_name or ""
        ) for w in whs}

        Quant = self.env['stock.quant'].sudo()
        StockLocation = self.env['stock.location'].sudo()

        data = Quant.read_group(
            domain=[
                ('product_id', 'in', products.ids),
                ('company_id', '=', company_id),
                ('location_id.usage', '=', 'internal'),
                ('quantity', '>', 0),
            ],
            fields=['quantity:sum', 'location_id', 'product_id'],
            groupby=['product_id', 'location_id'],
            lazy=False,
        )

        loc_cache = {}
        def get_loc(loc_id):
            rec = loc_cache.get(loc_id)
            if not rec:
                rec = StockLocation.browse(loc_id).with_context(lang=self.env.user.lang)
                loc_cache[loc_id] = rec
            return rec

        rows_by_product = {pid: [] for pid in products.ids}
        for g in data:
            pid = g['product_id'][0] if isinstance(g['product_id'], (list, tuple)) else g['product_id']
            loc_id = g['location_id'][0] if isinstance(g['location_id'], (list, tuple)) else g['location_id']
            qty = float(g.get('quantity') or 0.0)

            loc = get_loc(loc_id)
            loc_full = loc.complete_name or loc.display_name or str(loc_id)

            warehouse_name = ""
            path_rel = ""
            for stock_id, (w_name, stock_full) in wh_map.items():
                prefix = (stock_full or "").strip()
                if loc_full == prefix or loc_full.startswith(prefix + "/"):
                    warehouse_name = w_name
                    path_rel = loc_full[len(prefix):].lstrip("/")
                    break
            if not warehouse_name:  # fallback
                token = loc_full.split("/", 1)[0].strip()
                warehouse_name = token or "Almacén"
                path_rel = loc_full[len(token):].lstrip("/")

            display = warehouse_name if not path_rel else f"{warehouse_name} · {path_rel}"
            rows_by_product.setdefault(pid, []).append({
                'location_id': loc_id,
                'complete_name': loc_full,
                'qty': qty,
                'warehouse_name': warehouse_name,
                'path': path_rel,
                'display_name': display,
            })

        base_loc = config.picking_type_id.default_location_src_id
        def _key(r):
            pin = -1 if (base_loc and r['location_id'] == base_loc.id) else 0
            return (pin, r['display_name'].lower())

        for pid, rows in rows_by_product.items():
            rows.sort(key=_key)

        _logger.info("pos_where_bulk: products=%s rows(nonempty)=%s",
                     len(products), sum(bool(v) for v in rows_by_product.values()))
        return rows_by_product
