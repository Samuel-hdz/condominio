import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.js';
import { 
    authenticate, 
    requireRole,
    requirePermission,
    auditAdminActions,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación y rol de administrador
router.use(authenticate);
router.use(requireRole('administrador'));

// Unidades geográficas
/**
 * @route   POST /api/admin/geographic-units
 * @desc    Crear nueva unidad geográfica
 * @access  Private (Administrador)
 */
router.post(
    '/geographic-units',
    auditAdminActions(),
    adminController.createGeographicUnit
);

/**
 * @route   GET /api/admin/geographic-units
 * @desc    Obtener todas las unidades geográficas
 * @access  Private (Administrador, Comité)
 */
router.get(
    '/geographic-units',
    requirePermission('/admin', 'ver'),
    adminController.getGeographicUnits
);

// Calles/Torres
/**
 * @route   POST /api/admin/streets-towers
 * @desc    Crear nueva calle/torre
 * @access  Private (Administrador)
 */
router.post(
    '/streets-towers',
    auditAdminActions(),
    adminController.createStreetTower
);

/**
 * @route   GET /api/admin/streets-towers
 * @desc    Obtener calles/torres por unidad geográfica
 * @access  Private (Administrador, Comité)
 */
router.get(
    '/streets-towers',
    requirePermission('/admin', 'ver'),
    adminController.getStreetsTowers
);

// Domicilios
/**
 * @route   POST /api/admin/domiciles
 * @desc    Crear nuevo domicilio
 * @access  Private (Administrador)
 */
router.post(
    '/domiciles',
    auditAdminActions(),
    adminController.createDomicile
);

/**
 * @route   GET /api/admin/domiciles
 * @desc    Obtener domicilios
 * @access  Private (Administrador, Comité)
 */
router.get(
    '/domiciles',
    requirePermission('/admin', 'ver'),
    adminController.getDomiciles
);

// Módulos del sistema
/**
 * @route   GET /api/admin/system-modules
 * @desc    Obtener módulos del sistema
 * @access  Private (Administrador)
 */
router.get(
    '/system-modules',
    adminController.getSystemModules
);

// Perfiles de permisos
/**
 * @route   GET /api/admin/permission-profiles
 * @desc    Obtener perfiles de permisos
 * @access  Private (Administrador)
 */
router.get(
    '/permission-profiles',
    adminController.getPermissionProfiles
);

/**
 * @route   POST /api/admin/permission-profiles
 * @desc    Crear perfil de permisos
 * @access  Private (Administrador)
 */
router.post(
    '/permission-profiles',
    auditAdminActions(),
    adminController.createPermissionProfile
);

/**
 * @route   PUT /api/admin/permission-profiles/:id
 * @desc    Actualizar perfil de permisos
 * @access  Private (Administrador)
 */
router.put(
    '/permission-profiles/:id',
    validateObjectId('id'),
    auditAdminActions(),
    adminController.updatePermissionProfile
);

/**
 * @route   DELETE /api/admin/permission-profiles/:id
 * @desc    Eliminar perfil de permisos
 * @access  Private (Administrador)
 */
router.delete(
    '/permission-profiles/:id',
    validateObjectId('id'),
    auditAdminActions(),
    adminController.deletePermissionProfile
);

// Estadísticas y sistema
/**
 * @route   GET /api/admin/statistics
 * @desc    Obtener estadísticas generales del sistema
 * @access  Private (Administrador, Comité)
 */
router.get(
    '/statistics',
    requirePermission('/admin', 'ver'),
    adminController.getSystemStatistics
);

/**
 * @route   POST /api/admin/bulk-notification
 * @desc    Enviar notificación masiva
 * @access  Private (Administrador)
 */
router.post(
    '/bulk-notification',
    auditAdminActions(),
    adminController.sendBulkNotification
);

/**
 * @route   GET /api/admin/system-logs
 * @desc    Obtener logs del sistema
 * @access  Private (Administrador)
 */
router.get(
    '/system-logs',
    adminController.getSystemLogs
);

/**
 * @route   GET /api/admin/system-info
 * @desc    Obtener información de sistema y versiones
 * @access  Private (Administrador)
 */
router.get(
    '/system-info',
    adminController.getSystemInfo
);

export default router;