import { Router } from 'express';
import { eventsController } from '../controllers/events.controller.js';
import { 
    authenticate, 
    requireResidentMobileAccess,
    validateObjectId 
} from '../middlewares/index.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);
router.use(requireResidentMobileAccess);

/**
 * @route   POST /api/events
 * @desc    Crear nuevo evento
 * @access  Private (Residente)
 */
router.post(
    '/',
    eventsController.createEvent
);

/**
 * @route   GET /api/events
 * @desc    Obtener eventos del residente
 * @access  Private (Residente)
 */
router.get(
    '/',
    eventsController.getResidentEvents
);

/**
 * @route   GET /api/events/:id
 * @desc    Obtener evento por ID
 * @access  Private (Residente - dueño del evento)
 */
router.get(
    '/:id',
    validateObjectId('id'),
    eventsController.getEventById
);

/**
 * @route   POST /api/events/:id/invitations
 * @desc    Crear invitación individual para evento (cuando NO es QR compartido)
 * @access  Private (Residente - dueño del evento)
 */
router.post(
    '/:id/invitations',
    validateObjectId('id'),
    eventsController.createEventAuthorization
);


export default router;