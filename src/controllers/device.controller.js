// controllers/device.controller.js
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';

export const deviceController = {
    /**
     * Registrar dispositivo para notificaciones push
     */
    registerDevice: catchAsync(async (req, res) => {
        const userId = req.userId;
        const {
            device_id,
            token_fcm,
            platform,
            app_version,
            metadata
        } = req.body;

        if (!device_id || !token_fcm || !platform) {
            return res.status(400).json({
                success: false,
                message: 'device_id, token_fcm y platform son requeridos'
            });
        }

        const dispositivo = await NotificationService.registerDevice(userId, {
            dispositivo_id: device_id,
            token_fcm,
            plataforma: platform,
            version_app: app_version,
            metadata
        });

        res.json({
            success: true,
            message: 'Dispositivo registrado exitosamente',
            device: {
                id: dispositivo._id,
                device_id: dispositivo.dispositivo_id,
                platform: dispositivo.plataforma,
                active: dispositivo.activo,
                last_activity: dispositivo.ultima_actividad
            }
        });
    }),

    /**
     * Desactivar dispositivo (logout)
     */
    deactivateDevice: catchAsync(async (req, res) => {
        const userId = req.userId;
        const { device_id } = req.body;

        if (!device_id) {
            return res.status(400).json({
                success: false,
                message: 'device_id es requerido'
            });
        }

        const dispositivo = await NotificationService.deactivateDevice(device_id, userId);

        if (!dispositivo) {
            return res.status(404).json({
                success: false,
                message: 'Dispositivo no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Dispositivo desactivado'
        });
    }),

    /**
     * Obtener dispositivos del usuario
     */
    getUserDevices: catchAsync(async (req, res) => {
        const userId = req.userId;
        const { DispositivoUsuario } = await import('../models/dispositivoUsuario.model.js');

        const dispositivos = await DispositivoUsuario.find({
            user_id: userId
        }).sort({ updated_at: -1 });

        res.json({
            success: true,
            devices: dispositivos.map(d => ({
                id: d._id,
                device_id: d.dispositivo_id,
                platform: d.plataforma,
                active: d.activo,
                last_activity: d.ultima_actividad,
                app_version: d.version_app,
                created_at: d.created_at
            }))
        });
    }),

    /**
     * Actualizar token FCM (cuando expira)
     */
    updateFCMToken: catchAsync(async (req, res) => {
        const userId = req.userId;
        const { old_token, new_token, device_id } = req.body;
        
        const { DispositivoUsuario } = await import('../models/dispositivoUsuario.model.js');
        
        // Buscar dispositivo con old_token
        const dispositivo = await DispositivoUsuario.findOne({
            dispositivo_id: device_id,
            user_id: userId,
            token_fcm: old_token
        });
        
        if (!dispositivo) {
            return res.status(404).json({ 
                success: false, 
                message: 'Dispositivo no encontrado o token no coincide' 
            });
        }
        
        dispositivo.token_fcm = new_token;
        dispositivo.ultima_actividad = new Date();
        await dispositivo.save();
        
        res.json({ 
            success: true, 
            message: 'Token actualizado',
            device: {
                id: dispositivo._id,
                device_id: dispositivo.dispositivo_id,
                new_token: dispositivo.token_fcm
            }
        });
    }),

    /**
     * Webhook para recibir acuses de FCM
     */
    handleFCMWebhook: catchAsync(async (req, res) => {
        const receiptData = req.body;
        
        // Validar secreto del webhook
        const secret = req.headers['x-fcm-secret'];
        if (secret !== process.env.FCM_WEBHOOK_SECRET) {
            return res.status(401).json({
                success: false,
                message: 'No autorizado'
            });
        }
        
        // Procesar el acuse de entrega
        await NotificationService.handleDeliveryReceipt(receiptData);
        
        // Siempre responder 200 OK a FCM para que no reintente
        res.status(200).send('OK');
    }),

    /**
     * Probar notificación push
     */
    testPush: catchAsync(async (req, res) => {
        const userId = req.userId;
        const { title = 'Test', message = 'Esta es una notificación de prueba' } = req.body;

        const notification = await NotificationService.sendNotification({
            userId,
            tipo: 'push',
            titulo: title,
            mensaje: message,
            data: { test: true, timestamp: new Date().toISOString() }
        });

        res.json({
            success: true,
            message: 'Notificación de prueba enviada',
            notification: {
                id: notification._id,
                title: notification.titulo,
                message: notification.mensaje,
                sent: notification.enviada,
                sent_at: notification.fecha_envio,
                error: notification.error_envio
            }
        });
    })
};