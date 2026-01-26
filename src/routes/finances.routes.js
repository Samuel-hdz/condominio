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
import Utils from '../libs/utils.js';

import { SaldoDomicilio } from '../models/saldoDomicilio.model.js';
import { AuditoriaGeneral } from '../models/auditoriaGeneral.model.js';
import multer from 'multer';
import path from 'path';
import { Residente } from '../models/residente.model.js';
import mongoose from 'mongoose';
import { ComprobantePago } from '../models/comprobantePago.model.js';
import { validateManualPayment } from '../middlewares/financeValidation.js';
import { CargoDomicilio } from '../models/cargoDomicilio.model.js';
import { PagoAplicado } from '../models/pagoAplicado.model.js';
import NotificationService from '../libs/notifications.js';

import ComprobanteGenerator from '../libs/comprobanteGenerator.js';
import fs from 'fs';
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
    async (req, res) => {
        try {
            const { id } = req.params;
            const { 
                nombre, 
                descripcion, 
                monto_base, 
                fecha_vencimiento,
                descuentos 
            } = req.body;

            const cargo = await Cargo.findById(id);
            if (!cargo) {
                return res.status(404).json({
                    success: false,
                    message: 'Cargo no encontrado'
                });
            }

            // Verificar si se puede modificar
            if (cargo.estatus === 'cancelado') {
                return res.status(400).json({
                    success: false,
                    message: 'No se puede modificar un cargo cancelado'
                });
            }

            // Guardar valores originales para auditoría
            const originalValues = {
                nombre: cargo.nombre,
                monto_base: cargo.monto_base,
                fecha_vencimiento: cargo.fecha_vencimiento
            };

            // Actualizar campos
            if (nombre) cargo.nombre = nombre;
            if (descripcion !== undefined) cargo.descripcion = descripcion;
            
            if (monto_base && parseFloat(monto_base) !== cargo.monto_base) {
                const diferencia = parseFloat(monto_base) - cargo.monto_base;
                cargo.monto_base = parseFloat(monto_base);
                cargo.monto_total = parseFloat(monto_base);
                
                // Actualizar todos los CargoDomicilio relacionados
                await CargoDomicilio.updateMany(
                    { cargo_id: id },
                    { 
                        $inc: { 
                            monto: diferencia,
                            monto_final: diferencia,
                            saldo_pendiente: diferencia
                        }
                    }
                );
            }

            if (fecha_vencimiento) {
                cargo.fecha_vencimiento = new Date(fecha_vencimiento);
            }

            await cargo.save();

            // Aplicar descuentos si se proporcionan
            if (descuentos && descuentos.length > 0) {
                // Eliminar descuentos anteriores
                await Descuento.deleteMany({
                    cargo_domicilio_id: {
                        $in: (await CargoDomicilio.find({ cargo_id: id })).map(cd => cd._id)
                    }
                });

                // Aplicar nuevos descuentos
                const cargosDomicilio = await CargoDomicilio.find({ cargo_id: id });
                for (const cargoDom of cargosDomicilio) {
                    for (const desc of descuentos) {
                        await Descuento.create({
                            cargo_domicilio_id: cargoDom._id,
                            tipo_descuento: desc.tipo_descuento,
                            nombre_descuento: desc.nombre_descuento,
                            valor: desc.valor,
                            motivo: desc.motivo,
                            usuario_aplicador_id: req.userId
                        });

                        // Recalcular monto final
                        if (desc.tipo_descuento === 'porcentaje') {
                            cargoDom.porcentaje_descuento += parseFloat(desc.valor);
                        } else {
                            cargoDom.monto_descuento += parseFloat(desc.valor);
                        }
                    }
                    await cargoDom.save();
                }
            }

            res.json({
                success: true,
                message: 'Cargo modificado exitosamente',
                cargo: {
                    id: cargo._id,
                    nombre: cargo.nombre,
                    monto_base: cargo.monto_base,
                    fecha_vencimiento: cargo.fecha_vencimiento,
                    cambios: Object.keys(originalValues).filter(key => 
                        originalValues[key] !== cargo[key]
                    )
                }
            });

        } catch (error) {
            console.error('Error modificando cargo:', error);
            res.status(500).json({
                success: false,
                message: 'Error al modificar cargo',
                error: error.message
            });
        }
    }
);

// -------------------- GESTIÓN DE CUENTAS BANCARIAS --------------------
/**
 * @route   GET /api/finances/admin/cuentas-pago
 * @desc    Obtener todas las cuentas bancarias
 * @access  Private (Administrador, Comité)
 */
adminRoutes.get(
    '/cuentas-pago',
    async (req, res) => {
        try {
            const cuentas = await CuentaBancaria.find({ activa: true })
                .sort({ created_at: -1 });

            res.json({
                success: true,
                cuentas
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error obteniendo cuentas bancarias',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/finances/admin/cuentas-pago
 * @desc    Crear nueva cuenta bancaria
 * @access  Private (Administrador)
 */
adminRoutes.post(
    '/cuentas-pago',
    requireRole('administrador'),
    async (req, res) => {
        try {
            const {
                titulo,
                numero_cuenta,
                institucion,
                clabe,
                swift_code,
                tipo_cuenta = 'cheques',
                moneda = 'MXN'
            } = req.body;

            // Validar que no exista una cuenta con el mismo número en la misma institución
            const cuentaExistente = await CuentaBancaria.findOne({
                institucion,
                numero_cuenta
            });

            if (cuentaExistente) {
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe una cuenta con este número en esta institución'
                });
            }

            const cuenta = await CuentaBancaria.create({
                titulo,
                numero_cuenta,
                institucion,
                clabe,
                swift_code,
                tipo_cuenta,
                moneda,
                activa: true
            });

            res.status(201).json({
                success: true,
                message: 'Cuenta bancaria creada exitosamente',
                cuenta
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error creando cuenta bancaria',
                error: error.message
            });
        }
    }
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
    async (req, res) => {
        console.log('🚀 INICIANDO NUEVO PAGO MANUAL CON GENERACIÓN DE COMPROBANTE');
        
        const {
            residente_id,
            monto,
            fecha_pago,
            metodo_pago,
            institucion_bancaria,
            numero_referencia,
            cuenta_destino,
            asignaciones = [],
            observaciones
        } = req.body;

        const session = await mongoose.startSession();
        let transaccionActiva = false;
        
        try {
            // 1. VALIDAR RESIDENTE
            console.log('🔍 Buscando residente...');
            const residente = await Residente.findById(residente_id)
                .populate('user_id')
                .populate('domicilio_id');
            
            if (!residente) {
                console.error('❌ Residente no encontrado:', residente_id);
                await session.endSession();
                return res.status(404).json({
                    success: false,
                    message: 'Residente no encontrado'
                });
            }

            console.log(`✅ Residente encontrado: ${residente.user_id?.nombre || 'N/A'}`);

            // 2. VERIFICAR MONTO
            const montoNum = parseFloat(monto);
            if (montoNum <= 0) {
                console.error('❌ Monto inválido:', montoNum);
                await session.endSession();
                return res.status(400).json({
                    success: false,
                    message: 'El monto debe ser mayor a 0'
                });
            }

            // 3. INICIAR TRANSACCIÓN
            console.log('🔄 Iniciando transacción...');
            session.startTransaction();
            transaccionActiva = true;

            // 4. CREAR COMPROBANTE INICIAL
            console.log('📝 Creando comprobante...');
            const comprobanteData = {
                residente_id,
                monto_total: montoNum,
                fecha_pago: new Date(fecha_pago),
                metodo_pago,
                institucion_bancaria: institucion_bancaria || null,
                numero_referencia: numero_referencia || null,
                cuenta_destino: cuenta_destino || null,
                comprobante_url: req.file ? req.file.path : '/uploads/comprobantes/dummy.pdf',
                observaciones: observaciones || '',
                estatus: 'aprobado', // Directamente aprobado porque es manual del admin
                fecha_aprobacion: new Date(),
                usuario_aprobador_id: req.userId
            };

            const comprobante = await ComprobantePago.create([comprobanteData], { session });
            console.log(`✅ Comprobante creado: ${comprobante[0]._id}, Folio: ${comprobante[0].folio}`);

            let totalAsignado = 0;
            const pagosAplicados = [];
            const cargosDomicilioIds = [];

            // 5. PROCESAR ASIGNACIONES MANUALES O AUTOMÁTICAS
            if (asignaciones && asignaciones.length > 0) {
                console.log('🎯 Procesando asignaciones manuales...');
                
                for (const asignacion of asignaciones) {
                    const cargoDomicilio = await CargoDomicilio.findById(asignacion.cargo_domicilio_id)
                        .session(session);

                    if (!cargoDomicilio) {
                        throw new Error(`Cargo no encontrado: ${asignacion.cargo_domicilio_id}`);
                    }

                    // Verificar que el cargo pertenece al residente
                    if (!cargoDomicilio.domicilio_id.equals(residente.domicilio_id._id)) {
                        throw new Error(`El cargo ${cargoDomicilio._id} no pertenece al residente`);
                    }

                    const montoAsignacion = parseFloat(asignacion.monto);
                    
                    if (montoAsignacion > cargoDomicilio.saldo_pendiente) {
                        throw new Error(`Monto excede saldo pendiente del cargo. Saldo: ${cargoDomicilio.saldo_pendiente}, Intento: ${montoAsignacion}`);
                    }

                    // Crear PagoAplicado
                    const pagoAplicado = await PagoAplicado.create([{
                        comprobante_id: comprobante[0]._id,
                        cargo_domicilio_id: cargoDomicilio._id,
                        monto_aplicado: montoAsignacion,
                        tipo_asignacion: 'manual',
                        usuario_asignador_id: req.userId,
                        notas: `Pago manual registrado por administrador`
                    }], { session });

                    pagosAplicados.push(pagoAplicado[0]);
                    cargosDomicilioIds.push(cargoDomicilio._id);

                    // Actualizar CargoDomicilio
                    const nuevoSaldo = cargoDomicilio.saldo_pendiente - montoAsignacion;
                    const nuevoEstatus = nuevoSaldo <= 0 ? 'pagado' : cargoDomicilio.estatus;
                    
                    await CargoDomicilio.updateOne(
                        { _id: cargoDomicilio._id },
                        {
                            $set: {
                                saldo_pendiente: nuevoSaldo,
                                estatus: nuevoEstatus,
                                ...(nuevoSaldo <= 0 && { fecha_pago: new Date() })
                            }
                        },
                        { session }
                    );

                    totalAsignado += montoAsignacion;
                }
            } else {
                console.log('🤖 Procesando asignación automática por antigüedad...');
                
                const cargosPendientes = await CargoDomicilio.find({
                    domicilio_id: residente.domicilio_id._id,
                    saldo_pendiente: { $gt: 0 },
                    estatus: { $in: ['pendiente', 'vencido'] }
                })
                .populate('cargo_id', 'nombre fecha_vencimiento')
                .sort({ 'cargo_id.fecha_vencimiento': 1 })
                .session(session);

                let montoRestante = montoNum;

                for (const cargoDomicilio of cargosPendientes) {
                    if (montoRestante <= 0) break;

                    const montoAAplicar = Math.min(montoRestante, cargoDomicilio.saldo_pendiente);

                    // Crear PagoAplicado
                    const pagoAplicado = await PagoAplicado.create([{
                        comprobante_id: comprobante[0]._id,
                        cargo_domicilio_id: cargoDomicilio._id,
                        monto_aplicado: montoAAplicar,
                        tipo_asignacion: 'automatica_admin',
                        usuario_asignador_id: req.userId,
                        notas: 'Asignación automática por antigüedad'
                    }], { session });

                    pagosAplicados.push(pagoAplicado[0]);
                    cargosDomicilioIds.push(cargoDomicilio._id);

                    // Actualizar cargo domicilio
                    const nuevoSaldo = cargoDomicilio.saldo_pendiente - montoAAplicar;
                    const nuevoEstatus = nuevoSaldo <= 0 ? 'pagado' : cargoDomicilio.estatus;
                    
                    await CargoDomicilio.updateOne(
                        { _id: cargoDomicilio._id },
                        {
                            $set: {
                                saldo_pendiente: nuevoSaldo,
                                estatus: nuevoEstatus,
                                ...(nuevoSaldo <= 0 && { fecha_pago: new Date() })
                            }
                        },
                        { session }
                    );

                    montoRestante -= montoAAplicar;
                    totalAsignado += montoAAplicar;
                }

                // Manejar saldo a favor si sobra monto
                if (montoRestante > 0) {
                    console.log(`💎 Generando saldo a favor: ${montoRestante}`);
                    await SaldoDomicilio.findOneAndUpdate(
                        { domicilio_id: residente.domicilio_id._id },
                        { 
                            $inc: { saldo_favor: montoRestante },
                            $set: { 
                                notas: `Saldo generado por pago manual (${Utils.formatCurrency(montoNum)})`
                            }
                        },
                        { upsert: true, new: true, session }
                    );
                }
            }

            // 6. ✅ GENERAR COMPROBANTE PDF
            console.log('📄 Generando comprobante PDF...');
            
            // Popular el comprobante para el generador
            await comprobante[0].populate([
                {
                    path: 'residente_id',
                    populate: [
                        { path: 'user_id', select: 'nombre apellido email' },
                        { 
                            path: 'domicilio_id', 
                            populate: {
                                path: 'calle_torre_id',
                                select: 'nombre tipo'
                            }
                        }
                    ]
                },
                { path: 'usuario_aprobador_id', select: 'nombre apellido' }
            ]);
            
            // Popular pagos aplicados para el generador
            for (const pago of pagosAplicados) {
                await pago.populate({
                    path: 'cargo_domicilio_id',
                    populate: {
                        path: 'cargo_id',
                        select: 'nombre'
                    }
                });
            }

            // Generar el comprobante PDF
            const comprobantePDF = await ComprobanteGenerator.generateComprobante(
                comprobante[0],
                pagosAplicados
            );

            // Actualizar comprobante con la URL del PDF generado
            comprobante[0].comprobante_final_url = comprobantePDF.url;
            await comprobante[0].save({ session });
            
            console.log(`✅ Comprobante PDF generado: ${comprobantePDF.fileName}`);

            // 7. COMMIT TRANSACCIÓN
            console.log('✅ Todo OK, confirmando transacción...');
            await session.commitTransaction();
            transaccionActiva = false;
            console.log('🎉 Transacción confirmada exitosamente!');

            // 8. NOTIFICAR AL RESIDENTE (FUERA DE TRANSACCIÓN)
            let notificacionEnviada = false;
            try {
                if (residente.user_id && residente.user_id._id) {
                    console.log('📨 Enviando notificación al residente...');
                    
                    await NotificationService.sendNotification({
                        userId: residente.user_id._id,
                        tipo: 'push',
                        titulo: '💰 Pago registrado por administrador',
                        mensaje: `Se registró un pago de ${Utils.formatCurrency(montoNum)} y se generó tu comprobante ${comprobante[0].folio}`,
                        data: {
                            tipo: 'pago_manual',
                            action: 'admin_registered',
                            comprobante_id: comprobante[0]._id,
                            comprobante_url: comprobante[0].comprobante_final_url,
                            folio: comprobante[0].folio,
                            monto_total: montoNum,
                            monto_aplicado: totalAsignado,
                            saldo_favor_generado: montoNum - totalAsignado
                        },
                        accionRequerida: true,
                        accionTipo: 'descargar_comprobante',
                        accionData: { 
                            comprobanteId: comprobante[0]._id,
                            pdfUrl: comprobante[0].comprobante_final_url 
                        }
                    });
                    
                    notificacionEnviada = true;
                    console.log('✅ Notificación enviada');
                }
            } catch (notifError) {
                console.warn('⚠️ Error enviando notificación:', notifError.message);
            }

            // 9. RESPUESTA EXITOSA
            res.status(201).json({
                success: true,
                message: 'Pago manual registrado exitosamente. Comprobante generado.',
                data: {
                    comprobante_id: comprobante[0]._id,
                    folio: comprobante[0].folio,
                    comprobante_pdf_url: comprobante[0].comprobante_final_url,
                    residente: {
                        id: residente._id,
                        nombre: `${residente.user_id?.nombre || ''} ${residente.user_id?.apellido || ''}`.trim()
                    },
                    monto_total: montoNum,
                    monto_aplicado: totalAsignado,
                    saldo_favor_generado: montoNum - totalAsignado,
                    cargos_afectados: pagosAplicados.length,
                    fecha_registro: new Date(),
                    notificacion_enviada: notificacionEnviada,
                    detalles_generacion: {
                        pdf_generado: true,
                        nombre_archivo: comprobantePDF.fileName,
                        fecha_generacion: new Date()
                    }
                }
            });

        } catch (error) {
            console.error('\n❌ ERROR EN PROCESO DE PAGO:');
            console.error('   Mensaje:', error.message);
            console.error('   Stack:', error.stack);
            
            if (session && transaccionActiva) {
                try {
                    console.log('🔄 Abortando transacción...');
                    await session.abortTransaction();
                } catch (abortError) {
                    console.error('❌ Error abortando transacción:', abortError.message);
                }
            }
            
            res.status(400).json({
                success: false,
                message: error.message || 'Error registrando pago manual',
                error_details: {
                    step: 'processing_payment',
                    timestamp: new Date().toISOString()
                }
            });
            
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }
);

// -------------------- ENDPOINT PARA DESCARGAR COMPROBANTE --------------------
/**
 * @route   GET /api/finances/comprobantes/:id/download
 * @desc    Descargar comprobante PDF
 * @access  Private (Residente del comprobante, Administrador)
 */
router.get('/comprobantes/:id/download', 
    authenticate,
    async (req, res) => {
        try {
            const { id } = req.params;

            // 1. BUSCAR COMPROBANTE
            const comprobante = await ComprobantePago.findById(id)
                .populate('residente_id')
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'user_id',
                        select: '_id'
                    }
                });

            if (!comprobante) {
                return res.status(404).json({
                    success: false,
                    message: 'Comprobante no encontrado'
                });
            }

            // 2. VERIFICAR PERMISOS
            const isAdmin = req.user.role === 'administrador';
            const isResidentePropietario = req.user.role === 'residente' && 
                comprobante.residente_id?.user_id?._id.toString() === req.userId;
            
            if (!isAdmin && !isResidentePropietario) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permisos para acceder a este comprobante'
                });
            }

            // 3. VERIFICAR QUE EXISTE COMPROBANTE GENERADO
            if (!comprobante.comprobante_final_url) {
                return res.status(404).json({
                    success: false,
                    message: 'Comprobante PDF no ha sido generado aún'
                });
            }

            // 4. CONSTRUIR RUTA DEL ARCHIVO
            const filePath = path.join(
                __dirname, 
                '..', 
                '..', 
                comprobante.comprobante_final_url.startsWith('/') 
                    ? comprobante.comprobante_final_url.substring(1) 
                    : comprobante.comprobante_final_url
            );

            // 5. VERIFICAR QUE EL ARCHIVO EXISTE
            if (!fs.existsSync(filePath)) {
                console.error(`❌ Archivo no encontrado: ${filePath}`);
                
                // Intentar regenerar si es administrador
                if (isAdmin) {
                    return res.status(404).json({
                        success: false,
                        message: 'Archivo no encontrado. El comprobante necesita ser regenerado.',
                        action_required: 'regenerate',
                        comprobante_id: comprobante._id
                    });
                } else {
                    return res.status(404).json({
                        success: false,
                        message: 'El comprobante no está disponible. Contacte al administrador.'
                    });
                }
            }

            // 6. ENVIAR ARCHIVO
            const fileName = `comprobante-${comprobante.folio}.pdf`;
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.setHeader('Content-Length', fs.statSync(filePath).size);
            
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);

            console.log(`📤 Comprobante descargado: ${fileName} por usuario ${req.userId}`);

        } catch (error) {
            console.error('❌ Error descargando comprobante:', error);
            res.status(500).json({
                success: false,
                message: 'Error al descargar comprobante',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// -------------------- ENDPOINT PARA VER COMPROBANTE EN NAVEGADOR --------------------
/**
 * @route   GET /api/finances/comprobantes/:id/view
 * @desc    Ver comprobante PDF en navegador
 * @access  Private (Residente del comprobante, Administrador)
 */
router.get('/comprobantes/:id/view', 
    authenticate,
    async (req, res) => {
        try {
            const { id } = req.params;

            // Misma lógica de permisos que el endpoint de descarga...
            const comprobante = await ComprobantePago.findById(id)
                .populate('residente_id')
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'user_id',
                        select: '_id'
                    }
                });

            if (!comprobante) {
                return res.status(404).json({
                    success: false,
                    message: 'Comprobante no encontrado'
                });
            }

            const isAdmin = req.user.role === 'administrador';
            const isResidentePropietario = req.user.role === 'residente' && 
                comprobante.residente_id?.user_id?._id.toString() === req.userId;
            
            if (!isAdmin && !isResidentePropietario) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permisos para ver este comprobante'
                });
            }

            if (!comprobante.comprobante_final_url) {
                return res.status(404).json({
                    success: false,
                    message: 'Comprobante PDF no ha sido generado aún'
                });
            }

            const filePath = path.join(
                __dirname, 
                '..', 
                '..', 
                comprobante.comprobante_final_url.startsWith('/') 
                    ? comprobante.comprobante_final_url.substring(1) 
                    : comprobante.comprobante_final_url
            );

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    success: false,
                    message: 'Archivo no encontrado'
                });
            }

            // Enviar para visualización en lugar de descarga
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="comprobante-${comprobante.folio}.pdf"`);
            
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);

        } catch (error) {
            console.error('Error viendo comprobante:', error);
            res.status(500).json({
                success: false,
                message: 'Error al mostrar comprobante'
            });
        }
    }
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
    async (req, res) => {
        try {
            const { id } = req.params;

            const comprobante = await ComprobantePago.findById(id)
                .populate('residente_id')
                .populate('usuario_aprobador_id', 'nombre apellido');

            if (!comprobante) {
                return res.status(404).json({
                    success: false,
                    message: 'Comprobante no encontrado'
                });
            }

            // Solo se puede regenerar si está aprobado
            if (comprobante.estatus !== 'aprobado') {
                return res.status(400).json({
                    success: false,
                    message: 'Solo se pueden regenerar comprobantes aprobados'
                });
            }

            // Obtener pagos aplicados
            const pagosAplicados = await PagoAplicado.find({ 
                comprobante_id: comprobante._id 
            }).populate({
                path: 'cargo_domicilio_id',
                populate: {
                    path: 'cargo_id',
                    select: 'nombre'
                }
            });

            if (pagosAplicados.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No hay pagos aplicados para este comprobante'
                });
            }

            // Generar nuevo comprobante
            const comprobantePDF = await ComprobanteGenerator.generateComprobante(
                comprobante,
                pagosAplicados
            );

            // Actualizar comprobante con nueva URL
            const oldUrl = comprobante.comprobante_final_url;
            comprobante.comprobante_final_url = comprobantePDF.url;
            await comprobante.save();

            // Eliminar archivo antiguo si existe y es diferente
            if (oldUrl && oldUrl !== comprobantePDF.url) {
                try {
                    const oldPath = path.join(__dirname, '..', '..', oldUrl.startsWith('/') ? oldUrl.substring(1) : oldUrl);
                    if (fs.existsSync(oldPath)) {
                        fs.unlinkSync(oldPath);
                        console.log(`🗑️ Archivo antiguo eliminado: ${oldPath}`);
                    }
                } catch (deleteError) {
                    console.warn('⚠️ No se pudo eliminar archivo antiguo:', deleteError.message);
                }
            }

            res.json({
                success: true,
                message: 'Comprobante regenerado exitosamente',
                comprobante: {
                    id: comprobante._id,
                    folio: comprobante.folio,
                    nuevo_comprobante_url: comprobante.comprobante_final_url,
                    fecha_regeneracion: new Date(),
                    detalles: {
                        pagos_aplicados: pagosAplicados.length,
                        monto_total: comprobante.monto_total,
                        nombre_archivo: comprobantePDF.fileName
                    }
                }
            });

        } catch (error) {
            console.error('Error regenerando comprobante:', error);
            res.status(500).json({
                success: false,
                message: 'Error al regenerar comprobante',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
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
    async (req, res) => {
        try {
            const { id } = req.params;

            const residente = await Residente.findById(id)
                .populate('user_id', 'nombre apellido email telefono')
                .populate({
                    path: 'domicilio_id',
                    populate: {
                        path: 'calle_torre_id',
                        select: 'nombre tipo'
                    }
                });

            if (!residente) {
                return res.status(404).json({
                    success: false,
                    message: 'Residente no encontrado'
                });
            }

            // Obtener cargos del domicilio
            const cargosDomicilio = await CargoDomicilio.find({
                domicilio_id: residente.domicilio_id._id
            })
            .populate('cargo_id', 'nombre descripcion fecha_cargo fecha_vencimiento')
            .populate({
                path: 'cargo_id',
                populate: {
                    path: 'tipo_cargo_id',
                    select: 'nombre tipo'
                }
            })
            .sort({ 'cargo_id.fecha_vencimiento': 1 });

            // Calcular totales
            let totalPagado = 0;
            let totalPendiente = 0;
            let totalVencido = 0;
            
            const cargosDetallados = cargosDomicilio.map(cargoDom => {
                const montoPendiente = cargoDom.saldo_pendiente;
                const esVencido = cargoDom.estatus === 'vencido';
                
                if (esVencido) {
                    totalVencido += montoPendiente;
                } else if (cargoDom.estatus === 'pendiente') {
                    totalPendiente += montoPendiente;
                } else if (cargoDom.estatus === 'pagado') {
                    totalPagado += (cargoDom.monto_final - montoPendiente);
                }

                return {
                    nombre: cargoDom.cargo_id.nombre,
                    tipo: cargoDom.cargo_id.tipo_cargo_id.tipo,
                    descripcion: cargoDom.cargo_id.descripcion,
                    fecha_cargo: cargoDom.cargo_id.fecha_cargo,
                    fecha_vencimiento: cargoDom.cargo_id.fecha_vencimiento,
                    monto_original: cargoDom.monto,
                    descuentos: cargoDom.monto_descuento + 
                               (cargoDom.monto * cargoDom.porcentaje_descuento / 100),
                    monto_final: cargoDom.monto_final,
                    saldo_pendiente: montoPendiente,
                    estatus: cargoDom.estatus,
                    dias_vencido: esVencido ? 
                        Utils.daysBetween(cargoDom.cargo_id.fecha_vencimiento, new Date()) : 0
                };
            });

            // Obtener saldo a favor
            const saldoDomicilio = await SaldoDomicilio.findOne({
                domicilio_id: residente.domicilio_id._id
            });

            // Generar datos para previsualización
            const estadoCuenta = {
                residente: {
                    nombre: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                    email: residente.user_id.email,
                    telefono: residente.user_id.telefono,
                    domicilio: {
                        calle: residente.domicilio_id.calle_torre_id?.nombre || 'N/A',
                        numero: residente.domicilio_id.numero
                    }
                },
                fecha_generacion: new Date(),
                resumen: {
                    total_pagado: totalPagado,
                    total_pendiente: totalPendiente,
                    total_vencido: totalVencido,
                    total_general: totalPendiente + totalVencido,
                    saldo_favor: saldoDomicilio?.saldo_favor || 0
                },
                cargos: cargosDetallados,
                total_cargos: cargosDetallados.length
            };

            // En una implementación real, aquí generarías un PDF
            // Por ahora, devolvemos los datos estructurados
            
            res.json({
                success: true,
                estado_cuenta,
                opciones: {
                    formato: 'html', // En producción: 'pdf', 'html', 'json'
                    descargable: true,
                    incluir_logo: true,
                    incluir_firmas: false
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error generando previsualización',
                error: error.message
            });
        }
    }
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
    async (req, res) => {
        try {
            const { id } = req.params;
            const { mensaje_personalizado } = req.body;

            const residente = await Residente.findById(id)
                .populate('user_id');

            if (!residente) {
                return res.status(404).json({
                    success: false,
                    message: 'Residente no encontrado'
                });
            }

            // Obtener estado de cuenta
            const cargosDomicilio = await CargoDomicilio.find({
                domicilio_id: residente.domicilio_id._id,
                saldo_pendiente: { $gt: 0 },
                estatus: { $in: ['pendiente', 'vencido'] }
            })
            .populate('cargo_id', 'nombre fecha_vencimiento');

            const totalPendiente = cargosDomicilio.reduce((sum, cd) => sum + cd.saldo_pendiente, 0);
            const cargosVencidos = cargosDomicilio.filter(cd => cd.estatus === 'vencido').length;

            // Enviar notificación
            await NotificationService.sendNotification({
                userId: residente.user_id._id,
                tipo: 'push',
                titulo: '📊 Estado de cuenta',
                mensaje: mensaje_personalizado || 
                        `Tienes ${cargosDomicilio.length} cargo(s) pendiente(s) por un total de ${Utils.formatCurrency(totalPendiente)}. ${cargosVencidos > 0 ? `${cargosVencidos} vencido(s).` : ''}`,
                data: {
                    tipo: 'estado_cuenta',
                    action: 'notified',
                    total_cargos: cargosDomicilio.length,
                    total_pendiente: totalPendiente,
                    cargos_vencidos: cargosVencidos,
                    fecha_notificacion: new Date()
                },
                accionRequerida: true,
                accionTipo: 'ver_estado_cuenta'
            });

            // Registrar la notificación en el sistema
            console.log(`📨 [NOTIFICACIÓN] Estado de cuenta notificado a ${residente.user_id.email}`);

            res.json({
                success: true,
                message: 'Estado de cuenta notificado exitosamente',
                notificacion: {
                    residente: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                    email: residente.user_id.email,
                    total_cargos: cargosDomicilio.length,
                    total_pendiente: totalPendiente,
                    fecha_envio: new Date()
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error notificando estado de cuenta',
                error: error.message
            });
        }
    }
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