# pos_force_offline_session/controllers/main.py
import os
from odoo import http
from odoo.http import request
from werkzeug.wrappers import Response

class PosServiceWorker(http.Controller):

    @http.route('/pos_sw.js', type='http', auth='public', methods=['GET'])
    def service_worker_file(self):
        """
        Sirve el archivo pos_sw.js con el encabezado Service-Worker-Allowed.
        Esto permite que el Service Worker se registre con el scope de la raíz ('/').
        """
        module_path = os.path.dirname(os.path.abspath(__file__))
        # Ruta al archivo estático real
        sw_path = os.path.join(module_path, '..', 'static', 'pos_sw.js')

        if not os.path.exists(sw_path):
            return request.not_found()

        with open(sw_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 🎯 CRÍTICO: Añadir el encabezado Service-Worker-Allowed
        headers = [
            ('Content-Type', 'application/javascript'),
            ('Service-Worker-Allowed', '/'),
            # Cache-Control para que el navegador sepa cómo manejarlo
            ('Cache-Control', 'public, max-age=3600') 
        ]
        
        return Response(content, headers=headers)