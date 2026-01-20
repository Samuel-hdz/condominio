import { Router } from 'express';
import { committeeController } from '../controllers/committee.controller.js';
import { 
    authenticate, 
    requireRole,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas accesibles para administradores y miembros del comité
const adminCommitteeRoutes = Router();
adminCommitteeRoutes.use(requireRole('administrador', 'comite'));

/**
 * @route   GET /api/committee/members
 * @desc    Obtener todos los miembros del comité
 * @access  Private (Administrador, Comité)
 */
adminCommitteeRoutes.get(
    '/members',
    committeeController.getCommitteeMembers
);

/**
 * @route   POST /api/committee/members
 * @desc    Agregar miembro al comité
 * @access  Private (Administrador)
 */
adminCommitteeRoutes.post(
    '/members',
    requireRole('administrador'),
    committeeController.addCommitteeMember
);

/**
 * @route   PUT /api/committee/members/:id
 * @desc    Actualizar cargo de miembro del comité
 * @access  Private (Administrador)
 */
adminCommitteeRoutes.put(
    '/members/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    committeeController.updateCommitteeMember
);

/**
 * @route   DELETE /api/committee/members/:id
 * @desc    Eliminar miembro del comité
 * @access  Private (Administrador)
 */
adminCommitteeRoutes.delete(
    '/members/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    committeeController.removeCommitteeMember
);

// Rutas para cargos del comité (solo administradores)
/**
 * @route   GET /api/committee/positions
 * @desc    Obtener cargos disponibles del comité
 * @access  Private (Administrador, Comité)
 */
adminCommitteeRoutes.get(
    '/positions',
    committeeController.getCommitteePositions
);

/**
 * @route   POST /api/committee/positions
 * @desc    Crear nuevo cargo del comité
 * @access  Private (Administrador)
 */
adminCommitteeRoutes.post(
    '/positions',
    requireRole('administrador'),
    committeeController.createCommitteePosition
);

/**
 * @route   PUT /api/committee/positions/:id
 * @desc    Actualizar cargo del comité
 * @access  Private (Administrador)
 */
adminCommitteeRoutes.put(
    '/positions/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    committeeController.updateCommitteePosition
);

/**
 * @route   DELETE /api/committee/positions/:id
 * @desc    Eliminar cargo del comité
 * @access  Private (Administrador)
 */
adminCommitteeRoutes.delete(
    '/positions/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    committeeController.deleteCommitteePosition
);

/**
 * @route   GET /api/committee/available-residents
 * @desc    Obtener residentes disponibles para agregar al comité
 * @access  Private (Administrador)
 */
adminCommitteeRoutes.get(
    '/available-residents',
    requireRole('administrador'),
    committeeController.getAvailableResidents
);

/**
 * @route   GET /api/committee/statistics
 * @desc    Obtener estadísticas del comité
 * @access  Private (Administrador, Comité)
 */
adminCommitteeRoutes.get(
    '/statistics',
    committeeController.getCommitteeStatistics
);

// Ruta pública para residentes ver información básica del comité
/**
 * @route   GET /api/committee/info
 * @desc    Obtener información pública del comité
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/info',
    committeeController.getCommitteeMembers // Misma función, pero sin filtro de estatus
);

// Combinar rutas
router.use('/', adminCommitteeRoutes);

export default router;