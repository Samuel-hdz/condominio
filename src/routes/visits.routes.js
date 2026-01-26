import { Router } from 'express';
import { visitsController } from '../controllers/visits.controller.js';
import { 
    authenticate, 
    requireRole,
    requireResidentMobileAccess,
    requireCasetaAccess,
    validateVisitAuthorization,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas para residentes (app móvil)
const residentRoutes = Router();
residentRoutes.use(requireResidentMobileAccess);

/**
 * @route   GET /api/visits/resident/personal
 * @desc    Obtener personal registrado por residente
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/personal',
    visitsController.getResidentPersonal
);

/**
 * @route   POST /api/visits/resident/personal
 * @desc    Registrar nuevo personal
 * @access  Private (Residente)
 */
residentRoutes.post(
    '/personal',
    visitsController.createPersonal
);

/**
 * @route   POST /api/visits/resident/providers
 * @desc    Crear proveedor (solo para este residente)
 * @access  Private (Residente)
 */
residentRoutes.post(
    '/providers',
    visitsController.createProviderFromResident
);
/**
 * @route   POST /api/visits/resident/authorizations
 * @desc    Crear nueva autorización de visita
 * @access  Private (Residente)
 */
residentRoutes.post(
    '/authorizations',
    validateVisitAuthorization,
    visitsController.createVisitAuthorization
);

/**
 * @route   GET /api/visits/resident/authorizations
 * @desc    Obtener autorizaciones de un residente
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/authorizations',
    visitsController.getResidentAuthorizations
);

/**
 * @route   GET /api/visits/resident/authorizations/:id
 * @desc    Obtener autorización por ID
 * @access  Private (Residente - dueño de la autorización)
 */
residentRoutes.get(
    '/authorizations/:id',
    validateObjectId('id'),
    visitsController.getAuthorizationById
);

/**
 * @route   PUT /api/visits/resident/authorizations/:id
 * @desc    Actualizar autorización
 * @access  Private (Residente - dueño de la autorización)
 */
residentRoutes.put(
    '/authorizations/:id',
    validateObjectId('id'),
    visitsController.updateAuthorization
);

/**
 * @route   DELETE /api/visits/resident/authorizations/:id
 * @desc    Cancelar autorización
 * @access  Private (Residente - dueño de la autorización)
 */
residentRoutes.delete(
    '/authorizations/:id',
    validateObjectId('id'),
    visitsController.cancelAuthorization
);

/**
 * @route   GET /api/visits/resident/history
 * @desc    Obtener historial de accesos de un residente
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/history',
    visitsController.getAccessHistory
);

/**
 * @route   GET /api/visits/resident/statistics
 * @desc    Obtener estadísticas de visitas
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/statistics',
    visitsController.getVisitStatistics
);

// Rutas para caseta
const casetaRoutes = Router();
casetaRoutes.use(requireCasetaAccess);

/**
 * @route   POST /api/visits/caseta/register-access
 * @desc    Registrar ingreso de visitante
 * @access  Private (Caseta)
 */
casetaRoutes.post(
    '/register-access',
    visitsController.registerVisitAccess
);

/**
 * @route   POST /api/visits/caseta/register-exit
 * @desc    Registrar salida de visitante
 * @access  Private (Caseta)
 */
casetaRoutes.post(
    '/register-exit',
    visitsController.registerVisitExit
);

// Rutas públicas para datos maestros
/**
 * @route   GET /api/visits/types
 * @desc    Obtener tipos de visita
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/types',
    visitsController.getVisitTypes
);

/**
 * @route   GET /api/visits/providers
 * @desc    Obtener proveedores disponibles
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/providers',
    visitsController.getAvailableProviders
);

// Combinar rutas
router.use('/resident', residentRoutes);
router.use('/caseta', casetaRoutes);

export default router;