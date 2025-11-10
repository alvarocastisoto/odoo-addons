# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

class PosOfflinePing(http.Controller):
    @http.route(
        '/pos_offline_info/ping',
        type='http', auth='public', csrf=False, methods=['GET', 'HEAD']
    )
    def ping(self, **kw):
        # 204: sin cuerpo; con no-cache para evitar caches intermedios
        return request.make_response(
            b'',
            headers=[
                ('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'),
                ('Pragma', 'no-cache'),
            ],
            status=204,
        )
