import { Notificacion } from '../models/notificacion.model.js';
import { UsuarioNotificacionPref } from '../models/usuarioNotificacionPref.model.js';

/**
 * Servicio de notificaciones push/in-app
 * Nota: Esta es la implementación base. Para notificaciones push reales,
 * necesitarás integrar con Firebase Cloud Messaging (FCM) o similar.
 */

class NotificationService {
    /**
     * Crea y envía una notificación a un usuario
     * @param {Object} options - Opciones de la notificación
     * @returns {Promise<Object>} Notificación creada
     */
    static async sendNotification(options) {
        const {
            userId,
            tipo = 'in_app',
            titulo,
            mensaje,
            data = {},
            accionRequerida = false,
            accionTipo = null,
            accionData = null
        } = options;

        // Verificar preferencias del usuario
        const pref = await UsuarioNotificacionPref.findOne({
            user_id: userId,
            tipo_notificacion: this.getNotificationTypeFromData(data)
        });

        // Si el usuario tiene deshabilitadas las notificaciones push, cambiar a in_app
        const tipoFinal = (tipo === 'push' && pref && !pref.recibir_push) ? 'in_app' : tipo;

        const notification = await Notificacion.create({
            user_id: userId,
            tipo: tipoFinal,
            titulo,
            mensaje,
            data_json: data,
            accion_requerida: accionRequerida,
            accion_tipo: accionTipo,
            accion_data: accionData,
            enviada: tipoFinal === 'in_app', // in_app se marca como enviada inmediatamente
            fecha_envio: tipoFinal === 'in_app' ? new Date() : null
        });

        // En una implementación real, aquí enviarías la notificación push a FCM
        if (tipoFinal === 'push') {
            await this.sendPushNotification(notification);
        }

        return notification;
    }

    /**
     * Envía notificación push (placeholder para implementación real)
     * @param {Object} notification - Objeto de notificación
     * @returns {Promise<void>}
     */
    static async sendPushNotification(notification) {
        // Implementación placeholder
        // En producción, integrarías con FCM, Expo, OneSignal, etc.
        
        console.log(`📱 [PUSH] Enviando notificación a usuario ${notification.user_id}: ${notification.titulo}`);
        
        // Marcar como enviada después de "enviar"
        notification.enviada = true;
        notification.fecha_envio = new Date();
        await notification.save();
    }

    /**
     * Envía notificación a múltiples usuarios
     * @param {Array} userIds - IDs de usuarios
     * @param {Object} options - Opciones de notificación
     * @returns {Promise<Array>} Notificaciones creadas
     */
    static async sendBulkNotification(userIds, options) {
        const notifications = [];
        
        for (const userId of userIds) {
            try {
                const notification = await this.sendNotification({
                    userId,
                    ...options
                });
                notifications.push(notification);
            } catch (error) {
                console.error(`Error enviando notificación a usuario ${userId}:`, error);
            }
        }
        
        return notifications;
    }

    /**
     * Marca una notificación como leída
     * @param {String} notificationId - ID de la notificación
     * @param {String} userId - ID del usuario (para validación)
     * @returns {Promise<Object>} Notificación actualizada
     */
    static async markAsRead(notificationId, userId) {
        const notification = await Notificacion.findOneAndUpdate(
            {
                _id: notificationId,
                user_id: userId,
                leida: false
            },
            {
                leida: true,
                fecha_leida: new Date()
            },
            { new: true }
        );

        if (!notification) {
            throw new Error('Notificación no encontrada o ya leída');
        }

        return notification;
    }

    /**
     * Obtiene notificaciones no leídas de un usuario
     * @param {String} userId - ID del usuario
     * @param {Object} options - Opciones de paginación
     * @returns {Promise<Object>} Notificaciones y total
     */
    static async getUnreadNotifications(userId, options = {}) {
        const { limit = 20, page = 1 } = options;
        const skip = (page - 1) * limit;

        const [notifications, total] = await Promise.all([
            Notificacion.find({
                user_id: userId,
                leida: false,
                enviada: true
            })
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit),
            Notificacion.countDocuments({
                user_id: userId,
                leida: false,
                enviada: true
            })
        ]);

        return {
            notifications,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            hasMore: (page * limit) < total
        };
    }

    /**
     * Obtiene todas las notificaciones de un usuario
     * @param {String} userId - ID del usuario
     * @param {Object} options - Opciones de paginación y filtrado
     * @returns {Promise<Object>} Notificaciones y total
     */
    static async getUserNotifications(userId, options = {}) {
        const { 
            limit = 20, 
            page = 1, 
            tipo = null,
            leida = null 
        } = options;
        
        const skip = (page - 1) * limit;
        
        const query = { user_id: userId };
        
        if (tipo) query.tipo = tipo;
        if (leida !== null) query.leida = leida;

        const [notifications, total] = await Promise.all([
            Notificacion.find(query)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit),
            Notificacion.countDocuments(query)
        ]);

        return {
            notifications,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            hasMore: (page * limit) < total
        };
    }

    /**
     * Obtiene el tipo de notificación basado en los datos
     * @param {Object} data - Datos de la notificación
     * @returns {String} Tipo de notificación
     */
    static getNotificationTypeFromData(data) {
        if (data.tipo === 'visita') return 'visitas';
        if (data.tipo === 'pago') return 'pagos';
        if (data.tipo === 'boletin') return 'boletines';
        if (data.tipo === 'paquete') return 'paqueteria';
        if (data.tipo === 'chat') return 'chat';
        if (data.tipo === 'acceso') return 'accesos';
        
        return 'general';
    }

    /**
     * Helper para crear notificaciones comunes
     */
    static notifications = {
        // Notificaciones de visitas
        visitaRegistrada: (userId, data) => this.sendNotification({
            userId,
            tipo: 'push',
            titulo: '👤 Nueva visita registrada',
            mensaje: `${data.nombreVisitante} ha sido registrado para visitarte`,
            data: { ...data, tipo: 'visita' },
            accionRequerida: false,
            accionTipo: 'ver_visita',
            accionData: { visitaId: data.visitaId }
        }),

        visitaIngreso: (userId, data) => this.sendNotification({
            userId,
            tipo: 'push',
            titulo: '🚪 Visitante en acceso',
            mensaje: `${data.nombreVisitante} está intentando ingresar`,
            data: { ...data, tipo: 'visita' },
            accionRequerida: false
        }),

        // Notificaciones de pagos
        pagoPendiente: (userId, data) => this.sendNotification({
            userId,
            tipo: 'push',
            titulo: '💰 Pago pendiente',
            mensaje: `Tienes un pago de ${data.concepto} pendiente`,
            data: { ...data, tipo: 'pago' },
            accionRequerida: true,
            accionTipo: 'ver_comprobante'
        }),

        pagoAprobado: (userId, data) => this.sendNotification({
            userId,
            tipo: 'push',
            titulo: '✅ Pago aprobado',
            mensaje: `Tu pago de ${data.concepto} ha sido aprobado`,
            data: { ...data, tipo: 'pago' }
        }),

        // Notificaciones de paquetería
        paqueteRecibido: (userId, data) => this.sendNotification({
            userId,
            tipo: 'push',
            titulo: '📦 Paquete recibido',
            mensaje: `Tienes un paquete en la caseta de ${data.empresa}`,
            data: { ...data, tipo: 'paquete' },
            accionRequerida: true,
            accionTipo: 'ver_paquete'
        }),

        // Notificaciones de chat
        nuevoMensaje: (userId, data) => this.sendNotification({
            userId,
            tipo: 'push',
            titulo: '💬 Nuevo mensaje',
            mensaje: `${data.remitente}: ${data.mensajePreview}`,
            data: { ...data, tipo: 'chat' },
            accionRequerida: true,
            accionTipo: 'responder_chat'
        }),

        // Notificaciones del sistema
        nuevoBoletin: (userId, data) => this.sendNotification({
            userId,
            tipo: 'push',
            titulo: '📢 Nuevo boletín',
            mensaje: data.titulo,
            data: { ...data, tipo: 'boletin' }
        })
    };
}

export default NotificationService;