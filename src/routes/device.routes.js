// routes/device.routes.js
import { Router } from 'express';
import { deviceController } from '../controllers/device.controller.js';
import { authenticate } from '../middlewares/index.js';

const router = Router();

// Registrar/actualizar dispositivo (requiere autenticación)
router.post('/register', authenticate, deviceController.registerDevice);

// Desactivar dispositivo (logout)
router.post('/deactivate', authenticate, deviceController.deactivateDevice);

// Obtener dispositivos del usuario
router.get('/', authenticate, deviceController.getUserDevices);

// Actualizar token FCM
router.post('/fcm-token-update', authenticate, deviceController.updateFCMToken);

// Probar notificación push
router.post('/test-push', authenticate, deviceController.testPush);

// Webhook para FCM (no requiere autenticación, usa secreto)
router.post('/fcm-webhook', deviceController.handleFCMWebhook);

export default router;