import { Notificacion } from '../models/notificacion.model.js';
import { UsuarioNotificacionPref } from '../models/usuarioNotificacionPref.model.js';
import { DispositivoUsuario } from '../models/dispositivoUsuario.model.js';
import { EntregaNotificacion } from '../models/entregaNotificacion.model.js';
import admin from 'firebase-admin';

/**
 * Servicio de notificaciones push/in-app con Firebase Cloud Messaging
 */
class NotificationService {
    constructor() {
        this.fcmInitialized = false;
        this.fcmError = null;
        // No inicializar aquí, se hará cuando sea necesario
    }

    /**
     * Inicializar Firebase Admin SDK (una sola vez)
     */
    async initFCM() {
        try {
            console.log('🚀 Iniciando Firebase Admin SDK...');
            
            if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
                this.fcmError = 'FIREBASE_SERVICE_ACCOUNT_KEY no configurado';
                console.warn('⚠️ ' + this.fcmError);
                return false;
            }

            // Parsear credenciales
            let serviceAccount;
            try {
                serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            } catch (parseError) {
                console.error('❌ Error parseando JSON de Firebase:', parseError.message);
                this.fcmError = 'Error parseando JSON: ' + parseError.message;
                return false;
            }

            // Verificar campos requeridos
            const requiredFields = ['project_id', 'private_key', 'client_email'];
            for (const field of requiredFields) {
                if (!serviceAccount[field]) {
                    this.fcmError = `Campo faltante en credenciales: ${field}`;
                    console.error('❌ ' + this.fcmError);
                    return false;
                }
            }

            // Si ya está inicializado, no hacerlo de nuevo
            if (admin.apps.length === 0) {
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount)
                });
                console.log('✅ Firebase Admin SDK inicializado correctamente');
                console.log(`📌 Proyecto: ${serviceAccount.project_id}`);
            } else {
                console.log('✅ Firebase ya estaba inicializado');
            }

            this.fcmInitialized = true;
            return true;
            
        } catch (error) {
            this.fcmError = error.message;
            console.error('❌ Error crítico inicializando Firebase:', error);
            return false;
        }
    }

    /**
     * Asegurar que Firebase está inicializado
     */
    async ensureFCMInitialized() {
        if (!this.fcmInitialized) {
            await this.initFCM();
        }
        return this.fcmInitialized;
    }

    /**
     * Obtener estado de Firebase
     */
    getFirebaseStatus() {
        return {
            initialized: this.fcmInitialized,
            error: this.fcmError,
            timestamp: new Date(),
            projectInfo: this.fcmInitialized ? {
                projectId: admin.apps[0]?.options?.credential?.projectId || 'N/A',
                clientEmail: admin.apps[0]?.options?.credential?.clientEmail || 'N/A'
            } : null
        };
    }

    /**
     * Enviar mensaje de prueba
     */
    static async sendTestNotification(token, userId = 'test-user') {
        const instance = new NotificationService();
        
        const initialized = await instance.ensureFCMInitialized();
        if (!initialized) {
            throw new Error(`Firebase no inicializado: ${instance.fcmError}`);
        }

        console.log("---------------------")
        console.log(initialized)

        try {
            const testMessage = {
                token: token,
                notification: {
                    title: '✅ Test de Firebase',
                    body: 'Firebase está funcionando correctamente'
                },
                data: {
                    test: 'true',
                    timestamp: new Date().toISOString()
                }
            };
            console.log(testMessage)

            const response = await admin.messaging().send(testMessage);
            console.log('📤 Test notification sent:', response);
            
            return {
                success: true,
                messageId: response,
                timestamp: new Date()
            };
        } catch (error) {
            console.error('❌ Error enviando test notification:', error);
            throw error;
        }
    }
    
    /**
     * Registrar dispositivo de usuario
     */
    static async registerDevice(userId, deviceData) {
        const { 
            dispositivo_id, 
            token_fcm, 
            plataforma, 
            version_app, 
            metadata = {} 
        } = deviceData;

        // Buscar dispositivo existente
        let dispositivo = await DispositivoUsuario.findOne({ 
            user_id: userId, 
            dispositivo_id 
        });

        if (dispositivo) {
            // Actualizar token si ha cambiado
            if (dispositivo.token_fcm !== token_fcm) {
                dispositivo.token_fcm = token_fcm;
                dispositivo.ultima_actividad = new Date();
                dispositivo.version_app = version_app;
                dispositivo.metadata = metadata;
                dispositivo.activo = true;
                await dispositivo.save();
                console.log(`📱 Dispositivo actualizado: ${dispositivo_id}`);
            }
        } else {
            // Crear nuevo dispositivo
            dispositivo = await DispositivoUsuario.create({
                user_id: userId,
                dispositivo_id,
                token_fcm,
                plataforma,
                version_app,
                metadata,
                activo: true
            });
            console.log(`📱 Dispositivo registrado: ${dispositivo_id}`);
        }

        return dispositivo;
    }

    /**
     * Desactivar dispositivo (logout, app desinstalada, etc.)
     */
    static async deactivateDevice(deviceId, userId) {
        const dispositivo = await DispositivoUsuario.findOneAndUpdate(
            { dispositivo_id: deviceId, user_id: userId },
            { activo: false, token_fcm: null },
            { new: true }
        );
        
        return dispositivo;
    }

    /**
     * Crea y envía una notificación a un usuario
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

        try {
            console.log(`📨 Creando notificación para usuario ${userId}: ${titulo}`);

            // ============================================
            // 1. VERIFICAR PREFERENCIAS DEL USUARIO
            // ============================================
            let sendPush = tipo === 'push';
            
            if (sendPush) {
                const pref = await UsuarioNotificacionPref.findOne({
                    user_id: userId,
                    tipo_notificacion: this.getNotificationTypeFromData(data)
                });

                // Si el usuario tiene deshabilitadas las push, cambiar a in_app
                if (pref && pref.recibir_push === false) {
                    sendPush = false;
                    console.log(`⚠️ Usuario ${userId} tiene push deshabilitadas para este tipo`);
                }
            }

            // ============================================
            // 2. CREAR NOTIFICACIÓN EN BASE DE DATOS
            // ============================================
            const notification = await Notificacion.create({
                user_id: userId,
                tipo: tipo,
                titulo,
                mensaje,
                data_json: data,
                accion_requerida: accionRequerida,
                accion_tipo: accionTipo,
                accion_data: accionData,
                enviada: tipo === 'in_app', // in_app se marca como enviada inmediatamente
                fecha_envio: tipo === 'in_app' ? new Date() : null
            });

            console.log(`📝 Notificación guardada en BD: ${notification._id}`);

            // ============================================
            // 3. ENVIAR NOTIFICACIÓN PUSH SI CORRESPONDE
            // ============================================
            if (sendPush) {
                await this.processNotificationForUser(userId, notification);
            }

            return notification;
            
        } catch (error) {
            console.error('❌ Error enviando notificación:', error);
            
            // Fallback: crear notificación in_app
            return await Notificacion.create({
                user_id: userId,
                tipo: 'in_app',
                titulo,
                mensaje,
                data_json: data,
                accion_requerida: accionRequerida,
                accion_tipo: accionTipo,
                accion_data: accionData,
                enviada: true,
                fecha_envio: new Date(),
                error_envio: error.message
            });
        }
    }

    /**
     * Procesar notificación para un usuario específico
     */
    static async processNotificationForUser(userId, notification) {
        try {
            // Buscar dispositivos activos del usuario
            const dispositivos = await DispositivoUsuario.find({
                user_id: userId,
                activo: true,
                token_fcm: { $ne: null, $ne: '' }
            });

            if (dispositivos.length === 0) {
                console.log(`📱 Usuario ${userId} no tiene dispositivos activos`);
                notification.error_envio = 'No hay dispositivos activos';
                await notification.save();
                return;
            }

            console.log(`📱 Procesando notificación para ${dispositivos.length} dispositivo(s)`);

            // Crear registros de entrega
            const entregas = [];
            for (const dispositivo of dispositivos) {
                const entrega = await EntregaNotificacion.create({
                    notificacion_id: notification._id,
                    dispositivo_id: dispositivo._id,
                    estado: 'pendiente'
                });
                entregas.push(entrega);
            }

            // Enviar a cada dispositivo
            await this.sendToDevices(notification, dispositivos, entregas);

        } catch (error) {
            console.error(`❌ Error procesando notificación para usuario ${userId}:`, error);
            notification.error_envio = error.message;
            await notification.save();
        }
    }

    /**
     * Enviar notificación a múltiples dispositivos
     */
    static async sendToDevices(notification, dispositivos, entregas) {
        const instance = new NotificationService();
        const initialized = await instance.ensureFCMInitialized();
        
        if (!initialized) {
            console.error('❌ Firebase no inicializado, no se pueden enviar push');
            await this.markAllDeliveriesAsFailed(notification._id, 'Firebase no inicializado');
            notification.error_envio = 'Firebase no inicializado';
            notification.enviada = false;
            await notification.save();
            return;
        }

        const promises = dispositivos.map((dispositivo, index) => {
            return this.sendToSingleDevice(notification, dispositivo, entregas[index]);
        });

        // Ejecutar todas las promesas
        const results = await Promise.allSettled(promises);

        // Verificar resultados
        const successfulDeliveries = results.filter(r => r.status === 'fulfilled').length;
        
        if (successfulDeliveries > 0) {
            notification.enviada = true;
            notification.fecha_envio = new Date();
        } else {
            notification.enviada = false;
            notification.error_envio = 'Falló en todos los dispositivos';
        }
        
        await notification.save();
    }

    /**
     * Enviar notificación a un solo dispositivo
     */
    static async sendToSingleDevice(notification, dispositivo, entrega) {
    try {
        console.log(`📤 Enviando push a dispositivo ${dispositivo.dispositivo_id}`);

        // Actualizar estado a "enviando"
        entrega.estado = 'enviando';
        entrega.fecha_envio = new Date();
        await entrega.save();

        // ============================================
        // CONVERTIR TODOS LOS VALORES A STRING
        // ============================================
        const safeData = {};
        for (const [key, value] of Object.entries(notification.data_json || {})) {
            if (value === null || value === undefined) {
                safeData[key] = '';
            } else if (typeof value === 'object') {
                // Convertir objetos/arrays a JSON string
                safeData[key] = JSON.stringify(value);
            } else {
                // Convertir cualquier otro tipo a string
                safeData[key] = String(value);
            }
        }

        // Añadir metadatos de la notificación
        safeData.notification_id = notification._id.toString();
        safeData.accion_tipo = notification.accion_tipo || '';
        safeData.accion_data = notification.accion_data ? 
            JSON.stringify(notification.accion_data) : '';

        // Construir mensaje FCM
        const message = {
            token: dispositivo.token_fcm,
            notification: {
                title: notification.titulo,
                body: notification.mensaje
            },
            data: safeData,  // ✅ Ahora todos son strings
            android: {
                priority: 'high'
            },
            apns: {
                headers: {
                    'apns-priority': '10'
                }
            }
        };

        // Enviar mediante FCM
        const response = await admin.messaging().send(message);
        
        // Actualizar entrega como exitosa
        entrega.estado = 'entregada';
        entrega.fecha_entrega = new Date();
        entrega.metadata_fcm = { messageId: response };
        entrega.intentos = 1;
        await entrega.save();

        console.log(`✅ Push enviado a dispositivo ${dispositivo.dispositivo_id}`);
        return { success: true, deviceId: dispositivo.dispositivo_id };
        
        } catch (error) {
            console.error(`❌ Error enviando push a dispositivo ${dispositivo.dispositivo_id}:`, error.message);

            // Manejar errores específicos
            let estadoError = 'fallo';
            let errorMessage = error.message;

            if (error.code === 'messaging/registration-token-not-registered' ||
                error.code === 'messaging/invalid-registration-token') {
                estadoError = 'dispositivo_inactivo';
                errorMessage = 'Token inválido o dispositivo no registrado';
                
                // Marcar dispositivo como inactivo
                dispositivo.activo = false;
                await dispositivo.save();
            }

            // Actualizar entrega con error
            entrega.estado = estadoError;
            entrega.ultimo_error = {
                tipo: error.code || 'unknown',
                mensaje: errorMessage,
                codigo: error.code || 'unknown'
            };
            entrega.intentos = 1;
            await entrega.save();

            return { success: false, deviceId: dispositivo.dispositivo_id, error: errorMessage };
        }
    }

    /**
     * Marcar todas las entregas como fallidas
     */
    static async markAllDeliveriesAsFailed(notificationId, error) {
        await EntregaNotificacion.updateMany(
            { notificacion_id: notificationId },
            { 
                estado: 'fallo',
                ultimo_error: {
                    tipo: 'system',
                    mensaje: error,
                    codigo: 'firebase_not_initialized'
                }
            }
        );
    }

    /**
     * Determinar si un error es recuperable
     */
    static isRecoverableError(error) {
        const recoverableCodes = [
            'messaging/unavailable',
            'messaging/internal-error',
            'messaging/server-unavailable',
            'messaging/device-message-rate-exceeded',
            'messaging/topics-message-rate-exceeded'
        ];
        
        return recoverableCodes.includes(error.code);
    }

    /**
     * Enviar notificación a múltiples usuarios
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
     */
    static getNotificationTypeFromData(data) {
    if (data.tipo === 'visita') return 'visitas';
    if (data.tipo === 'visita_ingreso') return 'visitas';
    if (data.tipo === 'visita_salida') return 'visitas';
    
    // Pagos
    if (data.tipo === 'pago') return 'pagos';
    
    // Boletines
    if (data.tipo === 'boletin') return 'boletines';
    
    // Paquetería
    if (data.tipo === 'paquete') return 'paqueteria';
    
    // Chat
    if (data.tipo === 'chat') return 'chat';
    
    // Accesos
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

    /**
     * Webhook para recibir acuses de entrega de FCM
     */
    static async handleDeliveryReceipt(receiptData) {
        console.log('📬 Recepción de entrega:', receiptData);
        
        // Actualizar notificación si fue abierta
        if (receiptData.message_id && receiptData.event === 'MESSAGE_OPENED') {
            await Notificacion.findByIdAndUpdate(
                receiptData.data.notification_id,
                { 
                    leida: true,
                    fecha_leida: new Date() 
                }
            );
        }
    }
}

export default NotificationService;