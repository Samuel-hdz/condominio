import { Router } from 'express';
import { residentsController } from '../controllers/residents.controller.js';
import { 
    authenticate, 
    requireRole,
    requireResidentMobileAccess,
    requirePrincipalResident,
    blockSuspendedResidents,
    validateCreateResident,
    validateCreateUser,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

/**
 * @route   GET /api/residents
 * @desc    Obtener todos los residentes (con filtros y paginación)
 * @access  Private (Administrador, Comité)
 */
router.get(
    '/',
    requireRole('administrador', 'comite'),
    residentsController.getAllResidents
);

/**
 * @route   GET /api/residents/morosos
 * @desc    Obtener residentes morosos con detalles
 * @access  Private (Administrador)
 */
router.get(
    '/morosos',
    requireRole('administrador'),
    residentsController.getMorososDetallado
);

/**
 * @route   POST /api/residents
 * @desc    Crear nuevo residente
 * @access  Private (Administrador)
 */
router.post(
    '/',
    requireRole('administrador'),
    validateCreateResident,
    residentsController.createResident
);

/**
 * @route   GET /api/residents/:id
 * @desc    Obtener residente por ID
 * @access  Private (Administrador, Comité o mismo residente)
 */
router.get(
    '/:id',
    validateObjectId('id'),
    requireRole('administrador', 'comite'),
    residentsController.getResidentById
);

/**
 * @route   PUT /api/residents/:id
 * @desc    Actualizar residente
 * @access  Private (Administrador)
 */
router.put(
    '/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    residentsController.updateResident
);

/**
 * @route   PUT /api/residents/:id/suspend-morosidad
 * @desc    Suspender residente individual por morosidad
 * @access  Private (Administrador)
 */
router.put(
    '/:id/suspend-morosidad',
    validateObjectId('id'),
    requireRole('administrador'),
    residentsController.suspendResidentForMorosidad
);

/**
 * @route   POST /api/residents/suspend-all-morosos
 * @desc    Suspender TODOS los residentes morosos (>60 días)
 * @access  Private (Administrador)
 */
router.post(
    '/suspend-all-morosos',
    requireRole('administrador'),
    residentsController.suspendAllMorosos
);

/**
 * @route   PUT /api/residents/:id/reactivate
 * @desc    Reactivar residente suspendido/inactivo
 * @access  Private (Administrador)
 */
router.put(
    '/:id/reactivate',
    validateObjectId('id'),
    requireRole('administrador'),
    residentsController.reactivateResident
);

/**
 * @route   PUT /api/residents/:id/morosidad
 * @desc    Actualizar monto de morosidad de un residente
 * @access  Private (Administrador)
 */
router.put(
    '/:id/morosidad',
    validateObjectId('id'),
    requireRole('administrador'),
    residentsController.updateMorosidad
);

// Middleware específico para app móvil
const mobileRoutes = Router();
mobileRoutes.use(blockSuspendedResidents);
mobileRoutes.use(requireResidentMobileAccess);

/**
 * @route   PUT /api/residents/mobile/reception-status
 * @desc    Actualizar estado de recepción (desde app móvil)
 * @access  Private (Residente activo)
 */
mobileRoutes.put(
    '/reception-status',
    residentsController.updateReceptionStatus
);

/**
 * @route   GET /api/residents/mobile/reception-status/:id
 * @desc    Obtener estado de recepción del residente
 * @access  Private (Residente activo o Administrador)
 */
mobileRoutes.get(
    '/reception-status/:id',
    validateObjectId('id'),
    residentsController.getReceptionStatus
);

// ========== RUTAS PARA RESIDENTES PRINCIPALES ==========

// Rutas para residentes principales
const principalResidentRoutes = Router();
principalResidentRoutes.use(requirePrincipalResident);

/**
 * @route   POST /api/residents/principal/secondary
 * @desc    Crear usuario residente secundario
 * @access  Private (Residente Principal)
 */
principalResidentRoutes.post(
    '/secondary',
    validateCreateUser,
    residentsController.createSecondaryResident
);

/**
 * @route   GET /api/residents/principal/secondary
 * @desc    Obtener usuarios secundarios creados por un residente principal
 * @access  Private (Residente Principal)
 */
principalResidentRoutes.get(
    '/secondary',
    residentsController.getSecondaryResidents
);

/**
 * @route   PUT /api/residents/principal/secondary/:residenteId
 * @desc    Activar/desactivar usuario residente secundario
 * @access  Private (Residente Principal)
 */
principalResidentRoutes.put(
    '/secondary/:residenteId',
    validateObjectId('residenteId'),
    residentsController.toggleSecondaryResident
);


router.use('/mobile', mobileRoutes);
router.use('/principal', principalResidentRoutes);

export default router;