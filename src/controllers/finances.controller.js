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
    }),

    registrarPagoManualmente: catchAsync(async (req, res) => {
        console.log('INICIANDO NUEVO PAGO MANUAL CON GENERACIÓN DE COMPROBANTE');
        
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
    }),

    descargarComprobantePDF: catchAsync(async (req, res) => {
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
    }),

    verComprobanteNavegador: catchAsync(async (req, res) => {
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
    }),

    regenerarComprobantePDF: catchAsync(async (req, res) => {
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
    }),

    previsualizarEstadoCuenta: catchAsync(async (req, res) => {
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
    }),

    notificarEstadoCuenta: catchAsync(async (req, res) => {
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
    }),
};