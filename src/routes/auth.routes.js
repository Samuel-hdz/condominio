import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate, validateCreateUser } from '../middlewares/index.js';

const router = Router();

/**
 * @route   POST /api/auth/login/mobile
 * @desc    Login EXCLUSIVO para app móvil (solo residentes)
 * @access  Public
 */
router.post('/login/mobile', authController.loginMobile);

/**
 * @route   POST /api/auth/login/web
 * @desc    Login EXCLUSIVO para panel web (solo admin/caseta/comite)
 * @access  Public
 */
router.post('/login/web', authController.loginWeb);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout de usuario
 * @access  Private
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @route   GET /api/auth/profile
 * @desc    Obtener perfil del usuario autenticado
 * @access  Private
 */
router.get('/profile', authenticate, authController.getProfile);

/**
 * @route   PUT /api/auth/change-password
 * @desc    Cambiar contraseña
 * @access  Private
 */
router.put('/change-password', authenticate, authController.changePassword);

/**
 * @route   GET /api/auth/validate-token
 * @desc    Validar token JWT
 * @access  Private
 */
router.get('/validate-token', authenticate, authController.validateToken);

export default router;