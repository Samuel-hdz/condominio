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
            
            // ✅ AHORA EL ADMIN DECIDE:
            recurrente = false,        // true/false - Admin elige
            periodicidad = null,       // Solo si recurrente=true - Admin elige
            
            aplica_a = 'todos',        // 'todos', 'domicilios', 'calles'
            domicilios_ids = [],       // Si aplica_a = 'domicilios'
            calles_ids = [],           // Si aplica_a = 'calles'
            descuentos = [],           // Array de descuentos opcionales
            
            // ✅ NUEVO: Notas internas para auditoría
            notas_internas = ''
        } = req.body;

        console.log('📝 Creando nuevo cargo:', {
            nombre,
            tipo_cargo_id,
            recurrente,
            periodicidad,
            aplica_a
        });

        // ============================================
        // 1. VALIDACIONES BÁSICAS
        // ============================================

        // Validar tipo de cargo
        const tipoCargo = await TipoCargo.findById(tipo_cargo_id);
        if (!tipoCargo) {
            return res.status(404).json({
                success: false,
                message: 'Tipo de cargo no encontrado'
            });
        }

        // Validar que si es recurrente, tenga periodicidad
        if (recurrente && !periodicidad) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar la periodicidad para cargos recurrentes'
            });
        }

        // Validar periodicidad si es recurrente
        if (recurrente && periodicidad) {
            const periodicidadesValidas = ['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'];
            if (!periodicidadesValidas.includes(periodicidad)) {
                return res.status(400).json({
                    success: false,
                    message: `Periodicidad no válida. Use: ${periodicidadesValidas.join(', ')}`
                });
            }
        }

        // Validar fechas
        const fechaCargoDate = new Date(fecha_cargo);
        const fechaVencimientoDate = new Date(fecha_vencimiento);
        
        if (fechaVencimientoDate <= fechaCargoDate) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de vencimiento debe ser posterior a la fecha de cargo'
            });
        }

        // Validar monto
        if (parseFloat(monto_base) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'El monto debe ser mayor a 0'
            });
        }

        // ============================================
        // 2. CALCULAR FECHAS PARA RECURRENTES
        // ============================================

        let siguienteGeneracion = null;
        
        if (recurrente && periodicidad) {
            siguienteGeneracion = chargesController.calculateNextGenerationDate(
                fechaVencimientoDate,
                periodicidad
            );
            
            console.log('📅 Fechas recurrentes calculadas:', {
                fecha_vencimiento: fechaVencimientoDate,
                periodicidad,
                siguiente_generacion: siguienteGeneracion
            });
        }

        // ============================================
        // 3. CREAR CARGO PRINCIPAL (TRANSACCIÓN)
        // ============================================

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Crear el cargo principal
            const cargo = await Cargo.create([{
                tipo_cargo_id,
                nombre: nombre.trim(),
                descripcion: descripcion ? descripcion.trim() : '',
                monto_base: parseFloat(monto_base),
                monto_total: parseFloat(monto_base), // Inicialmente igual al base
                fecha_cargo: fechaCargoDate,
                fecha_vencimiento: fechaVencimientoDate,
                
                // ✅ CONFIGURACIÓN DEL ADMIN:
                periodicidad: recurrente ? periodicidad : null,
                siguiente_generacion: siguienteGeneracion,
                
                aplica_a,
                estatus: 'activo',
                usuario_creador_id: req.userId,
                
                // ✅ NUEVO: Guardar configuración para auditoría
                configuracion_admin: {
                    decidio_recurrente: recurrente,
                    decidio_periodicidad: periodicidad,
                    notas: notas_internas
                }
            }], { session });

            console.log('✅ Cargo principal creado:', cargo[0]._id);

            // ============================================
            // 4. OBTENER DOMICILIOS AFECTADOS
            // ============================================

            let domiciliosAfectados = [];

            switch (aplica_a) {
                case 'todos':
                    domiciliosAfectados = await Domicilio.find({ estatus: 'activo' }).session(session);
                    console.log(`🏠 Aplica a TODOS: ${domiciliosAfectados.length} domicilios activos`);
                    break;

                case 'domicilios':
                    if (!domicilios_ids || domicilios_ids.length === 0) {
                        throw new Error('Debe especificar al menos un domicilio');
                    }
                    
                    domiciliosAfectados = await Domicilio.find({
                        _id: { $in: domicilios_ids },
                        estatus: 'activo'
                    }).session(session);
                    
                    console.log(`🏠 Aplica a DOMICILIOS ESPECÍFICOS: ${domiciliosAfectados.length} de ${domicilios_ids.length} solicitados`);
                    break;

                case 'calles':
                    if (!calles_ids || calles_ids.length === 0) {
                        throw new Error('Debe especificar al menos una calle/torre');
                    }
                    
                    domiciliosAfectados = await Domicilio.find({
                        calle_torre_id: { $in: calles_ids },
                        estatus: 'activo'
                    }).session(session);
                    
                    console.log(`🏠 Aplica a CALLES/TORRES: ${domiciliosAfectados.length} domicilios en ${calles_ids.length} calles`);
                    break;

                default:
                    throw new Error('Tipo de aplicación no válido');
            }

            if (domiciliosAfectados.length === 0) {
                throw new Error('No se encontraron domicilios para aplicar el cargo');
            }

            // ============================================
            // 5. CREAR CARGOS POR DOMICILIO
            // ============================================

            const cargosDomicilioCreados = [];
            const residentesNotificar = [];

            for (const domicilio of domiciliosAfectados) {
                // Crear CargoDomicilio
                const cargoDomicilio = await CargoDomicilio.create([{
                    cargo_id: cargo[0]._id,
                    domicilio_id: domicilio._id,
                    monto: parseFloat(monto_base),
                    monto_final: parseFloat(monto_base), // Inicialmente igual
                    saldo_pendiente: parseFloat(monto_base),
                    estatus: 'pendiente'
                }], { session });

                cargosDomicilioCreados.push(cargoDomicilio[0]);

                // ============================================
                // 6. APLICAR DESCUENTOS SI EXISTEN
                // ============================================

                if (descuentos && descuentos.length > 0) {
                    console.log(`💰 Aplicando ${descuentos.length} descuentos al domicilio ${domicilio._id}`);
                    
                    let montoDescuentoTotal = 0;
                    let porcentajeDescuentoTotal = 0;

                    for (const desc of descuentos) {
                        // Validar descuento
                        if (!['monto_fijo', 'porcentaje'].includes(desc.tipo_descuento)) {
                            console.warn(`Tipo de descuento inválido: ${desc.tipo_descuento}`);
                            continue;
                        }

                        // Crear registro de descuento
                        await Descuento.create([{
                            cargo_domicilio_id: cargoDomicilio[0]._id,
                            tipo_descuento: desc.tipo_descuento,
                            nombre_descuento: desc.nombre_descuento || 'Descuento',
                            valor: parseFloat(desc.valor),
                            motivo: desc.motivo || '',
                            usuario_aplicador_id: req.userId
                        }], { session });

                        // Acumular descuentos para calcular
                        if (desc.tipo_descuento === 'porcentaje') {
                            porcentajeDescuentoTotal += parseFloat(desc.valor);
                        } else {
                            montoDescuentoTotal += parseFloat(desc.valor);
                        }
                    }

                    // Calcular monto final con descuentos
                    let montoFinal = parseFloat(monto_base);
                    
                    if (porcentajeDescuentoTotal > 0) {
                        const descuentoPorcentaje = (montoFinal * porcentajeDescuentoTotal) / 100;
                        montoFinal -= descuentoPorcentaje;
                    }
                    
                    if (montoDescuentoTotal > 0) {
                        montoFinal -= montoDescuentoTotal;
                    }
                    
                    // Asegurar que no sea negativo
                    montoFinal = Math.max(0, montoFinal);

                    // Actualizar CargoDomicilio con descuentos aplicados
                    cargoDomicilio[0].porcentaje_descuento = porcentajeDescuentoTotal;
                    cargoDomicilio[0].monto_descuento = montoDescuentoTotal;
                    cargoDomicilio[0].monto_final = montoFinal;
                    cargoDomicilio[0].saldo_pendiente = montoFinal;
                    
                    await cargoDomicilio[0].save({ session });

                    console.log(`💰 Descuentos aplicados: ${porcentajeDescuentoTotal}% + $${montoDescuentoTotal} = $${montoFinal} final`);
                }

                // ============================================
                // 7. PREPARAR RESIDENTES PARA NOTIFICAR
                // ============================================

                const residentes = await Residente.find({
                    domicilio_id: domicilio._id,
                    estatus: 'activo'
                }).populate('user_id').session(session);

                if (residentes.length > 0) {
                    residentesNotificar.push(...residentes);
                    console.log(`👤 ${residentes.length} residentes en domicilio ${domicilio.numero}`);
                }
            }

            // ============================================
            // 8. ACTUALIZAR MONTO TOTAL DEL CARGO PRINCIPAL
            // ============================================

            // Si hay descuentos, actualizar monto_total del cargo principal
            // (normalmente sería el promedio o algo similar, pero simplificamos)
            if (descuentos && descuentos.length > 0) {
                // Calcular promedio de montos finales
                const promedioMontoFinal = cargosDomicilioCreados.reduce((sum, cd) => sum + cd.monto_final, 0) / cargosDomicilioCreados.length;
                cargo[0].monto_total = Math.round(promedioMontoFinal * 100) / 100; // Redondear a 2 decimales
                await cargo[0].save({ session });
                
                console.log(`📊 Monto total actualizado: $${cargo[0].monto_total} (promedio con descuentos)`);
            }

            // ============================================
            // 9. CONFIRMAR TRANSACCIÓN
            // ============================================

            await session.commitTransaction();
            console.log('✅ Transacción completada exitosamente');

            // ============================================
            // 10. ENVIAR NOTIFICACIONES (FUERA DE TRANSACCIÓN)
            // ============================================

            let notificacionesEnviadas = 0;
            
            if (residentesNotificar.length > 0) {
                console.log(`📨 Enviando notificaciones a ${residentesNotificar.length} residentes...`);
                
                for (const residente of residentesNotificar) {
                    try {
                        // Buscar el cargoDomicilio específico de este residente
                        const cargoDomicilioResidente = cargosDomicilioCreados.find(
                            cd => cd.domicilio_id.toString() === residente.domicilio_id.toString()
                        );
                        
                        if (!cargoDomicilioResidente) continue;

                        await NotificationService.notifications.pagoPendiente(
                            residente.user_id._id,
                            {
                                concepto: nombre,
                                monto: cargoDomicilioResidente.monto_final,
                                fecha_vencimiento: fechaVencimientoDate,
                                cargo_id: cargo[0]._id,
                                domicilio_id: residente.domicilio_id,
                                es_recurrente: recurrente,
                                periodicidad: periodicidad
                            }
                        );
                        
                        notificacionesEnviadas++;
                        
                    } catch (error) {
                        console.error(`❌ Error notificando residente ${residente.user_id?.email}:`, error.message);
                    }
                }
                
                console.log(`📨 Notificaciones enviadas: ${notificacionesEnviadas}/${residentesNotificar.length}`);
            }

            // ============================================
            // 11. RESPUESTA AL CLIENTE
            // ============================================

            res.status(201).json({
                success: true,
                message: `Cargo ${recurrente ? 'recurrente' : 'único'} creado exitosamente`,
                cargo: {
                    id: cargo[0]._id,
                    nombre: cargo[0].nombre,
                    tipo: tipoCargo.nombre,
                    tipo_codigo: tipoCargo.codigo,
                    
                    // Información de configuración
                    recurrente: recurrente,
                    periodicidad: periodicidad || 'No aplica',
                    siguiente_generacion: siguienteGeneracion,
                    
                    // Información financiera
                    monto_base: cargo[0].monto_base,
                    monto_total: cargo[0].monto_total,
                    fecha_vencimiento: cargo[0].fecha_vencimiento,
                    
                    // Estadísticas
                    domicilios_afectados: cargosDomicilioCreados.length,
                    notificaciones_enviadas: notificacionesEnviadas,
                    descuentos_aplicados: descuentos?.length || 0,
                    
                    // Para referencia
                    tipo_cargo_id: tipo_cargo_id,
                    aplica_a: aplica_a,
                    fecha_creacion: new Date()
                },
                
                // Datos para debugging/auditoría
                detalles: {
                    domicilios_count: domiciliosAfectados.length,
                    residentes_count: residentesNotificar.length,
                    tiene_descuentos: (descuentos && descuentos.length > 0),
                    configuracion_admin: {
                        decidio_recurrente: recurrente,
                        decidio_periodicidad: periodicidad
                    }
                }
            });

        } catch (error) {
            // ============================================
            // 12. MANEJO DE ERRORES
            // ============================================
            
            await session.abortTransaction();
            console.error('❌ Error en createCharge:', error);
            
            // Determinar tipo de error para mensaje amigable
            let mensajeError = 'Error al crear el cargo';
            let statusCode = 500;
            
            if (error.message.includes('Debe especificar')) {
                mensajeError = error.message;
                statusCode = 400;
            } else if (error.message.includes('no válido')) {
                mensajeError = error.message;
                statusCode = 400;
            } else if (error.message.includes('No se encontraron')) {
                mensajeError = error.message;
                statusCode = 404;
            }
            
            return res.status(statusCode).json({
                success: false,
                message: mensajeError,
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
            
        } finally {
            session.endSession();
        }
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
    calculateNextGenerationDate: (fechaVencimiento, periodicidad) => {
        if (!periodicidad || !fechaVencimiento) return null;
        
        const fecha = new Date(fechaVencimiento);
        
        switch (periodicidad.toLowerCase()) {
            case 'semanal':
                fecha.setDate(fecha.getDate() + 7);
                break;
            case 'quincenal':
                fecha.setDate(fecha.getDate() + 15);
                break;
            case 'mensual':
                fecha.setMonth(fecha.getMonth() + 1);
                break;
            case 'bimestral':
                fecha.setMonth(fecha.getMonth() + 2);
                break;
            case 'trimestral':
                fecha.setMonth(fecha.getMonth() + 3);
                break;
            case 'semestral':
                fecha.setMonth(fecha.getMonth() + 6);
                break;
            case 'anual':
                fecha.setFullYear(fecha.getFullYear() + 1);
                break;
            default:
                console.warn(`Periodicidad no reconocida: ${periodicidad}`);
                return null;
        }
        
        return fecha;
    },

    validateChargeData: (data) => {
        const errors = [];
        
        if (!data.tipo_cargo_id) errors.push('tipo_cargo_id es requerido');
        if (!data.nombre || data.nombre.trim().length === 0) errors.push('nombre es requerido');
        if (!data.monto_base || parseFloat(data.monto_base) <= 0) errors.push('monto_base debe ser mayor a 0');
        if (!data.fecha_cargo) errors.push('fecha_cargo es requerida');
        if (!data.fecha_vencimiento) errors.push('fecha_vencimiento es requerida');
        
        if (data.recurrente && !data.periodicidad) {
            errors.push('periodicidad es requerida para cargos recurrentes');
        }
        
        if (data.aplica_a === 'domicilios' && (!data.domicilios_ids || data.domicilios_ids.length === 0)) {
            errors.push('debe especificar domicilios_ids cuando aplica_a = "domicilios"');
        }
        
        if (data.aplica_a === 'calles' && (!data.calles_ids || data.calles_ids.length === 0)) {
            errors.push('debe especificar calles_ids cuando aplica_a = "calles"');
        }
        
        return errors;
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
    },

    /**
 * Aplicar saldo a favor a cargos pendientes
 */
applySaldoFavor: catchAsync(async (req, res) => {
    const { domicilio_id } = req.params;
    const { cargo_ids = [] } = req.body; // Opcional: aplicar a cargos específicos

    // Verificar si hay saldo a favor
    const saldoDomicilio = await SaldoDomicilio.findOne({
        domicilio_id
    });

    if (!saldoDomicilio || saldoDomicilio.saldo_favor <= 0) {
        return res.status(400).json({
            success: false,
            message: 'No hay saldo a favor disponible'
        });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Construir query para cargos pendientes
        const query = {
            domicilio_id,
            saldo_pendiente: { $gt: 0 },
            estatus: { $in: ['pendiente', 'vencido'] }
        };

        if (cargo_ids.length > 0) {
            query._id = { $in: cargo_ids };
        }

        // Obtener cargos ordenados por antigüedad (más viejos primero)
        const cargosPendientes = await CargoDomicilio.find(query)
            .populate('cargo_id', 'fecha_vencimiento')
            .sort({ 'cargo_id.fecha_vencimiento': 1 })
            .session(session);

        let saldoRestante = saldoDomicilio.saldo_favor;
        const aplicaciones = [];

        for (const cargoDom of cargosPendientes) {
            if (saldoRestante <= 0) break;

            const montoAAplicar = Math.min(saldoRestante, cargoDom.saldo_pendiente);

            // Crear "pago aplicado" especial para saldo a favor
            const pagoAplicado = await PagoAplicado.create([{
                comprobante_id: null, // Sin comprobante porque es saldo a favor
                cargo_domicilio_id: cargoDom._id,
                monto_aplicado: montoAAplicar,
                tipo_asignacion: 'saldo_favor',
                usuario_asignador_id: req.userId,
                notas: 'Aplicación de saldo a favor'
            }], { session });

            // Actualizar cargo domicilio
            cargoDom.saldo_pendiente -= montoAAplicar;
            if (cargoDom.saldo_pendiente <= 0) {
                cargoDom.estatus = 'pagado';
                cargoDom.fecha_pago = new Date();
            }
            await cargoDom.save({ session });

            saldoRestante -= montoAAplicar;
            aplicaciones.push({
                cargo_id: cargoDom.cargo_id,
                monto_aplicado: montoAAplicado,
                nuevo_saldo: cargoDom.saldo_pendiente
            });
        }

        // Actualizar saldo a favor
        saldoDomicilio.saldo_favor = saldoRestante;
        if (saldoRestante === 0) {
            saldoDomicilio.notas = `Saldo aplicado completamente el ${new Date().toLocaleDateString()}`;
        } else {
            saldoDomicilio.notas = `Parcialmente aplicado. Restante: ${Utils.formatCurrency(saldoRestante)}`;
        }
        await saldoDomicilio.save({ session });

        await session.commitTransaction();

        // Notificar al residente si se aplicó algún saldo
        if (aplicaciones.length > 0) {
            const residente = await Residente.findOne({ domicilio_id })
                .populate('user_id');
            
            if (residente && residente.user_id) {
                await NotificationService.sendNotification({
                    userId: residente.user_id._id,
                    tipo: 'push',
                    titulo: '💰 Saldo a favor aplicado',
                    mensaje: `Se aplicó saldo a favor a ${aplicaciones.length} de tus cargos pendientes`,
                    data: {
                        tipo: 'saldo_favor',
                        action: 'applied',
                        aplicaciones: aplicaciones.length,
                        total_aplicado: saldoDomicilio.saldo_favor - saldoRestante,
                        saldo_restante: saldoRestante
                    }
                });
            }
        }

        res.json({
            success: true,
            message: `Saldo a favor aplicado exitosamente`,
            resultado: {
                saldo_inicial: saldoDomicilio.saldo_favor + (saldoDomicilio.saldo_favor - saldoRestante),
                saldo_aplicado: saldoDomicilio.saldo_favor - saldoRestante,
                saldo_restante: saldoRestante,
                cargos_afectados: aplicaciones.length,
                aplicaciones
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
 * Transferir saldo a favor entre domicilios (solo administrador)
 */
transferSaldoFavor: catchAsync(async (req, res) => {
    const { 
        domicilio_origen_id, 
        domicilio_destino_id, 
        monto, 
        motivo 
    } = req.body;

    if (domicilio_origen_id === domicilio_destino_id) {
        return res.status(400).json({
            success: false,
            message: 'No se puede transferir saldo al mismo domicilio'
        });
    }

    if (parseFloat(monto) <= 0) {
        return res.status(400).json({
            success: false,
            message: 'El monto debe ser mayor a 0'
        });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Verificar saldo disponible en origen
        const saldoOrigen = await SaldoDomicilio.findOne({
            domicilio_id: domicilio_origen_id
        }).session(session);

        if (!saldoOrigen || saldoOrigen.saldo_favor < parseFloat(monto)) {
            throw new Error('Saldo insuficiente en domicilio de origen');
        }

        // Debitar saldo de origen
        saldoOrigen.saldo_favor -= parseFloat(monto);
        saldoOrigen.notas = `Transferido ${Utils.formatCurrency(monto)} a domicilio ${domicilio_destino_id}. Motivo: ${motivo || 'Sin motivo especificado'}`;
        await saldoOrigen.save({ session });

        // Acreditar saldo a destino
        const saldoDestino = await SaldoDomicilio.findOneAndUpdate(
            { domicilio_id: domicilio_destino_id },
            { 
                $inc: { saldo_favor: parseFloat(monto) },
                $set: { 
                    notas: `Recibido ${Utils.formatCurrency(monto)} de domicilio ${domicilio_origen_id}. Motivo: ${motivo || 'Sin motivo especificado'}` 
                }
            },
            { upsert: true, new: true, session }
        );

        // Registrar auditoría de la transferencia
        await mongoose.model('AuditoriaGeneral').create([{
            usuario_id: req.userId,
            accion: 'transferencia_saldo_favor',
            modulo: 'finanzas',
            detalles: {
                domicilio_origen: domicilio_origen_id,
                domicilio_destino: domicilio_destino_id,
                monto: parseFloat(monto),
                motivo,
                saldo_origen_despues: saldoOrigen.saldo_favor,
                saldo_destino_despues: saldoDestino.saldo_favor
            }
        }], { session });

        await session.commitTransaction();

        res.json({
            success: true,
            message: 'Transferencia de saldo completada exitosamente',
            transferencia: {
                origen: {
                    domicilio_id: domicilio_origen_id,
                    saldo_antes: saldoOrigen.saldo_favor + parseFloat(monto),
                    saldo_despues: saldoOrigen.saldo_favor
                },
                destino: {
                    domicilio_id: domicilio_destino_id,
                    saldo_antes: saldoDestino.saldo_favor - parseFloat(monto),
                    saldo_despues: saldoDestino.saldo_favor
                },
                monto: parseFloat(monto),
                motivo,
                fecha: new Date()
            }
        });

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
})
};