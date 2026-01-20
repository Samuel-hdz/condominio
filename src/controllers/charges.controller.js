import { Cargo } from '../models/cargo.model.js';
import { CargoDomicilio } from '../models/cargoDomicilio.model.js';
import { TipoCargo } from '../models/tipoCargo.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import { CalleTorre } from '../models/calleTorre.model.js';
import { Descuento } from '../models/descuento.model.js';
import { Residente } from '../models/residente.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';
import mongoose from 'mongoose';

export const chargesController = {
    /**
     * Crear nuevo cargo (mantenimiento, extraordinario, multa)
     */
    createCharge: catchAsync(async (req, res) => {
        const {
            tipo_cargo_id,
            nombre,
            descripcion,
            monto_base,
            fecha_cargo,
            fecha_vencimiento,
            periodicidad,
            aplica_a, // 'todos', 'domicilios', 'calles'
            domicilios_ids = [], // Si aplica_a = 'domicilios'
            calles_ids = [], // Si aplica_a = 'calles'
            descuentos = []
        } = req.body;

        // Validar tipo de cargo
        const tipoCargo = await TipoCargo.findById(tipo_cargo_id);
        if (!tipoCargo) {
            return res.status(404).json({
                success: false,
                message: 'Tipo de cargo no encontrado'
            });
        }

        // Crear el cargo principal
        const cargo = await Cargo.create({
            tipo_cargo_id,
            nombre,
            descripcion,
            monto_base: parseFloat(monto_base),
            monto_total: parseFloat(monto_base),
            fecha_cargo: new Date(fecha_cargo),
            fecha_vencimiento: new Date(fecha_vencimiento),
            periodicidad: tipoCargo.recurrente ? periodicidad : null,
            siguiente_generacion: this.calculateNextGenerationDate(
                periodicidad, 
                new Date(fecha_vencimiento)
            ),
            aplica_a,
            estatus: 'activo',
            usuario_creador_id: req.userId
        });

        // Obtener domicilios afectados según el tipo de aplicación
        let domiciliosAfectados = [];

        switch (aplica_a) {
            case 'todos':
                domiciliosAfectados = await Domicilio.find({ estatus: 'activo' });
                break;

            case 'domicilios':
                domiciliosAfectados = await Domicilio.find({
                    _id: { $in: domicilios_ids },
                    estatus: 'activo'
                });
                break;

            case 'calles':
                domiciliosAfectados = await Domicilio.find({
                    calle_torre_id: { $in: calles_ids },
                    estatus: 'activo'
                });
                break;

            default:
                return res.status(400).json({
                    success: false,
                    message: 'Tipo de aplicación no válido'
                });
        }

        // Crear CargoDomicilio para cada domicilio afectado
        const cargosDomicilio = [];
        const residentesNotificar = [];

        for (const domicilio of domiciliosAfectados) {
            const cargoDomicilio = await CargoDomicilio.create({
                cargo_id: cargo._id,
                domicilio_id: domicilio._id,
                monto: cargo.monto_total,
                monto_final: cargo.monto_total,
                saldo_pendiente: cargo.monto_total,
                estatus: 'pendiente'
            });

            cargosDomicilio.push(cargoDomicilio);

            // Aplicar descuentos si existen
            if (descuentos && descuentos.length > 0) {
                for (const desc of descuentos) {
                    await Descuento.create({
                        cargo_domicilio_id: cargoDomicilio._id,
                        tipo_descuento: desc.tipo_descuento,
                        nombre_descuento: desc.nombre_descuento,
                        valor: desc.valor,
                        motivo: desc.motivo,
                        usuario_aplicador_id: req.userId
                    });

                    // Recalcular monto final con descuentos
                    if (desc.tipo_descuento === 'porcentaje') {
                        cargoDomicilio.porcentaje_descuento += parseFloat(desc.valor);
                    } else {
                        cargoDomicilio.monto_descuento += parseFloat(desc.valor);
                    }
                }

                await cargoDomicilio.save();
            }

            // Obtener residentes para notificar
            const residentes = await Residente.find({
                domicilio_id: domicilio._id,
                estatus: 'activo'
            }).populate('user_id');

            residentesNotificar.push(...residentes);
        }

        // Notificar a todos los residentes afectados
        for (const residente of residentesNotificar) {
            await NotificationService.notifications.pagoPendiente(
                residente.user_id._id,
                {
                    concepto: nombre,
                    monto: cargo.monto_total,
                    fecha_vencimiento: fecha_vencimiento,
                    cargo_id: cargo._id
                }
            );
        }

        res.status(201).json({
            success: true,
            message: `Cargo creado exitosamente. Afecta a ${cargosDomicilio.length} domicilios.`,
            cargo: {
                id: cargo._id,
                nombre: cargo.nombre,
                tipo: tipoCargo.nombre,
                monto_total: cargo.monto_total,
                fecha_vencimiento: cargo.fecha_vencimiento,
                domicilios_afectados: cargosDomicilio.length,
                notificaciones_enviadas: residentesNotificar.length
            }
        });
    }),

    /**
     * Obtener todos los cargos (con filtros)
     */
    getAllCharges: catchAsync(async (req, res) => {
        const {
            page = 1,
            limit = 20,
            tipo_cargo_id,
            estatus,
            periodicidad,
            fecha_desde,
            fecha_hasta
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        const query = {};

        if (tipo_cargo_id) query.tipo_cargo_id = tipo_cargo_id;
        if (estatus) query.estatus = estatus;
        if (periodicidad) query.periodicidad = periodicidad;

        // Filtro por fecha
        if (fecha_desde || fecha_hasta) {
            query.fecha_cargo = {};
            if (fecha_desde) {
                query.fecha_cargo.$gte = new Date(fecha_desde);
            }
            if (fecha_hasta) {
                const fechaHasta = new Date(fecha_hasta);
                fechaHasta.setHours(23, 59, 59, 999);
                query.fecha_cargo.$lte = fechaHasta;
            }
        }

        // Obtener cargos
        const [cargos, total] = await Promise.all([
            Cargo.find(query)
                .populate('tipo_cargo_id', 'nombre tipo')
                .populate('usuario_creador_id', 'nombre apellido')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Cargo.countDocuments(query)
        ]);

        // Para cada cargo, obtener estadísticas
        const cargosDetallados = await Promise.all(
            cargos.map(async (cargo) => {
                const estadisticas = await CargoDomicilio.aggregate([
                    { $match: { cargo_id: cargo._id } },
                    {
                        $group: {
                            _id: '$estatus',
                            count: { $sum: 1 },
                            totalMonto: { $sum: '$monto_final' },
                            totalSaldo: { $sum: '$saldo_pendiente' }
                        }
                    }
                ]);

                // Transformar estadísticas
                const stats = {};
                estadisticas.forEach(stat => {
                    stats[stat._id] = {
                        count: stat.count,
                        totalMonto: stat.totalMonto,
                        totalSaldo: stat.totalSaldo
                    };
                });

                return {
                    ...cargo.toObject(),
                    estadisticas: stats
                };
            })
        );

        res.json({
            success: true,
            cargos: cargosDetallados,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener cargo por ID con detalles
     */
    getChargeById: catchAsync(async (req, res) => {
        const { id } = req.params;

        const cargo = await Cargo.findById(id)
            .populate('tipo_cargo_id', 'nombre tipo descripcion')
            .populate('usuario_creador_id', 'nombre apellido email');

        if (!cargo) {
            return res.status(404).json({
                success: false,
                message: 'Cargo no encontrado'
            });
        }

        // Obtener domicilios afectados
        const cargosDomicilio = await CargoDomicilio.find({ cargo_id: id })
            .populate('domicilio_id')
            .populate({
                path: 'domicilio_id',
                populate: {
                    path: 'calle_torre_id',
                    select: 'nombre tipo'
                }
            });

        // Obtener estadísticas
        const estadisticas = await CargoDomicilio.aggregate([
            { $match: { cargo_id: new mongoose.Types.ObjectId(id) } },
            {
                $group: {
                    _id: null,
                    totalDomicilios: { $sum: 1 },
                    totalMonto: { $sum: '$monto_final' },
                    totalPagado: { 
                        $sum: { 
                            $subtract: ['$monto_final', '$saldo_pendiente'] 
                        } 
                    },
                    totalPendiente: { $sum: '$saldo_pendiente' }
                }
            }
        ]);

        // Obtener descuentos aplicados
        const descuentos = await Descuento.find({
            cargo_domicilio_id: { 
                $in: cargosDomicilio.map(cd => cd._id) 
            }
        }).populate('usuario_aplicador_id', 'nombre apellido');

        res.json({
            success: true,
            cargo: {
                ...cargo.toObject(),
                domicilios_afectados: cargosDomicilio.map(cd => ({
                    domicilio: cd.domicilio_id,
                    monto_final: cd.monto_final,
                    saldo_pendiente: cd.saldo_pendiente,
                    estatus: cd.estatus
                })),
                estadisticas: estadisticas[0] || {
                    totalDomicilios: 0,
                    totalMonto: 0,
                    totalPagado: 0,
                    totalPendiente: 0
                },
                descuentos_aplicados: descuentos
            }
        });
    }),

    /**
     * Actualizar cargo
     */
    updateCharge: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { nombre, descripcion, monto_base, fecha_vencimiento, estatus } = req.body;

        const cargo = await Cargo.findById(id);
        if (!cargo) {
            return res.status(404).json({
                success: false,
                message: 'Cargo no encontrado'
            });
        }

        // Verificar si se puede modificar (solo si no hay pagos aplicados)
        if (cargo.estatus === 'cancelado') {
            return res.status(400).json({
                success: false,
                message: 'No se puede modificar un cargo cancelado'
            });
        }

        // Actualizar campos
        const updates = {};
        if (nombre) updates.nombre = nombre;
        if (descripcion !== undefined) updates.descripcion = descripcion;
        if (monto_base) {
            updates.monto_base = parseFloat(monto_base);
            updates.monto_total = parseFloat(monto_base);
        }
        if (fecha_vencimiento) updates.fecha_vencimiento = new Date(fecha_vencimiento);
        if (estatus) updates.estatus = estatus;

        const cargoActualizado = await Cargo.findByIdAndUpdate(id, updates, { new: true });

        // Si se cambió el monto, actualizar todos los CargoDomicilio relacionados
        if (monto_base) {
            await CargoDomicilio.updateMany(
                { cargo_id: id },
                { 
                    $set: { 
                        monto: parseFloat(monto_base),
                        monto_final: parseFloat(monto_base)
                    } 
                }
            );
        }

        res.json({
            success: true,
            message: 'Cargo actualizado exitosamente',
            cargo: cargoActualizado
        });
    }),

    /**
     * Duplicar cargo existente
     */
    duplicateCharge: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { nueva_fecha_cargo, nueva_fecha_vencimiento } = req.body;

        const cargoOriginal = await Cargo.findById(id)
            .populate('tipo_cargo_id');

        if (!cargoOriginal) {
            return res.status(404).json({
                success: false,
                message: 'Cargo no encontrado'
            });
        }

        // Crear nuevo cargo basado en el original
        const nuevoCargo = await Cargo.create({
            tipo_cargo_id: cargoOriginal.tipo_cargo_id._id,
            nombre: `${cargoOriginal.nombre} (Copia)`,
            descripcion: cargoOriginal.descripcion,
            monto_base: cargoOriginal.monto_base,
            monto_total: cargoOriginal.monto_total,
            fecha_cargo: nueva_fecha_cargo ? new Date(nueva_fecha_cargo) : new Date(),
            fecha_vencimiento: nueva_fecha_vencimiento ? 
                new Date(nueva_fecha_vencimiento) : 
                this.addMonths(new Date(), 1),
            periodicidad: cargoOriginal.periodicidad,
            siguiente_generacion: cargoOriginal.siguiente_generacion ?
                this.addPeriod(cargoOriginal.siguiente_generacion, cargoOriginal.periodicidad) :
                null,
            aplica_a: cargoOriginal.aplica_a,
            estatus: 'activo',
            usuario_creador_id: req.userId
        });

        // Duplicar CargoDomicilio del cargo original
        const cargosDomicilioOriginal = await CargoDomicilio.find({ cargo_id: id });
        
        for (const cdOriginal of cargosDomicilioOriginal) {
            await CargoDomicilio.create({
                cargo_id: nuevoCargo._id,
                domicilio_id: cdOriginal.domicilio_id,
                monto: cdOriginal.monto,
                monto_descuento: cdOriginal.monto_descuento,
                porcentaje_descuento: cdOriginal.porcentaje_descuento,
                monto_final: cdOriginal.monto_final,
                saldo_pendiente: cdOriginal.monto_final,
                estatus: 'pendiente'
            });
        }

        // Notificar a los residentes afectados
        const cargosDomicilio = await CargoDomicilio.find({ cargo_id: nuevoCargo._id })
            .populate({
                path: 'domicilio_id',
                populate: {
                    path: 'residentes',
                    match: { estatus: 'activo' },
                    populate: 'user_id'
                }
            });

        let residentesNotificados = 0;
        for (const cd of cargosDomicilio) {
            if (cd.domicilio_id.residentes && cd.domicilio_id.residentes.length > 0) {
                for (const residente of cd.domicilio_id.residentes) {
                    await NotificationService.sendNotification({
                        userId: residente.user_id._id,
                        tipo: 'push',
                        titulo: '💰 Nuevo cargo duplicado',
                        mensaje: `Se ha duplicado el cargo "${nuevoCargo.nombre}"`,
                        data: {
                            tipo: 'cargo',
                            action: 'duplicated',
                            cargo_id: nuevoCargo._id,
                            monto: nuevoCargo.monto_total
                        }
                    });
                    residentesNotificados++;
                }
            }
        }

        res.status(201).json({
            success: true,
            message: 'Cargo duplicado exitosamente',
            cargo: {
                id: nuevoCargo._id,
                nombre: nuevoCargo.nombre,
                tipo: cargoOriginal.tipo_cargo_id.nombre,
                monto_total: nuevoCargo.monto_total,
                fecha_vencimiento: nuevoCargo.fecha_vencimiento,
                notificaciones_enviadas: residentesNotificados
            }
        });
    }),

    /**
     * Notificar cargo a residentes afectados
     */
    notifyCharge: catchAsync(async (req, res) => {
        const { id } = req.params;

        const cargo = await Cargo.findById(id);
        if (!cargo) {
            return res.status(404).json({
                success: false,
                message: 'Cargo no encontrado'
            });
        }

        // Obtener todos los domicilios afectados por este cargo
        const cargosDomicilio = await CargoDomicilio.find({ cargo_id: id })
            .populate({
                path: 'domicilio_id',
                populate: {
                    path: 'residentes',
                    match: { estatus: 'activo' },
                    populate: 'user_id'
                }
            });

        let residentesNotificados = 0;
        const resultados = [];

        for (const cd of cargosDomicilio) {
            if (cd.domicilio_id.residentes && cd.domicilio_id.residentes.length > 0) {
                for (const residente of cd.domicilio_id.residentes) {
                    try {
                        await NotificationService.notifications.pagoPendiente(
                            residente.user_id._id,
                            {
                                concepto: cargo.nombre,
                                monto: cd.monto_final,
                                fecha_vencimiento: cargo.fecha_vencimiento,
                                cargo_id: cargo._id,
                                saldo_pendiente: cd.saldo_pendiente
                            }
                        );
                        
                        resultados.push({
                            residente_id: residente._id,
                            nombre: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                            email: residente.user_id.email,
                            notificado: true
                        });
                        
                        residentesNotificados++;
                    } catch (error) {
                        resultados.push({
                            residente_id: residente._id,
                            nombre: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                            email: residente.user_id.email,
                            notificado: false,
                            error: error.message
                        });
                    }
                }
            }
        }

        res.json({
            success: true,
            message: `Notificaciones enviadas a ${residentesNotificados} residentes`,
            total_notificados: residentesNotificados,
            resultados: resultados
        });
    }),

    /**
     * Eliminar cargo (solo si no tiene pagos aplicados)
     */
    deleteCharge: catchAsync(async (req, res) => {
        const { id } = req.params;

        const cargo = await Cargo.findById(id);
        if (!cargo) {
            return res.status(404).json({
                success: false,
                message: 'Cargo no encontrado'
            });
        }

        // Verificar si el cargo tiene pagos aplicados
        const cargosConPagos = await CargoDomicilio.findOne({
            cargo_id: id,
            saldo_pendiente: { $lt: '$monto_final' } // Tiene pagos aplicados
        });

        if (cargosConPagos) {
            return res.status(400).json({
                success: false,
                message: 'No se puede eliminar un cargo que ya tiene pagos aplicados'
            });
        }

        // Cambiar estatus a cancelado en lugar de eliminar físicamente
        cargo.estatus = 'cancelado';
        await cargo.save();

        // Cambiar estatus de los CargoDomicilio relacionados
        await CargoDomicilio.updateMany(
            { cargo_id: id },
            { $set: { estatus: 'cancelado' } }
        );

        res.json({
            success: true,
            message: 'Cargo cancelado exitosamente',
            cargo: {
                id: cargo._id,
                nombre: cargo.nombre,
                estatus: cargo.estatus
            }
        });
    }),

    /**
     * Helper: Calcular fecha de siguiente generación
     */
    calculateNextGenerationDate(periodicidad, baseDate) {
        if (!periodicidad) return null;

        const date = new Date(baseDate);
        
        switch (periodicidad) {
            case 'semanal':
                date.setDate(date.getDate() + 7);
                break;
            case 'quincenal':
                date.setDate(date.getDate() + 15);
                break;
            case 'mensual':
                date.setMonth(date.getMonth() + 1);
                break;
            case 'bimestral':
                date.setMonth(date.getMonth() + 2);
                break;
            case 'trimestral':
                date.setMonth(date.getMonth() + 3);
                break;
            case 'semestral':
                date.setMonth(date.getMonth() + 6);
                break;
            case 'anual':
                date.setFullYear(date.getFullYear() + 1);
                break;
            default:
                return null;
        }
        
        return date;
    },

    /**
     * Helper: Añadir período a una fecha
     */
    addPeriod(date, periodicidad) {
        return this.calculateNextGenerationDate(periodicidad, date);
    },

    /**
     * Helper: Añadir meses a una fecha
     */
    addMonths(date, months) {
        const newDate = new Date(date);
        newDate.setMonth(newDate.getMonth() + months);
        return newDate;
    }
};