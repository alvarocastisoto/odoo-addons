# __manifest__.py
{
    "name": "POS Restrict Stock per Warehouse",
    "summary": "Restringe ventas en POS si no hay stock libre en la ubicación origen; consulta stock en otras ubicaciones.",
    "version": "17.0.1.0.1",
    "license": "LGPL-3",
    "author": "Alvaro Casti Soto",
    "website": "https://github.com/alvarocastisoto/odoo-addons",
    "depends": ["point_of_sale", "stock"],
    "data": ["views/pos_config_views.xml"],
    "assets": {},
    "installable": True,
    "application": False,
}
