import { Cargo } from '../models/cargo.model.js';
import { CargoDomicilio } from '../models/cargoDomicilio.model.js';
import { ComprobantePago } from '../models/comprobantePago.model.js';
import { PagoAplicado } from '../models/pagoAplicado.model.js';
import { Residente } from '../models/residente.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import { CuentaBancaria } from '../models/cuentaBancaria.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';
import { UserRole } from '../models/userRole.model.js';

export const financesController = {
    /**
     * Obtener estado de cuenta del residente
     */
    getAccountStatus: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;

        // Obtener el residente y su domicilio
        const residente = await Residente.findById(residenteId)
            .populate('domicilio_id');
        
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Obtener cargos del domicilio
        const cargosDomicilio = await CargoDomicilio.find({
            domicilio_id: residente.domicilio_id._id,
            estatus: { $in: ['pendiente', 'vencido'] }
        })
        .populate('cargo_id', 'nombre descripcion fecha_cargo fecha_vencimiento')
        .sort({ created_at: -1 });

        // Calcular totales
        let totalPendiente = 0;
        let totalVencido = 0;
        const cargosDetallados = [];

        for (const cargoDom of cargosDomicilio) {
            const montoPendiente = cargoDom.saldo_pendiente;
            
            if (cargoDom.estatus === 'vencido') {
                totalVencido += montoPendiente;
            } else {
                totalPendiente += montoPendiente;
            }

            cargosDetallados.push({
                cargo_id: cargoDom.cargo_id._id,
                nombre: cargoDom.cargo_id.nombre,
                descripcion: cargoDom.cargo_id.descripcion,
                fecha_cargo: cargoDom.cargo_id.fecha_cargo,
                fecha_vencimiento: cargoDom.cargo_id.fecha_vencimiento,
                monto_original: cargoDom.monto,
                descuentos: cargoDom.monto_descuento + 
                           (cargoDom.monto * cargoDom.porcentaje_descuento / 100),
                monto_final: cargoDom.monto_final,
                saldo_pendiente: cargoDom.saldo_pendiente,
                estatus: cargoDom.estatus,
                dias_vencido: cargoDom.estatus === 'vencido' ? 
                    Utils.daysBetween(cargoDom.cargo_id.fecha_vencimiento, new Date()) : 0
            });
        }

        // Obtener comprobantes recientes
        const comprobantesRecientes = await ComprobantePago.find({
            residente_id: residenteId,
            estatus: 'aprobado'
        })
        .sort({ fecha_pago: -1 })
        .limit(5);

        // Obtener cuentas bancarias para referencia
        const cuentasBancarias = await CuentaBancaria.find({ activa: true });

        res.json({
            success: true,
            estado_cuenta: {
                residente: {
                    nombre: residente.user_id ? `${residente.user_id.nombre} ${residente.user_id.apellido}` : 'N/A',
                    domicilio: residente.domicilio_id
                },
                resumen: {
                    total_pendiente: totalPendiente,
                    total_vencido: totalVencido,
                    total_general: totalPendiente + totalVencido,
                    total_cargos: cargosDetallados.length
                },
                cargos: cargosDetallados,
                comprobantes_recientes: comprobantesRecientes,
                cuentas_referencia: cuentasBancarias
            }
        });
    }),

    /**
     * Subir comprobante de pago
     */
    uploadPaymentReceipt: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const {
            tipo_cargo,
            monto_total,
            fecha_pago,
            metodo_pago,
            institucion_bancaria,
            numero_referencia,
            cuenta_destino,
            observaciones
        } = req.body;

        // Obtener el residente
        const residente = await Residente.findById(residenteId);
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Verificar archivo adjunto
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere el comprobante de pago'
            });
        }

        // Crear comprobante
        const comprobante = await ComprobantePago.create({
            residente_id: residenteId,
            tipo_cargo,
            monto_total: parseFloat(monto_total),
            fecha_pago: new Date(fecha_pago),
            metodo_pago,
            institucion_bancaria,
            numero_referencia,
            cuenta_destino,
            comprobante_url: req.file.path, // Ruta del archivo subido
            observaciones,
            estatus: 'pendiente'
        });

        // Enviar notificación a administradores
        const usuariosAdmin = await UserRole.find({ role: 'administrador' })
            .distinct('user_id');

        const residenteInfo = await Residente.findById(residenteId)
            .populate('user_id');

        for (const adminUserId of usuariosAdmin) {
            await NotificationService.sendNotification({
                userId: adminUserId,
                tipo: 'in_app',
                titulo: '💰 Nuevo comprobante de pago',
                mensaje: `${residenteInfo.user_id.nombre} ha subido un comprobante de ${Utils.formatCurrency(monto_total)}`,
                data: { 
                    tipo: 'pago', 
                    action: 'comprobante_subido',
                    comprobante_id: comprobante._id,
                    residente_id: residenteId,
                    monto: monto_total
                },
                accionRequerida: true,
                accionTipo: 'ver_comprobante',
                accionData: { comprobanteId: comprobante._id }
            });
        }

        // Enviar notificación al residente
        await NotificationService.sendNotification({
            userId: req.userId,
            tipo: 'in_app',
            titulo: '✅ Comprobante subido',
            mensaje: 'Tu comprobante ha sido enviado para revisión',
            data: { 
                tipo: 'pago', 
                action: 'comprobante_enviado',
                comprobante_id: comprobante._id
            }
        });

        res.status(201).json({
            success: true,
            message: 'Comprobante subido exitosamente. En espera de validación.',
            comprobante: {
                id: comprobante._id,
                folio: comprobante.folio,
                monto_total: comprobante.monto_total,
                fecha_pago: comprobante.fecha_pago,
                estatus: comprobante.estatus
            }
        });
    }),

    /**
     * Obtener historial de pagos del residente
     */
    getPaymentHistory: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { 
            page = 1, 
            limit = 20,
            estatus,
            desde,
            hasta 
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        let query = { residente_id: residenteId };

        if (estatus) {
            query.estatus = estatus;
        }

        if (desde || hasta) {
            query.fecha_pago = {};
            if (desde) {
                query.fecha_pago.$gte = new Date(desde);
            }
            if (hasta) {
                const fechaHasta = new Date(hasta);
                fechaHasta.setHours(23, 59, 59, 999);
                query.fecha_pago.$lte = fechaHasta;
            }
        }

        // Obtener comprobantes
        const [comprobantes, total] = await Promise.all([
            ComprobantePago.find(query)
                .populate('usuario_aprobador_id', 'nombre apellido')
                .sort({ fecha_pago: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            ComprobantePago.countDocuments(query)
        ]);

        // Para cada comprobante, obtener los pagos aplicados
        const comprobantesDetallados = await Promise.all(
            comprobantes.map(async (comp) => {
                const pagosAplicados = await PagoAplicado.find({
                    comprobante_id: comp._id
                }).populate('cargo_domicilio_id', 'cargo_id');

                return {
                    ...comp.toObject(),
                    pagos_aplicados: pagosAplicados
                };
            })
        );

        res.json({
            success: true,
            comprobantes: comprobantesDetallados,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener cuentas bancarias para referencia
     */
    getBankAccounts: catchAsync(async (req, res) => {
        const cuentas = await CuentaBancaria.find({ activa: true });

        res.json({
            success: true,
            cuentas
        });
    }),

    /**
     * Obtener cargos pendientes específicos para seleccionar pago
     */
    getPendingCharges: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;

        // Obtener el residente y su domicilio
        const residente = await Residente.findById(residenteId);
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Obtener cargos pendientes del domicilio
        const cargosPendientes = await CargoDomicilio.find({
            domicilio_id: residente.domicilio_id._id,
            estatus: { $in: ['pendiente', 'vencido'] },
            saldo_pendiente: { $gt: 0 }
        })
        .populate('cargo_id', 'nombre descripcion tipo_cargo_id fecha_vencimiento')
        .populate({
            path: 'cargo_id',
            populate: {
                path: 'tipo_cargo_id',
                select: 'nombre tipo'
            }
        })
        .sort({ 'cargo_id.fecha_vencimiento': 1 });

        // Formatear respuesta
        const cargosFormateados = cargosPendientes.map(cargo => ({
            id: cargo._id,
            cargo_id: cargo.cargo_id._id,
            nombre: cargo.cargo_id.nombre,
            descripcion: cargo.cargo_id.descripcion,
            tipo: cargo.cargo_id.tipo_cargo_id.tipo,
            fecha_vencimiento: cargo.cargo_id.fecha_vencimiento,
            monto_original: cargo.monto,
            monto_final: cargo.monto_final,
            saldo_pendiente: cargo.saldo_pendiente,
            estatus: cargo.estatus,
            dias_vencido: cargo.estatus === 'vencido' ? 
                Utils.daysBetween(cargo.cargo_id.fecha_vencimiento, new Date()) : 0
        }));

        res.json({
            success: true,
            cargos: cargosFormateados
        });
    }),

    /**
     * Asignar pago manualmente a cargos específicos (residente)
     */
    assignPaymentToCharges: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { comprobante_id, asignaciones } = req.body;

        // Verificar que el comprobante pertenece al residente
        const comprobante = await ComprobantePago.findOne({
            _id: comprobante_id,
            residente_id: residenteId,
            estatus: 'pendiente'
        });

        if (!comprobante) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado o no está pendiente'
            });
        }

        // Calcular total de asignaciones
        const totalAsignado = asignaciones.reduce((sum, asig) => sum + asig.monto, 0);

        // Verificar que no se exceda el monto del comprobante
        if (totalAsignado > comprobante.monto_total) {
            return res.status(400).json({
                success: false,
                message: `El total asignado (${Utils.formatCurrency(totalAsignado)}) excede el monto del comprobante (${Utils.formatCurrency(comprobante.monto_total)})`
            });
        }

        // Aplicar asignaciones
        const pagosAplicados = [];

        for (const asig of asignaciones) {
            const cargoDomicilio = await CargoDomicilio.findById(asig.cargo_domicilio_id);
            
            if (!cargoDomicilio) {
                return res.status(404).json({
                    success: false,
                    message: `Cargo no encontrado: ${asig.cargo_domicilio_id}`
                });
            }

            // Verificar que el cargo pertenece al residente
            const residente = await Residente.findById(residenteId);
            if (!cargoDomicilio.domicilio_id.equals(residente.domicilio_id._id)) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permisos para asignar pagos a este cargo'
                });
            }

            // Verificar que el monto no exceda el saldo pendiente
            if (asig.monto > cargoDomicilio.saldo_pendiente) {
                return res.status(400).json({
                    success: false,
                    message: `El monto asignado (${Utils.formatCurrency(asig.monto)}) excede el saldo pendiente del cargo (${Utils.formatCurrency(cargoDomicilio.saldo_pendiente)})`
                });
            }

            // Crear pago aplicado
            const pagoAplicado = await PagoAplicado.create({
                comprobante_id: comprobante._id,
                cargo_domicilio_id: cargoDomicilio._id,
                monto_aplicado: asig.monto,
                tipo_asignacion: 'manual',
                usuario_asignador_id: req.userId
            });

            pagosAplicados.push(pagoAplicado);

            // Actualizar saldo del cargo
            cargoDomicilio.saldo_pendiente -= asig.monto;
            
            if (cargoDomicilio.saldo_pendiente <= 0) {
                cargoDomicilio.estatus = 'pagado';
                cargoDomicilio.fecha_pago = new Date();
            }
            
            await cargoDomicilio.save();
        }

        // Si se asignó el monto completo, marcar comprobante como aprobado
        if (Math.abs(totalAsignado - comprobante.monto_total) < 0.01) { // Comparación con tolerancia
            comprobante.estatus = 'aprobado';
            comprobante.fecha_aprobacion = new Date();
            comprobante.usuario_aprobador_id = req.userId;
            await comprobante.save();

            // Enviar notificación al residente
            await NotificationService.notifications.pagoAprobado(
                req.userId,
                {
                    concepto: 'Pago asignado manualmente',
                    monto: comprobante.monto_total,
                    comprobante_id: comprobante._id
                }
            );
        }

        res.json({
            success: true,
            message: 'Pago asignado exitosamente',
            total_asignado: totalAsignado,
            pagos_aplicados: pagosAplicados,
            comprobante_estatus: comprobante.estatus
        });
    }),

    /**
     * Obtener resumen financiero (para administradores)
     */
    getFinancialSummary: catchAsync(async (req, res) => {
        const { mes, año } = req.query;

        // Determinar rango de fechas
        const ahora = new Date();
        const inicioMes = mes && año 
            ? new Date(año, mes - 1, 1)
            : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        
        const finMes = new Date(inicioMes.getFullYear(), inicioMes.getMonth() + 1, 0);
        finMes.setHours(23, 59, 59, 999);

        // Estadísticas de cargos
        const totalCargosGenerados = await Cargo.countDocuments({
            fecha_cargo: { $gte: inicioMes, $lte: finMes }
        });

        const totalMontoCargos = await Cargo.aggregate([
            { 
                $match: { 
                    fecha_cargo: { $gte: inicioMes, $lte: finMes }
                } 
            },
            { $group: { 
                _id: null, 
                total: { $sum: '$monto_total' } 
            }}
        ]);

        // Estadísticas de pagos
        const totalPagosRecibidos = await ComprobantePago.countDocuments({
            fecha_pago: { $gte: inicioMes, $lte: finMes },
            estatus: 'aprobado'
        });

        const totalMontoPagado = await ComprobantePago.aggregate([
            { 
                $match: { 
                    fecha_pago: { $gte: inicioMes, $lte: finMes },
                    estatus: 'aprobado'
                } 
            },
            { $group: { 
                _id: null, 
                total: { $sum: '$monto_total' } 
            }}
        ]);

        // Morosidad
        const totalCargosVencidos = await CargoDomicilio.countDocuments({
            estatus: 'vencido',
            saldo_pendiente: { $gt: 0 }
        });

        const totalMontoVencido = await CargoDomicilio.aggregate([
            { 
                $match: { 
                    estatus: 'vencido',
                    saldo_pendiente: { $gt: 0 }
                } 
            },
            { $group: { 
                _id: null, 
                total: { $sum: '$saldo_pendiente' } 
            }}
        ]);

        // Residentes morosos
        const residentesMorososCount = await Residente.countDocuments({
            _id: {
                $in: (await CargoDomicilio.distinct('residente_id', {
                    estatus: 'vencido',
                    saldo_pendiente: { $gt: 0 }
                }))
            }
        });

        // Métodos de pago más usados
        const metodosPago = await ComprobantePago.aggregate([
            { 
                $match: { 
                    fecha_pago: { $gte: inicioMes, $lte: finMes },
                    estatus: 'aprobado'
                } 
            },
            { $group: { 
                _id: '$metodo_pago', 
                count: { $sum: 1 },
                total: { $sum: '$monto_total' }
            }},
            { $sort: { total: -1 } }
        ]);

        res.json({
            success: true,
            resumen: {
                periodo: {
                    inicio: inicioMes,
                    fin: finMes
                },
                cargos: {
                    total_generados: totalCargosGenerados,
                    monto_total: totalMontoCargos[0]?.total || 0
                },
                pagos: {
                    total_recibidos: totalPagosRecibidos,
                    monto_total: totalMontoPagado[0]?.total || 0,
                    tasa_cobranza: totalMontoCargos[0]?.total > 0 
                        ? ((totalMontoPagado[0]?.total || 0) / totalMontoCargos[0].total * 100).toFixed(1)
                        : 0
                },
                morosidad: {
                    cargos_vencidos: totalCargosVencidos,
                    monto_vencido: totalMontoVencido[0]?.total || 0,
                    residentes_morosos: residentesMorososCount
                },
                metodos_pago: metodosPago
            }
        });
    })
};