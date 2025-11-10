# pos_stock_where/models/product.py
# -*- coding: utf-8 -*-
from odoo import api, models
import logging

_logger = logging.getLogger(__name__)


class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def pos_where(self, product_id, config_id):
        """Wrapper simple para un único producto (re-usa el bulk)."""
        res = self.pos_where_bulk([product_id], config_id) or {}
        return res.get(product_id, [])

    @api.model
    def pos_where_bulk(self, product_ids, config_id):
        """
        Devuelve, por producto, las ubicaciones internas con su
        **stock disponible real** (= quantity - reserved_quantity).

        Estructura:
        { product_id: [
            {
              "location_id": <int>,
              "complete_name": "<Almacén/Stock/...>",
              "qty": <float>,                   # alias → disponible
              "available_quantity": <float>,    # disponible (preferido por el front)
              "reserved_quantity": <float>,
              "warehouse_name": "<str>",
              "path": "<subruta dentro del almacén>",
              "display_name": "Almacén · subruta"
            }, ...
        ]}
        """
        self = self.sudo()
        products = self.browse(product_ids).exists()
        config = self.env["pos.config"].browse(config_id)
        if not products or not config.exists():
            return {}

        company = config.company_id

        # --- Ubicaciones internas visibles por la compañía (o sin compañía)
        StockLocation = (
            self.env["stock.location"].sudo().with_context(active_test=False)
        )
        internal_loc_ids = StockLocation.search(
            [
                ("usage", "=", "internal"),
                "|",
                ("company_id", "=", company.id),
                ("company_id", "=", False),
            ]
        ).ids

        # --- Mapa de almacenes: lot_stock_id -> (nombre almacén, prefijo /Stock completo)
        whs = (
            self.env["stock.warehouse"]
            .sudo()
            .search([("company_id", "=", company.id)])
        )
        wh_map = {
            w.lot_stock_id.id: (
                w.name or w.code or "Almacén",
                w.lot_stock_id.complete_name or w.lot_stock_id.display_name or "",
            )
            for w in whs
            if w.lot_stock_id
        }

        # --- Suma por product/location de quantity y reserved_quantity
        Quant = self.env["stock.quant"].sudo().with_context(active_test=False)
        data = Quant.read_group(
            domain=[
                ("product_id", "in", products.ids),
                ("location_id", "in", internal_loc_ids),
                "|",
                ("company_id", "=", company.id),
                ("company_id", "=", False),
            ],
            fields=[
                "quantity:sum",
                "reserved_quantity:sum",
                "location_id",
                "product_id",
            ],
            groupby=["product_id", "location_id"],
            lazy=False,
        )

        # --- Cache ligero para no volver a leer la ubicación
        loc_cache = {}

        def get_loc(loc_id):
            rec = loc_cache.get(loc_id)
            if not rec:
                rec = StockLocation.browse(loc_id).with_context(
                    lang=self.env.user.lang
                )
                loc_cache[loc_id] = rec
            return rec

        rows_by_product = {pid: [] for pid in products.ids}

        for g in data:
            pid = (
                g["product_id"][0]
                if isinstance(g["product_id"], (list, tuple))
                else g["product_id"]
            )
            loc_id = (
                g["location_id"][0]
                if isinstance(g["location_id"], (list, tuple))
                else g["location_id"]
            )
            qty = float(g.get("quantity") or 0.0)
            res_qty = float(g.get("reserved_quantity") or 0.0)
            avail = qty - res_qty  # disponible real

            # Opcional: no listar ubicaciones con 0 exacto para reducir ruido
            if abs(avail) < 1e-6:
                continue

            loc = get_loc(loc_id)
            loc_full = loc.complete_name or loc.display_name or str(loc_id)

            # Detecta almacén por prefijo del /Stock
            warehouse_name = ""
            path_rel = ""
            for stock_id, (w_name, stock_full) in wh_map.items():
                prefix = (stock_full or "").strip()
                if prefix and (loc_full == prefix or loc_full.startswith(prefix + "/")):
                    warehouse_name = w_name
                    path_rel = loc_full[len(prefix) :].lstrip("/")
                    break

            # Fallback: primer token como nombre de almacén
            if not warehouse_name:
                token = loc_full.split("/", 1)[0].strip()
                warehouse_name = token or "Almacén"
                path_rel = loc_full[len(token) :].lstrip("/")

            display = (
                warehouse_name if not path_rel else f"{warehouse_name} · {path_rel}"
            )

            rows_by_product.setdefault(pid, []).append(
                {
                    "location_id": loc_id,
                    "complete_name": loc_full,
                    # Alias por compatibilidad con tu front actual:
                    "qty": avail,
                    # Campos explícitos:
                    "available_quantity": avail,
                    "reserved_quantity": res_qty,
                    "warehouse_name": warehouse_name,
                    "path": path_rel,
                    "display_name": display,
                }
            )

        # --- Pin: ubicación por defecto del POS primero; luego por disponible desc + nombre
        base_loc = config.picking_type_id.default_location_src_id

        def _key(r):
            pin = -1 if (base_loc and r["location_id"] == base_loc.id) else 0
            return (pin, -float(r.get("available_quantity", 0.0)), r["display_name"].lower())

        for pid, rows in rows_by_product.items():
            rows.sort(key=_key)

        _logger.info(
            "pos_where_bulk: company=%s products=%s rows(nonempty)=%s",
            company.id,
            len(products),
            sum(1 for v in rows_by_product.values() if v),
        )
        return rows_by_product
