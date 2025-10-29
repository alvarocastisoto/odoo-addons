# -*- coding: utf-8 -*-
from odoo import api, models, fields
from collections import defaultdict
import logging
_logger = logging.getLogger(__name__)

class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def pos_product_info_bulk(self, product_ids, config_id, qty=1.0):

        self = self.sudo()
        conf = self.env["pos.config"].browse(config_id)
        if not conf.exists():
            return {}

        company = conf.company_id
        currency = company.currency_id

        pricelist = conf.pricelist_id or self.env["product.pricelist"].search([
            ("company_id", "=", company.id)
        ], limit=1)

        products = self.browse(product_ids).exists()
        uoms = {u.id: u for u in self.env["uom.uom"].browse(products.mapped("uom_id").ids)}

        def _compute_pricing(prod, q):
            base = prod.lst_price
            taxes = prod.taxes_id.filtered(lambda t: t.company_id == company)
            res = taxes._origin.compute_all(
                base, currency=currency, quantity=q, product=prod, partner=None, is_refund=False
            )
            tax_details = []
            for t in res.get("taxes", []):
                tax_details.append({
                    "name": t.get("name"),
                    "amount": t.get("amount", 0.0),
                    "base": t.get("base", 0.0),
                    "id": t.get("id"),
                })
            return {
                "price_without_tax": res.get("total_excluded", 0.0),
                "price_with_tax": res.get("total_included", 0.0),
                "tax_details": tax_details,
            }

        out = {}
        for p in products:
            try:
                all_prices = _compute_pricing(p, qty)
            except Exception as e:
                _logger.exception("Pricing compute failed for %s: %s", p.display_name, e)
                all_prices = {"price_without_tax": p.lst_price, "price_with_tax": p.lst_price, "tax_details": []}

            uom = p.uom_id and p.uom_id.name or "Unidades"

            try:
                where_rows = self.pos_where(p.id, conf.id)
            except Exception as e:
                _logger.exception("pos_where failed for %s: %s", p.display_name, e)
                where_rows = []

            out[p.id] = {
                "pricing": {"all_prices": all_prices},
                "productInfo": {
                    "uom": uom,
                    "all_prices": all_prices,
                },
                "availability": {
                    "on_hand": p.qty_available,
                    "forecasted": p.virtual_available or p.qty_available,
                    "uom": uom,
                },
                "where": where_rows,
            }
        return out
