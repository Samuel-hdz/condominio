import { Router } from 'express';
import { systemController } from '../controllers/system.controller.js';
import { 
    authenticate, 
    requireRole,
    validateObjectId 
} from '../middlewares/index.js';
import multer from 'multer';
import path from 'path';

// Configurar multer para upload de archivos generales
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/general/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'file-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB límite
});

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Notificaciones
/**
 * @route   GET /api/system/notifications
 * @desc    Obtener notificaciones del usuario
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/notifications',
    systemController.getUserNotifications
);

/**
 * @route   PUT /api/system/notifications/:id/read
 * @desc    Marcar notificación como leída
 * @access  Private (Cualquier usuario autenticado)
 */
router.put(
    '/notifications/:id/read',
    validateObjectId('id'),
    systemController.markNotificationAsRead
);

/**
 * @route   PUT /api/system/notifications/read-all
 * @desc    Marcar todas las notificaciones como leídas
 * @access  Private (Cualquier usuario autenticado)
 */
router.put(
    '/notifications/read-all',
    systemController.markAllNotificationsAsRead
);

// Preferencias de notificaciones
/**
 * @route   GET /api/system/notification-preferences
 * @desc    Obtener preferencias de notificaciones del usuario
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/notification-preferences',
    systemController.getNotificationPreferences
);

/**
 * @route   PUT /api/system/notification-preferences
 * @desc    Actualizar preferencias de notificaciones
 * @access  Private (Cualquier usuario autenticado)
 */
router.put(
    '/notification-preferences',
    systemController.updateNotificationPreferences
);

// Cuentas bancarias
/**
 * @route   GET /api/system/payment-accounts
 * @desc    Obtener cuentas bancarias para pagos
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/payment-accounts',
    systemController.getPaymentAccounts
);

/**
 * @route   POST /api/system/payment-accounts
 * @desc    Crear cuenta bancaria
 * @access  Private (Administrador)
 */
router.post(
    '/payment-accounts',
    requireRole('administrador'),
    upload.none(),
    systemController.createPaymentAccount
);

/**
 * @route   PUT /api/system/payment-accounts/:id
 * @desc    Actualizar cuenta bancaria
 * @access  Private (Administrador)
 */
router.put(
    '/payment-accounts/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    upload.none(),
    systemController.updatePaymentAccount
);

/**
 * @route   DELETE /api/system/payment-accounts/:id
 * @desc    Eliminar cuenta bancaria (marcar como inactiva)
 * @access  Private (Administrador)
 */
router.delete(
    '/payment-accounts/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    systemController.deletePaymentAccount
);

// Bitácora de incidencias
/**
 * @route   POST /api/system/incidence-log
 * @desc    Registrar incidencia en bitácora
 * @access  Private (Caseta)
 */
router.post(
    '/incidence-log',
    requireRole('caseta'),
    systemController.logIncidence
);

/**
 * @route   GET /api/system/incidence-log
 * @desc    Obtener bitácora de incidencias
 * @access  Private (Administrador, Caseta, Comité)
 */
router.get(
    '/incidence-log',
    requireRole('administrador', 'caseta', 'comite'),
    systemController.getIncidenceLog
);

/**
 * @route   PUT /api/system/incidence-log/:id
 * @desc    Actualizar incidencia (seguimiento)
 * @access  Private (Administrador, Caseta)
 */
router.put(
    '/incidence-log/:id',
    validateObjectId('id'),
    requireRole('administrador', 'caseta'),
    systemController.updateIncidence
);

// Dashboard y búsqueda
/**
 * @route   GET /api/system/dashboard
 * @desc    Obtener dashboard con información resumida
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/dashboard',
    systemController.getDashboard
);

/**
 * @route   GET /api/system/search
 * @desc    Buscar en el sistema (búsqueda global)
 * @access  Private (Cualquier usuario autenticado con permisos de búsqueda)
 */
router.get(
    '/search',
    systemController.globalSearch
);

/**
 * @route   GET /api/system/config
 * @desc    Obtener configuración del sistema
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/config',
    systemController.getSystemConfig
);

// Upload de archivos general
/**
 * @route   POST /api/system/upload
 * @desc    Subir archivo general
 * @access  Private (Cualquier usuario autenticado)
 */
router.post(
    '/upload',
    upload.single('file'),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se proporcionó ningún archivo'
            });
        }

        res.json({
            success: true,
            message: 'Archivo subido exitosamente',
            file: {
                filename: req.file.filename,
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                path: req.file.path
            }
        });
    }
);

export default router;