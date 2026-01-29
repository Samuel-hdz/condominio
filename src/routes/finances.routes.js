import { Router } from 'express';
import { financesController } from '../controllers/finances.controller.js';
import { chargesController } from '../controllers/charges.controller.js';
import { comprobantesController } from '../controllers/comprobantes.controller.js';
import { surchargesController } from '../controllers/surcharges.controller.js';
import RecurrentChargesJob from '../jobs/recurrentCharges.js';
import SurchargesJob from '../jobs/surcharges.js';
import { 
    authenticate, 
    requireRole,
    requireResidentMobileAccess,
    validatePaymentReceipt,
    validateObjectId,
    validateFileUpload,
    validateCreateCharge,
    validateCreateSurcharge
} from '../middlewares/index.js';
import { SaldoDomicilio } from '../models/saldoDomicilio.model.js';
import multer from 'multer';
import path from 'path';
import { Residente } from '../models/residente.model.js';
import { validateManualPayment } from '../middlewares/financeValidation.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar multer para upload de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/comprobantes/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'comprobante-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB límite
});

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// ==================== RUTAS PARA RESIDENTES (APP MÓVIL) ====================
const residentRoutes = Router();
residentRoutes.use(requireResidentMobileAccess);

/**
 * @route   GET /api/finances/resident/account-status
 * @desc    Obtener estado de cuenta del residente
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/account-status',
    financesController.getAccountStatus
);

/**
 * @route   POST /api/finances/resident/upload-receipt
 * @desc    Subir comprobante de pago
 * @access  Private (Residente)
 */
residentRoutes.post(
    '/upload-receipt',
    upload.single('comprobante'),
    validatePaymentReceipt,
    validateFileUpload('comprobante', 10),
    financesController.uploadPaymentReceipt
);

/**
 * @route   GET /api/finances/resident/payment-history
 * @desc    Obtener historial de pagos del residente
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/payment-history',
    financesController.getPaymentHistory
);

/**
 * @route   GET /api/finances/resident/pending-charges
 * @desc    Obtener cargos pendientes específicos para seleccionar pago
 * @access  Private (Residente)
 */
residentRoutes.get(
    '/pending-charges',
    financesController.getPendingCharges
);

/**
 * @route   POST /api/finances/resident/assign-payment
 * @desc    Asignar pago manualmente a cargos específicos
 * @access  Private (Residente)
 */
// residentRoutes.post(
//     '/assign-payment',
//     financesController.assignPaymentToCharges
// );

// SALDO A FAVOR - RESIDENTE
/**
 * @route   GET /api/finances/resident/saldo-favor
 * @desc    Obtener saldo a favor del residente
 * @access  Private (Residente)
 */
residentRoutes.get('/saldo-favor', async (req, res) => {
    const residenteId = req.residenteId;
    const residente = await Residente.findById(residenteId);
    
    const saldo = await SaldoDomicilio.findOne({
        domicilio_id: residente.domicilio_id._id
    }) || { saldo_favor: 0 };
    
    res.json({ success: true, saldo_favor: saldo.saldo_favor });
});

/**
 * @route   POST /api/finances/resident/saldo-favor/aplicar
 * @desc    Aplicar saldo a favor a cargos pendientes
 * @access  Private (Residente)
 */
residentRoutes.post('/saldo-favor/aplicar', 
    chargesController.applySaldoFavor
);

// ==================== RUTAS PÚBLICAS PARA TODOS ====================
/**
 * @route   GET /api/finances/bank-accounts
 * @desc    Obtener cuentas bancarias para referencia
 * @access  Private (Cualquier usuario autenticado)
 */
router.get(
    '/bank-accounts',
    financesController.getBankAccounts
);

// ==================== RUTAS PARA ADMINISTRADORES ====================
const adminRoutes = Router();
adminRoutes.use(requireRole('administrador', 'comite'));

// -------------------- GESTIÓN DE CARGOS --------------------
/**
 * @route   POST /api/finances/admin/charges
 * @desc    Crear nuevo cargo (mantenimiento, extraordinario, multa)
 * @access  Private (Administrador, Comité)
 */
adminRoutes.post(
    '/charges',
    validateCreateCharge,
    chargesController.createCharge
);

/**
 * @route   GET /api/finances/admin/charges
 * @desc    Obtener todos los cargos (con filtros)
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/charges',
    chargesController.getAllCharges
);

/**
 * @route   GET /api/finances/admin/charges/:id
 * @desc    Obtener cargo por ID con detalles
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/charges/:id',
    validateObjectId('id'),
    chargesController.getChargeById
);

/**
 * @route   PUT /api/finances/admin/charges/:id
 * @desc    Actualizar cargo
 * @access  Private (Administrador)
 */
adminRoutes.put(
    '/charges/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    chargesController.updateCharge
);

/**
 * @route   POST /api/finances/admin/charges/:id/duplicate
 * @desc    Duplicar cargo existente
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/charges/:id/duplicate',
    validateObjectId('id'),
    requireRole('administrador'),
    chargesController.duplicateCharge
);

/**
 * @route   POST /api/finances/admin/charges/:id/notify
 * @desc    Notificar cargo a residentes afectados
 * @access  Private (Administrador, Comité)
 */
adminRoutes.post(
    '/charges/:id/notify',
    validateObjectId('id'),
    chargesController.notifyCharge
);

/**
 * @route   DELETE /api/finances/admin/charges/:id
 * @desc    Eliminar/cancelar cargo
 * @access  Private (Administrador)
 */
adminRoutes.delete(
    '/charges/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    chargesController.deleteCharge
);

// -------------------- GESTIÓN DE RECARGOS --------------------
/**
 * @route   POST /api/finances/admin/surcharges
 * @desc    Crear nuevo recargo
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/surcharges',
    validateCreateSurcharge,
    surchargesController.createSurcharge
);

/**
 * @route   GET /api/finances/admin/surcharges
 * @desc    Obtener todos los recargos
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/surcharges',
    surchargesController.getAllSurcharges
);

/**
 * @route   POST /api/finances/admin/surcharges/apply
 * @desc    Aplicar recargos programados (manual)
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/surcharges/apply',
    requireRole('administrador'),
    surchargesController.aplicarRecargosProgramados
);

/**
 * @route   PUT /api/finances/admin/surcharges/:id/toggle
 * @desc    Activar/desactivar recargo
 * @access  Private (Administrador)
 */
adminRoutes.put(
    '/surcharges/:id/toggle',
    validateObjectId('id'),
    requireRole('administrador'),
    surchargesController.toggleSurcharge
);

/**
 * @route   GET /api/finances/admin/surcharges/stats
 * @desc    Obtener estadísticas de recargos
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/surcharges/stats',
    surchargesController.getSurchargeStats
);

// -------------------- GESTIÓN DE COMPROBANTES (ADMIN) --------------------
/**
 * @route   GET /api/finances/admin/comprobantes/pendientes
 * @desc    Obtener comprobantes pendientes de revisión
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/comprobantes/pendientes',
    comprobantesController.getPendingComprobantes
);

/**
 * @route   GET /api/finances/admin/comprobantes/:id
 * @desc    Obtener detalle completo de un comprobante
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/comprobantes/:id',
    validateObjectId('id'),
    comprobantesController.getComprobanteDetail
);

/**
 * @route   PUT /api/finances/admin/comprobantes/:id/aprobar
 * @desc    Aprobar comprobante de pago
 * @access  Private (Administrador)
 */
adminRoutes.put(
    '/comprobantes/:id/aprobar',
    validateObjectId('id'),
    requireRole('administrador'),
    comprobantesController.approveComprobante
);

/**
 * @route   PUT /api/finances/admin/comprobantes/:id/rechazar
 * @desc    Rechazar comprobante de pago
 * @access  Private (Administrador)
 */
adminRoutes.put(
    '/comprobantes/:id/rechazar',
    validateObjectId('id'),
    requireRole('administrador'),
    comprobantesController.rejectComprobante
);

/**
 * @route   GET /api/finances/admin/comprobantes/estatus/:estatus
 * @desc    Obtener comprobantes por estatus (pendiente, aprobado, rechazado)
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/comprobantes/estatus/:estatus',
    comprobantesController.getComprobantesByStatus
);

/**
 * @route   GET /api/finances/admin/comprobantes/stats
 * @desc    Obtener estadísticas de comprobantes
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/comprobantes/stats',
    comprobantesController.getComprobantesStats
);

// -------------------- JOBS Y AUTOMATIZACIONES --------------------
/**
 * @route   POST /api/finances/admin/jobs/recurrent-charges/force
 * @desc    Forzar generación de cargos recurrentes (testing)
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/jobs/recurrent-charges/force',
    requireRole('administrador'),
    RecurrentChargesJob.forceGeneration
);

/**
 * @route   GET /api/finances/admin/jobs/recurrent-charges/status
 * @desc    Verificar estado de cargos recurrentes
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/jobs/recurrent-charges/status',
    RecurrentChargesJob.getRecurrentChargesStatus
);

/**
 * @route   POST /api/finances/admin/jobs/surcharges/force
 * @desc    Forzar aplicación de recargos (testing)
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/jobs/surcharges/force',
    requireRole('administrador'),
    SurchargesJob.forceApply
);

/**
 * @route   GET /api/finances/admin/jobs/surcharges/status
 * @desc    Verificar estado de recargos programados
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/jobs/surcharges/status',
    SurchargesJob.getSurchargesStatus
);

// -------------------- RESUMEN FINANCIERO --------------------
/**
 * @route   GET /api/finances/admin/summary
 * @desc    Obtener resumen financiero
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/summary',
    financesController.getFinancialSummary
);

// ==================== COMBINAR TODAS LAS RUTAS ====================

// Agregar rutas de administrador
router.use('/admin', adminRoutes);

// Agregar rutas de residente
router.use('/resident', residentRoutes);

// ==================== NUEVOS ENDPOINTS SEGÚN ESPECIFICACIÓN ====================

// -------------------- MODIFICAR CARGO --------------------
/**
 * @route   PUT /api/finances/admin/charges/:id/modify
 * @desc    Modificar cargo existente
 * @access  Private (Administrador)
 */
adminRoutes.put(
    '/charges/:id/modify',
    validateObjectId('id'),
    requireRole('administrador'),
    chargesController.modificarCargo,
);

// -------------------- GESTIÓN DE CUENTAS BANCARIAS --------------------
/**
 * @route   GET /api/finances/admin/cuentas-pago
 * @desc    Obtener todas las cuentas bancarias
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/cuentas-pago',
    chargesController.getCuentasBancarias
);

/**
 * @route   POST /api/finances/admin/cuentas-pago
 * @desc    Crear nueva cuenta bancaria
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/cuentas-pago',
    requireRole('administrador'),
    chargesController.crearCuentaBancaria
);

// -------------------- REGISTRO MANUAL DE PAGO POR ADMIN --------------------
/**
 * @route   POST /api/finances/admin/recaudacion/nuevo-pago
 * @desc    Registrar pago manualmente (cuando el residente paga al administrador)
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/recaudacion/nuevo-pago',
    requireRole('administrador'),
    upload.single('comprobante'),
    validateManualPayment,
    financesController.registrarPagoManualmente
);

// -------------------- ENDPOINT PARA DESCARGAR COMPROBANTE --------------------
/**
 * @route   GET /api/finances/comprobantes/:id/download
 * @desc    Descargar comprobante PDF
 * @access  Private (Residente del comprobante, Administrador)
 */
router.get('/comprobantes/:id/download', 
    authenticate,
    financesController.descargarComprobantePDF
);

// -------------------- ENDPOINT PARA VER COMPROBANTE EN NAVEGADOR --------------------
/**
 * @route   GET /api/finances/comprobantes/:id/view
 * @desc    Ver comprobante PDF en navegador
 * @access  Private (Residente del comprobante, Administrador)
 */
router.get('/comprobantes/:id/view', 
    authenticate,
    financesController.verComprobanteNavegador
);

// -------------------- ENDPOINT PARA REGENERAR COMPROBANTE (ADMIN) --------------------
/**
 * @route   POST /api/finances/admin/comprobantes/:id/regenerar
 * @desc    Regenerar comprobante PDF (para cuando se pierde o corrompe)
 * @access  Private (Administrador)
 */
adminRoutes.post('/comprobantes/:id/regenerar',
    requireRole('administrador'),
    validateObjectId('id'),
    financesController.regenerarComprobantePDF
);

// -------------------- PREVISUALIZAR ESTADO DE CUENTA --------------------
/**
 * @route   GET /api/finances/admin/recaudacion/previsualizar/:id
 * @desc    Previsualizar estado de cuenta de un residente (PDF/HTML)
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/recaudacion/previsualizar/:id',
    validateObjectId('id'),
    financesController.previsualizarEstadoCuenta
);

// -------------------- NOTIFICAR ESTADO DE CUENTA --------------------
/**
 * @route   POST /api/finances/admin/recaudacion/notificar/:id
 * @desc    Notificar estado de cuenta a residente
 * @access  Private (Administrador, Comité)
 */
adminRoutes.post(
    '/recaudacion/notificar/:id',
    validateObjectId('id'),
    financesController.notificarEstadoCuenta
);
// -------------------- SALDO A FAVOR --------------------

/**
 * @route   POST /api/finances/admin/saldo-favor/:domicilio_id/aplicar
 * @desc    Aplicar saldo a favor a cargos pendientes
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/saldo-favor/:domicilio_id/aplicar',
    validateObjectId('domicilio_id'),
    requireRole('administrador'),
    chargesController.applySaldoFavor
);

/**
 * @route   POST /api/finances/admin/saldo-favor/transferir
 * @desc    Transferir saldo a favor entre domicilios
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/saldo-favor/transferir',
    requireRole('administrador'),
    chargesController.transferSaldoFavor
);

/**
 * @route   PUT /api/finances/admin/surcharges/:id
 * @desc    Modificar recargo existente
 * @access  Private (Administrador)
 */
adminRoutes.put(
    '/surcharges/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    surchargesController.updateSurcharge
);

/**
 * @route   DELETE /api/finances/admin/surcharges/:id
 * @desc    Eliminar recargo
 * @access  Private (Administrador)
 */
adminRoutes.delete(
    '/surcharges/:id',
    validateObjectId('id'),
    requireRole('administrador'),
    surchargesController.deleteSurcharge
);


export default router;