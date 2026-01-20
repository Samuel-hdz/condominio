import { Router } from 'express';
import { packagesController } from '../controllers/packages.controller.js';
import { 
    authenticate, 
    requireRole,
    requireResidentMobileAccess,
    requireCasetaAccess,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas para residentes (app móvil)
const residentRoutes = Router();
residentRoutes.use(requireResidentMobileAccess);

/**
 * @route   GET /api/packages/resident
 * @desc    Obtener paquetes de un residente
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/',
    packagesController.getResidentPackages
);

/**
 * @route   PUT /api/packages/resident/:id/retrieve
 * @desc    Marcar paquete como retirado
 * @access  Private (Residente)
 */
residentRoutes.put(
    '/:id/retrieve',
    validateObjectId('id'),
    packagesController.markPackageAsRetrieved
);

// Rutas para caseta
const casetaRoutes = Router();
casetaRoutes.use(requireCasetaAccess);

/**
 * @route   POST /api/packages/caseta
 * @desc    Registrar nuevo paquete
 * @access  Private (Caseta)
 */
casetaRoutes.post(
    '/',
    packagesController.registerPackage
);

/**
 * @route   GET /api/packages/caseta
 * @desc    Obtener paquetes por estado
 * @access  Private (Caseta)
 */
casetaRoutes.get(
    '/',
    packagesController.getPackagesByStatus
);

/**
 * @route   PUT /api/packages/caseta/:id
 * @desc    Actualizar información de paquete
 * @access  Private (Caseta)
 */
casetaRoutes.put(
    '/:id',
    validateObjectId('id'),
    packagesController.updatePackage
);

/**
 * @route   DELETE /api/packages/caseta/:id
 * @desc    Eliminar paquete (marcar como eliminado)
 * @access  Private (Caseta)
 */
casetaRoutes.delete(
    '/:id',
    validateObjectId('id'),
    packagesController.deletePackage
);

// Rutas para administradores
/**
 * @route   GET /api/packages/statistics
 * @desc    Obtener estadísticas de paquetería
 * @access  Private (Administrador, Comité)
 */
router.get(
    '/statistics',
    requireRole('administrador', 'comite'),
    packagesController.getPackageStatistics
);

// Combinar rutas
router.use('/resident', residentRoutes);
router.use('/caseta', casetaRoutes);

export default router;