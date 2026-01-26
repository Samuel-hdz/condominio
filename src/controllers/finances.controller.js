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
        cargo_domicilio_id,  // ← NUEVO: ID del cargo específico
        monto_total,
        fecha_pago,
        metodo_pago,
        institucion_bancaria,
        numero_referencia,
        cuenta_destino,
        observaciones
    } = req.body;

    // 1. Validar que el cargo existe y pertenece al residente
    const cargoDomicilio = await CargoDomicilio.findById(cargo_domicilio_id)
        .populate({
            path: 'cargo_id',
            populate: { path: 'tipo_cargo_id' }
        })
        .populate('domicilio_id');
    
    if (!cargoDomicilio) {
        return res.status(404).json({
            success: false,
            message: 'Cargo no encontrado'
        });
    }

    // 2. Verificar que el residente es dueño de este cargo
    const residente = await Residente.findById(residenteId)
        .populate('domicilio_id');
    
    if (!cargoDomicilio.domicilio_id._id.equals(residente.domicilio_id._id)) {
        return res.status(403).json({
            success: false,
            message: 'No tienes permisos para pagar este cargo'
        });
    }

    // 3. Verificar que el cargo no esté ya pagado
    if (cargoDomicilio.estatus === 'pagado') {
        return res.status(400).json({
            success: false,
            message: 'Este cargo ya ha sido pagado'
        });
    }

    // 4. Verificar que el monto coincida (con tolerancia)
    const montoEsperado = cargoDomicilio.saldo_pendiente;
    const diferencia = Math.abs(parseFloat(monto_total) - montoEsperado);
    
    if (diferencia > 1.0) { // Tolerancia de $1.00
        return res.status(400).json({
            success: false,
            message: `El monto debe coincidir con el saldo pendiente: ${Utils.formatCurrency(montoEsperado)}`
        });
    }

    // 5. Crear comprobante
    const comprobante = await ComprobantePago.create({
        residente_id: residenteId,
        cargo_domicilio_id: cargo_domicilio_id,  // ← Asociación directa
        monto_total: parseFloat(monto_total),
        fecha_pago: new Date(fecha_pago),
        metodo_pago,
        institucion_bancaria,
        numero_referencia,
        cuenta_destino,
        comprobante_url: req.file.path,
        observaciones,
        estatus: 'pendiente'
    });

    // 6. Notificar administradores (igual que antes)
    // ... código existente ...

    res.status(201).json({
        success: true,
        message: 'Comprobante subido exitosamente.',
        comprobante: {
            id: comprobante._id,
            folio: comprobante.folio,
            cargo: cargoDomicilio.cargo_id.nombre,
            monto: comprobante.monto_total,
            saldo_pendiente: montoEsperado,
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
    const residente = await Residente.findById(residenteId);
    
    const cargosPendientes = await CargoDomicilio.find({
        domicilio_id: residente.domicilio_id._id,
        estatus: { $in: ['pendiente', 'vencido'] },
        saldo_pendiente: { $gt: 0 },
        
        // EXCLUIR cargos que ya tienen comprobantes pendientes
        _id: { 
            $nin: await ComprobantePago.distinct('cargo_domicilio_id', {
                residente_id: residenteId,
                estatus: 'pendiente'
            })
        }
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

    res.json({
        success: true,
        cargos: cargosPendientes.map(cargo => ({
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
        }))
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