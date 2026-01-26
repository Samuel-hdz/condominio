import { Router } from 'express';
import { gatehouseController } from '../controllers/gatehouse.controller.js';
import { visitsController } from '../controllers/visits.controller.js';
import { 
    authenticate, 
    requireRole,
    validateObjectId
} from '../middlewares/index.js';
import { eventsController } from '../controllers/events.controller.js';


const router = Router();

// Todas las rutas requieren autenticación y rol de caseta
router.use(authenticate);
router.use(requireRole('caseta', 'administrador'));

/**
 * @route   GET /api/gatehouse/pending-visits
 * @desc    Obtener visitas próximas (para pantalla inicial)
 * @access  Private (Caseta, Administrador)
 */
router.get(
    '/pending-visits',
    gatehouseController.getPendingVisits
);

/**
 * @route   GET /api/gatehouse/active-visits
 * @desc    Obtener visitas vigentes (dentro del condominio)
 * @access  Private (Caseta, Administrador)
 */
router.get(
    '/active-visits',
    gatehouseController.getActiveVisits
);

/**
 * @route   GET /api/gatehouse/past-visits
 * @desc    Obtener visitas pasadas (historial)
 * @access  Private (Caseta, Administrador)
 */
router.get(
    '/past-visits',
    gatehouseController.getPastVisits
);

/**
 * @route   GET /api/gatehouse/rejected-visits
 * @desc    Obtener visitas rechazadas
 * @access  Private (Caseta, Administrador)
 */
router.get(
    '/rejected-visits',
    gatehouseController.getRejectedVisits
);

/**
 * @route   GET /api/gatehouse/lookup/:codigo_acceso
 * @desc    Buscar autorización por código de texto
 * @access  Private (Caseta, Administrador)
 */
router.get(
    '/lookup/:codigo_acceso',
    gatehouseController.lookupAuthorizationByCode
);

/**
 * @route   POST /api/gatehouse/manual-access
 * @desc    Registrar ingreso manual (con código, no QR)
 * @access  Private (Caseta, Administrador)
 */
router.post(
    '/manual-access',
    gatehouseController.registerManualAccess
);

/**
 * @route   POST /api/gatehouse/mark-exit
 * @desc    Marcar salida de una visita
 * @access  Private (Caseta, Administrador)
 */
router.post(
    '/mark-exit',
    gatehouseController.markVisitExit
);

// Mantener endpoints existentes de visits para QR
/**
 * @route   POST /api/gatehouse/register-access
 * @desc    Registrar ingreso por QR (existente, reutilizado)
 * @access  Private (Caseta, Administrador)
 */
router.post(
    '/register-access',
    visitsController.registerVisitAccess
);

/**
 * @route   POST /api/gatehouse/register-exit
 * @desc    Registrar salida (alias del existente)
 * @access  Private (Caseta, Administrador)
 */
router.post(
    '/register-exit',
    visitsController.registerVisitExit
);


/**
 * @route   POST /api/gatehouse/register-event-access
 * @desc    Registrar acceso para evento con QR compartido
 * @access  Private (Caseta, Administrador)
 */
router.post(
    '/register-event-access',
    eventsController.registerEventAccess
);

/**
 * @route   GET /api/gatehouse/upcoming-events
 * @desc    Obtener eventos próximos para pantalla de caseta
 * @access  Private (Caseta, Administrador)
 */
router.get(
    '/upcoming-events',
    eventsController.getUpcomingEventsForGatehouse
);

export default router;