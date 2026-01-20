import { Router } from 'express';
import { communicationsController } from '../controllers/communications.controller.js';
import { 
    authenticate, 
    requireRole,
    requireResidentMobileAccess,
    validatePublication,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas para residentes (app móvil)
const residentRoutes = Router();
residentRoutes.use(requireResidentMobileAccess);

/**
 * @route   POST /api/communications/resident/caseta
 * @desc    Enviar mensaje a caseta
 * @access  Private (Residente)
 */
residentRoutes.post(
    '/caseta',
    communicationsController.sendMessageToCaseta
);

/**
 * @route   POST /api/communications/resident/admin
 * @desc    Enviar mensaje a administrador
 * @access  Private (Residente)
 */
residentRoutes.post(
    '/admin',
    communicationsController.sendMessageToAdmin
);

/**
 * @route   GET /api/communications/resident/publications
 * @desc    Obtener publicaciones para un residente
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/publications',
    communicationsController.getResidentPublications
);

/**
 * @route   POST /api/communications/resident/publications/:id/read
 * @desc    Marcar publicación como leída
 * @access  Private (Residente)
 */
residentRoutes.post(
    '/publications/:id/read',
    validateObjectId('id'),
    communicationsController.markPublicationAsRead
);

// Rutas para conversaciones (compartidas)
/**
 * @route   GET /api/communications/conversations
 * @desc    Obtener conversaciones de un usuario
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/conversations',
    communicationsController.getUserConversations
);

/**
 * @route   GET /api/communications/conversations/:id/messages
 * @desc    Obtener mensajes de una conversación
 * @access  Private (Participante de la conversación)
 */
router.get(
    '/conversations/:id/messages',
    validateObjectId('id'),
    communicationsController.getConversationMessages
);

/**
 * @route   POST /api/communications/conversations/:id/messages
 * @desc    Enviar mensaje en una conversación existente
 * @access  Private (Participante de la conversación)
 */
router.post(
    '/conversations/:id/messages',
    validateObjectId('id'),
    communicationsController.sendMessage
);

/**
 * @route   PUT /api/communications/conversations/:id/close
 * @desc    Cerrar conversación
 * @access  Private (Participante de la conversación)
 */
router.put(
    '/conversations/:id/close',
    validateObjectId('id'),
    communicationsController.closeConversation
);

// Rutas para administradores (publicaciones)
/**
 * @route   POST /api/communications/publications
 * @desc    Crear nueva publicación/boletín
 * @access  Private (Administrador, Comité)
 */
router.post(
    '/publications',
    requireRole('administrador', 'comite'),
    validatePublication,
    communicationsController.createPublication
);

// Combinar rutas
router.use('/resident', residentRoutes);

export default router;