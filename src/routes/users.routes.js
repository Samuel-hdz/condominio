import { Router } from 'express';
import { usersController } from '../controllers/users.controller.js';
import { 
    authenticate, 
    requireRole, 
    requirePermission,
    validateCreateUser,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

/**
 * @route   GET /api/users
 * @desc    Obtener todos los usuarios (con paginación y filtros)
 * @access  Private (Administrador)
 */
router.get(
    '/', 
    requireRole('administrador'),
    usersController.getAllUsers
);

/**
 * @route   POST /api/users
 * @desc    Crear nuevo usuario
 * @access  Private (Administrador)
 */
router.post(
    '/',
    requireRole('administrador'),
    validateCreateUser,
    usersController.createUser
);

/**
 * @route   GET /api/users/:id
 * @desc    Obtener usuario por ID
 * @access  Private (Administrador o mismo usuario)
 */
router.get(
    '/:id',
    validateObjectId('id'),
    requirePermission('/admin/usuarios', 'ver'),
    usersController.getUserById
);

/**
 * @route   PUT /api/users/:id
 * @desc    Actualizar usuario
 * @access  Private (Administrador)
 */
router.put(
    '/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    usersController.updateUser
);

/**
 * @route   PUT /api/users/:id/roles
 * @desc    Actualizar roles de usuario
 * @access  Private (Administrador)
 */
router.put(
    '/:id/roles',
    validateObjectId('id'),
    requireRole('administrador'),
    usersController.updateUserRoles
);

/**
 * @route   PUT /api/users/:id/permissions
 * @desc    Actualizar permisos de usuario
 * @access  Private (Administrador)
 */
router.put(
    '/:id/permissions',
    validateObjectId('id'),
    requireRole('administrador'),
    usersController.updateUserPermissions
);

/**
 * @route   PUT /api/users/:id/assign-profile
 * @desc    Asignar perfil predefinido a usuario
 * @access  Private (Administrador)
 */
router.put(
    '/:id/assign-profile',
    validateObjectId('id'),
    requireRole('administrador'),
    usersController.assignProfileToUser
);

/**
 * @route   GET /api/users/:id/modules
 * @desc    Obtener módulos del sistema con permisos del usuario
 * @access  Private (Administrador o mismo usuario)
 */
router.get(
    '/:id/modules',
    validateObjectId('id'),
    requirePermission('/admin/usuarios', 'ver'),
    usersController.getUserModulesWithPermissions
);

/**
 * @route   GET /api/users/:id/activity
 * @desc    Obtener historial de actividad del usuario
 * @access  Private (Administrador)
 */
router.get(
    '/:id/activity',
    validateObjectId('id'),
    requireRole('administrador'),
    usersController.getUserActivity
);

export default router;