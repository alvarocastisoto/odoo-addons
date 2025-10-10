from odoo import api, models
import logging
_logger = logging.getLogger(__name__)

class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def pos_where(self, product_id, config_id):
        """Devuelve stock por ubicación interna (toda la compañía del POS).
        Cada fila: {'location_id': int, 'complete_name': str, 'qty': float}
        """
        product = self.browse(product_id)
        config = self.env['pos.config'].browse(config_id)
        if not product.exists() or not config.exists():
            return []

        domain = [
            ('product_id', '=', product.id),
            ('company_id', '=', config.company_id.id),
            ('location_id.usage', '=', 'internal'),
            ('quantity', '>', 0),
        ]
        data = self.env['stock.quant'].read_group(
            domain,
            ['quantity:sum', 'location_id'],
            ['location_id'],
            lazy=False,
        )

        rows = []
        for g in data:
            loc_id, _loc_name = g['location_id']
            qty = g['quantity'] or 0.0
            loc = self.env['stock.location'].browse(loc_id).with_context(lang=self.env.user.lang)
            rows.append({
                'location_id': loc_id,
                'complete_name': loc.complete_name,
                'qty': float(qty),
            })

        base_loc = config.picking_type_id.default_location_src_id
        def _key(r):
            top = -1 if (base_loc and r['location_id'] == base_loc.id) else 0
            return (top, r['complete_name'].lower())
        rows.sort(key=_key)

        _logger.info("pos_where: product=%s(%s) rows=%s", product.display_name, product.id, rows)
        return rows
