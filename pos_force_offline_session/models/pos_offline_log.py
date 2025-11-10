from odoo import models, fields, api
import logging
from datetime import datetime 

_logger = logging.getLogger(__name__)

# Definiciones de formatos
ISO_DATETIME_FORMAT = '%Y-%m-%dT%H:%M:%S.%fZ'
ODOO_DATETIME_FORMAT = '%Y-%m-%d %H:%M:%S'


class PosOfflineLog(models.Model):
    _name = 'pos.offline.log'
    _description = 'Registro de Eventos de Cierre Offline y Red del POS'
    # 🚨 Cambio: Usar 'asc' para ver la historia en orden cronológico
    _order = 'timestamp asc' 

    session_id = fields.Many2one('pos.session', string='Sesión TPV', required=True, 
                                 help="Sesión de TPV donde ocurrió el evento.")
    user_id = fields.Many2one('res.users', string='Usuario', required=True, 
                              help="Usuario que intentó el cierre de sesión o experimentó el cambio de red.")
    timestamp = fields.Datetime(string='Fecha y Hora del Evento', default=fields.Datetime.now, required=True, 
                                help="Marca de tiempo del evento, generada en el frontend.")
    
    # 🆕 Eventos de red y flujo detallado
    event_type = fields.Selection([
        ('attempted_close', '1. Intento de Cierre Offline (Advertencia)'),
        ('accepted_close', '2. Cierre Offline Aceptado'),
        ('cancelled_close', '2. Cierre Offline Cancelado'),
        ('network_lost', '🔴 Pérdida de Conexión (Offline)'),
        ('network_recovered', '🟢 Conexión Recuperada (Online)'),
    ], string='Tipo de Evento', required=True, help="Resultado de la interacción del usuario o cambio de red.")
    
    details = fields.Text(string='Detalles', help="Información adicional sobre el contexto del evento.")
    
    @api.model
    def create_multiple_log_entries(self, logs_list):
        """
        Método RPC para sincronizar logs. Incluye parseo de fechas.
        """
        if not self.env.user.has_group('point_of_sale.group_pos_user'):
            _logger.warning("Intento de sincronización de logs sin permisos de POS.")
            return False

        entries = []
        for log in logs_list:
            if not log.get('session_id') or not log.get('user_id') or not log.get('event_type'):
                 _logger.warning(f"Log de TPV incompleto omitido: {log}")
                 continue 
            
            clean_timestamp = log.get('timestamp')
            
            if clean_timestamp:
                try:
                    # Parsear y reformatear la fecha
                    dt_object = datetime.strptime(clean_timestamp, ISO_DATETIME_FORMAT)
                    clean_timestamp = dt_object.strftime(ODOO_DATETIME_FORMAT)
                except ValueError:
                    _logger.error(f"Formato de fecha no válido en la entrada de log. Recibido: {clean_timestamp}", exc_info=True)
                    continue 
            
            entries.append({
                'session_id': log.get('session_id'),
                'user_id': log.get('user_id'),
                'timestamp': clean_timestamp, 
                'event_type': log.get('event_type'),
                'details': log.get('details'),
            })

        if not entries:
            _logger.info("No se recibieron entradas válidas para la sincronización.")
            return True

        try:
            self.sudo().create(entries)
            _logger.info(f"Sincronización de logs offline exitosa. Creados {len(entries)} registros.")
            return True
            
        except Exception as e:
            _logger.error("🔴 FALLO CRÍTICO al crear logs offline. (Verificar IDs o restricciones de DB)", exc_info=True)
            raise e