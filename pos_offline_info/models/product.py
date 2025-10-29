from odoo import api, models
import logging
_logger = logging.getLogger(__name__)

def _safe_info(uom_name, pid, core=None):
    core = core or {}
    pi = core.get("all_prices") or {}
    all_prices = {
        "price_without_tax": pi.get("price_without_tax", pi.get("total_excluded", 0.0)),
        "price_with_tax":    pi.get("price_with_tax",    pi.get("total_included", 0.0)),
        "tax_details":       pi.get("tax_details", pi.get("taxes", [])) or [],
        "taxes":             pi.get("taxes", pi.get("tax_details", [])) or [],
    }
    return {
        "productInfo": {
            **core,
            "all_prices": all_prices,
            "pricelists": core.get("pricelists", []),
            "warehouses": core.get("warehouses", []),
            "suppliers":  core.get("suppliers", []),
            "variants":   core.get("variants", []),
            "optional_products": core.get("optional_products", []),
        },
        "availability": {"on_hand": 0, "forecasted": 0, "uom": uom_name},
        "uom": {"name": uom_name},
        "product_id": pid,
    }

class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def pos_product_info_bulk(self, product_ids, config_id, qty=1.0):
        self = self.sudo()
        conf = self.env["pos.config"].browse(config_id)
        if not conf.exists():
            return {}

        res = {}
        prods = (
            self.with_company(conf.company_id)
            .browse(product_ids).exists()
            .with_context(
                lang=self.env.user.lang,
                allowed_company_ids=[conf.company_id.id],
            )
        )
        for product in prods:
            uom_name = (product.uom_id.name or "").strip() or "Unidades"
            try:
                base_price = product.lst_price
                core = product.get_product_info_pos(base_price, qty, config_id)
                # shape seguro aunque core sea “raro”
                payload = _safe_info(uom_name, product.id, core=core)
                fcast = product.virtual_available if product.virtual_available is not None else product.qty_available
                payload["availability"] = {
                    "on_hand": product.qty_available,
                    "forecasted": fcast,
                    "uom": uom_name,
                }
                res[product.id] = payload
            except Exception as e:
                _logger.exception("get_product_info_pos failed for %s: %s", product.display_name, e)
                res[product.id] = _safe_info(uom_name, product.id)
        return res
