import { ComprobantePago } from '../models/comprobantePago.model.js';
import { PagoAplicado } from '../models/pagoAplicado.model.js';
import { CargoDomicilio } from '../models/cargoDomicilio.model.js';
import { Residente } from '../models/residente.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import { User } from '../models/user.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

export const comprobantesController = {
    /**
     * Obtener comprobantes pendientes de revisión
     */
    getPendingComprobantes: catchAsync(async (req, res) => {
        const { 
            page = 1, 
            limit = 20,
            residente_id,
            tipo_cargo,
            fecha_desde,
            fecha_hasta
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        const query = { estatus: 'pendiente' };

        if (residente_id) query.residente_id = residente_id;
        if (tipo_cargo) query.tipo_cargo = tipo_cargo;

        // Filtro por fecha
        if (fecha_desde || fecha_hasta) {
            query.fecha_pago = {};
            if (fecha_desde) {
                query.fecha_pago.$gte = new Date(fecha_desde);
            }
            if (fecha_hasta) {
                const fechaHasta = new Date(fecha_hasta);
                fechaHasta.setHours(23, 59, 59, 999);
                query.fecha_pago.$lte = fechaHasta;
            }
        }

        // Obtener comprobantes
        const [comprobantes, total] = await Promise.all([
            ComprobantePago.find(query)
                .populate('residente_id')
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'user_id',
                        select: 'nombre apellido email'
                    }
                })
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'domicilio_id',
                        select: 'calle_torre_id numero',
                        populate: {
                            path: 'calle_torre_id',
                            select: 'nombre tipo'
                        }
                    }
                })
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            ComprobantePago.countDocuments(query)
        ]);

        res.json({
            success: true,
            comprobantes,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener detalle completo de un comprobante
     */
    getComprobanteDetail: catchAsync(async (req, res) => {
        const { id } = req.params;

        const comprobante = await ComprobantePago.findById(id)
            .populate('residente_id')
            .populate({
                path: 'residente_id',
                populate: [
                    {
                        path: 'user_id',
                        select: 'nombre apellido email telefono'
                    },
                    {
                        path: 'domicilio_id',
                        select: 'calle_torre_id numero',
                        populate: {
                            path: 'calle_torre_id',
                            select: 'nombre tipo'
                        }
                    }
                ]
            })
            .populate('usuario_aprobador_id', 'nombre apellido');

        if (!comprobante) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado'
            });
        }

        // Obtener pagos aplicados a este comprobante
        const pagosAplicados = await PagoAplicado.find({ 
            comprobante_id: comprobante._id 
        }).populate('cargo_domicilio_id');

        // Obtener cargos pendientes del residente para posible asignación
        const cargosPendientes = await CargoDomicilio.find({
            domicilio_id: comprobante.residente_id.domicilio_id._id,
            saldo_pendiente: { $gt: 0 },
            estatus: { $in: ['pendiente', 'vencido'] }
        })
        .populate('cargo_id', 'nombre descripcion fecha_vencimiento')
        .populate({
            path: 'cargo_id',
            populate: {
                path: 'tipo_cargo_id',
                select: 'nombre tipo'
            }
        });

        res.json({
            success: true,
            comprobante: {
                ...comprobante.toObject(),
                pagos_aplicados: pagosAplicados,
                cargos_disponibles: cargosPendientes.map(cargo => ({
                    id: cargo._id,
                    cargo_id: cargo.cargo_id._id,
                    nombre: cargo.cargo_id.nombre,
                    tipo: cargo.cargo_id.tipo_cargo_id.tipo,
                    fecha_vencimiento: cargo.cargo_id.fecha_vencimiento,
                    saldo_pendiente: cargo.saldo_pendiente,
                    monto_final: cargo.monto_final
                })),
                saldo_disponible: comprobante.monto_total - 
                    pagosAplicados.reduce((sum, pa) => sum + pa.monto_aplicado, 0)
            }
        });
    }),

    /**
     * Aprobar comprobante de pago
     */
    approveComprobante: catchAsync(async (req, res) => {
    const { id } = req.params;
    const { comentarios } = req.body || {};

    const comprobante = await ComprobantePago.findById(id)
        .populate('cargo_domicilio_id')
        .populate('residente_id');
    
    if (!comprobante) {
        return res.status(404).json({
            success: false,
            message: 'Comprobante no encontrado'
        });
    }

    if (comprobante.estatus !== 'pendiente') {
        return res.status(400).json({
            success: false,
            message: `El comprobante ya ha sido ${comprobante.estatus}`
        });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const cargoDomicilio = comprobante.cargo_domicilio_id;
        const montoPago = comprobante.monto_total;

        // Verificar que el saldo pendiente aún sea suficiente
        if (montoPago > cargoDomicilio.saldo_pendiente) {
            throw new Error(`El pago excede el saldo pendiente del cargo. Saldo actual: ${cargoDomicilio.saldo_pendiente}`);
        }

        // Crear pago aplicado automáticamente
        const pagoAplicado = await PagoAplicado.create([{
            comprobante_id: comprobante._id,
            cargo_domicilio_id: cargoDomicilio._id,
            monto_aplicado: montoPago,
            tipo_asignacion: 'automatica',
            usuario_asignador_id: req.userId
        }], { session });

        // Actualizar cargo domicilio
        cargoDomicilio.saldo_pendiente -= montoPago;
        if (cargoDomicilio.saldo_pendiente <= 0) {
            cargoDomicilio.estatus = 'pagado';
            cargoDomicilio.fecha_pago = new Date();
        }
        await cargoDomicilio.save({ session });

        // Actualizar comprobante
        comprobante.estatus = 'aprobado';
        comprobante.fecha_aprobacion = new Date();
        comprobante.usuario_aprobador_id = req.userId;
        comprobante.observaciones = comentarios || comprobante.observaciones;
        
        // Generar comprobante final
        comprobante.comprobante_final_url = comprobantesController.generateComprobanteFinal(comprobante, [pagoAplicado[0]]);
        await comprobante.save({ session });

        await session.commitTransaction();

        // Notificaciones... (igual que antes)

        res.json({
            success: true,
            message: 'Comprobante aprobado exitosamente',
            comprobante: {
                id: comprobante._id,
                folio: comprobante.folio,
                estatus: comprobante.estatus,
                monto_total: comprobante.monto_total,
                cargo_afectado: cargoDomicilio.cargo_id
            }
        });

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}),

    /**
     * Rechazar comprobante de pago
     */
    rejectComprobante: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { motivo_rechazo } = req.body;

        if (!motivo_rechazo || motivo_rechazo.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un motivo para rechazar el comprobante'
            });
        }

        const comprobante = await ComprobantePago.findById(id);
        if (!comprobante) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado'
            });
        }

        if (comprobante.estatus !== 'pendiente') {
            return res.status(400).json({
                success: false,
                message: `El comprobante ya ha sido ${comprobante.estatus}`
            });
        }

        // Actualizar comprobante
        comprobante.estatus = 'rechazado';
        comprobante.motivo_rechazo = motivo_rechazo;
        comprobante.fecha_aprobacion = new Date();
        comprobante.usuario_aprobador_id = req.userId;
        
        await comprobante.save();

        // Notificar al residente
        const residente = await Residente.findById(comprobante.residente_id)
            .populate('user_id');
        
        await NotificationService.sendNotification({
            userId: residente.user_id._id,
            tipo: 'push',
            titulo: '❌ Comprobante rechazado',
            mensaje: `Tu comprobante de pago ha sido rechazado: ${motivo_rechazo}`,
            data: {
                tipo: 'comprobante',
                action: 'rejected',
                comprobante_id: comprobante._id,
                motivo: motivo_rechazo,
                monto: comprobante.monto_total
            },
            accionRequerida: true,
            accionTipo: 'ver_comprobante',
            accionData: { comprobanteId: comprobante._id }
        });

        // Notificar a administradores
        const admins = await User.find({ role: 'administrador', _id: { $ne: req.userId } });
        for (const admin of admins) {
            await NotificationService.sendNotification({
                userId: admin._id,
                tipo: 'in_app',
                titulo: '❌ Comprobante rechazado',
                mensaje: `${req.user.nombre} rechazó un comprobante`,
                data: {
                    tipo: 'comprobante',
                    action: 'rejected',
                    comprobante_id: comprobante._id,
                    motivo: motivo_rechazo
                }
            });
        }

        res.json({
            success: true,
            message: 'Comprobante rechazado exitosamente',
            comprobante: {
                id: comprobante._id,
                folio: comprobante.folio,
                estatus: comprobante.estatus,
                motivo_rechazo: comprobante.motivo_rechazo
            }
        });
    }),

    /**
     * Obtener comprobantes por estatus
     */
    getComprobantesByStatus: catchAsync(async (req, res) => {
        const { estatus } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const skip = (page - 1) * limit;

        // Validar estatus
        const estatusValidos = ['pendiente', 'aprobado', 'rechazado'];
        if (!estatusValidos.includes(estatus)) {
            return res.status(400).json({
                success: false,
                message: 'Estatus no válido'
            });
        }

        const [comprobantes, total] = await Promise.all([
            ComprobantePago.find({ estatus })
                .populate({
                    path: 'residente_id',
                    populate: [
                        {
                            path: 'user_id',
                            select: 'nombre apellido email'
                        },
                        {
                            path: 'domicilio_id',
                            select: 'calle_torre_id numero',
                            populate: {
                                path: 'calle_torre_id',
                                select: 'nombre tipo'
                            }
                        }
                    ]
                })
                .populate('usuario_aprobador_id', 'nombre apellido')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            ComprobantePago.countDocuments({ estatus })
        ]);

        res.json({
            success: true,
            comprobantes,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Generar comprobante final del fraccionamiento (simulación)
     */
    generateComprobanteFinal(comprobante, pagosAplicados) {
        // En producción, aquí generarías un PDF real
        // Por ahora, simulamos la generación
        
        const folioFinal = `REC-${Utils.generateFolio('REC')}`;
        const rutaSimulada = `/uploads/comprobantes-finales/${folioFinal}.pdf`;
        
        // En producción, usarías una librería como pdfkit o puppeteer
        // para generar un PDF con la información del comprobante
        
        console.log(`📄 Generando comprobante final: ${folioFinal}`);
        console.log(`   Monto: ${comprobante.monto_total}`);
        console.log(`   Pagos aplicados: ${pagosAplicados.length}`);
        
        return rutaSimulada;
    },

    /**
     * Obtener estadísticas de comprobantes
     */
    getComprobantesStats: catchAsync(async (req, res) => {
        const { fecha_desde, fecha_hasta } = req.query;

        const matchStage = {};
        
        if (fecha_desde || fecha_hasta) {
            matchStage.fecha_pago = {};
            if (fecha_desde) {
                matchStage.fecha_pago.$gte = new Date(fecha_desde);
            }
            if (fecha_hasta) {
                const fechaHasta = new Date(fecha_hasta);
                fechaHasta.setHours(23, 59, 59, 999);
                matchStage.fecha_pago.$lte = fechaHasta;
            }
        }

        const stats = await ComprobantePago.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$estatus',
                    count: { $sum: 1 },
                    totalMonto: { $sum: '$monto_total' },
                    avgMonto: { $avg: '$monto_total' }
                }
            }
        ]);

        // Estadísticas por tipo de cargo
        const statsTipoCargo = await ComprobantePago.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$tipo_cargo',
                    count: { $sum: 1 },
                    totalMonto: { $sum: '$monto_total' }
                }
            },
            { $sort: { totalMonto: -1 } }
        ]);

        // Métodos de pago más usados
        const statsMetodoPago = await ComprobantePago.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$metodo_pago',
                    count: { $sum: 1 },
                    totalMonto: { $sum: '$monto_total' }
                }
            },
            { $sort: { totalMonto: -1 } }
        ]);

        res.json({
            success: true,
            estadisticas: {
                por_estatus: stats,
                por_tipo_cargo: statsTipoCargo,
                por_metodo_pago: statsMetodoPago,
                periodo: {
                    desde: fecha_desde || 'todo',
                    hasta: fecha_hasta || 'todo'
                }
            }
        });
    })
};