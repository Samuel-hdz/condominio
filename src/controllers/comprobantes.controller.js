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
import ComprobanteGenerator from '../libs/comprobanteGenerator.js';


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
        }).populate({
            path: 'cargo_domicilio_id',
            populate: {
                path: 'cargo_id',
                select: 'nombre descripcion fecha_vencimiento'
            }
        });

        // Verificar si ya existe PDF generado
        let pdfInfo = null;
        if (comprobante.comprobante_final_url) {
            const fs = await import('fs');
            const path = await import('path');
            
            const filePath = path.join(
                __dirname, 
                '..', 
                '..', 
                '..', 
                comprobante.comprobante_final_url.startsWith('/') 
                    ? comprobante.comprobante_final_url.substring(1) 
                    : comprobante.comprobante_final_url
            );
            
            pdfInfo = {
                url: comprobante.comprobante_final_url,
                exists: fs.existsSync(filePath),
                can_download: comprobante.estatus === 'aprobado',
                can_view: comprobante.estatus === 'aprobado',
                file_size: fs.existsSync(filePath) 
                    ? Math.round(fs.statSync(filePath).size / 1024) + ' KB' 
                    : 'N/A'
            };
        }

        res.json({
            success: true,
            comprobante: {
                ...comprobante.toObject(),
                pagos_aplicados: pagosAplicados,
                pdf_info: pdfInfo,
                total_aplicado: pagosAplicados.reduce((sum, pa) => sum + pa.monto_aplicado, 0)
            }
        });
    }),

    /**
     * Aprobar comprobante de pago
     */
    approveComprobante: catchAsync(async (req, res) => {
    const { id } = req.params;
    const { comentarios } = req.body || {};

    console.log(`✅ Aprobando comprobante ${id} y generando PDF...`);

    // 1. BUSCAR COMPROBANTE CON TODAS LAS POBLACIONES NECESARIAS
    const comprobante = await ComprobantePago.findById(id)
        .populate('cargo_domicilio_id')
        .populate({
            path: 'residente_id',
            populate: [
                { 
                    path: 'user_id', 
                    select: 'nombre apellido email' 
                },
                { 
                    path: 'domicilio_id',
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

    // 2. VERIFICAR ESTATUS
    if (comprobante.estatus !== 'pendiente') {
        return res.status(400).json({
            success: false,
            message: `El comprobante ya ha sido ${comprobante.estatus}`
        });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 3. BUSCAR PAGOS APLICADOS EXISTENTES
        let pagosAplicados = await PagoAplicado.find({
            comprobante_id: comprobante._id
        })
        .populate({
            path: 'cargo_domicilio_id',
            populate: {
                path: 'cargo_id',
                select: 'nombre descripcion'
            }
        })
        .session(session);

        console.log(`🔍 PagoAplicados encontrados: ${pagosAplicados.length}`);

        // 4. SI NO HAY PAGOS APLICADOS, CREAR UNO AUTOMÁTICAMENTE
        if (pagosAplicados.length === 0) {
            console.log(`⚠️ No hay pagos aplicados, creando automáticamente...`);
            
            if (!comprobante.cargo_domicilio_id) {
                throw new Error('El comprobante no tiene un cargo domicilio asociado');
            }

            const pagoAplicado = await PagoAplicado.create([{
                comprobante_id: comprobante._id,
                cargo_domicilio_id: comprobante.cargo_domicilio_id._id,
                monto_aplicado: comprobante.monto_total,
                tipo_asignacion: 'automatica',
                usuario_asignador_id: req.userId,
                notas: 'Creado automáticamente al aprobar comprobante'
            }], { session });

            // Recargar el pago con populate
            const pagoConPopulate = await PagoAplicado.findById(pagoAplicado[0]._id)
                .populate({
                    path: 'cargo_domicilio_id',
                    populate: {
                        path: 'cargo_id',
                        select: 'nombre descripcion'
                    }
                })
                .session(session);
            
            pagosAplicados = [pagoConPopulate];
            console.log(`✅ PagoAplicado creado: ${pagoAplicado[0]._id}`);
        }

        // 5. VERIFICAR MONTO TOTAL
        const totalPagosAplicados = pagosAplicados.reduce((sum, pago) => sum + pago.monto_aplicado, 0);
        const diferencia = Math.abs(totalPagosAplicados - comprobante.monto_total);
        
        if (diferencia > 0.01) {
            throw new Error(`El monto del comprobante (${comprobante.monto_total}) no coincide con la suma de pagos aplicados (${totalPagosAplicados})`);
        }

        // 6. ACTUALIZAR CARGOS DOMICILIO
        const cargosActualizados = [];
        
        for (const pago of pagosAplicados) {
            const cargoDomicilio = pago.cargo_domicilio_id;
            
            if (!cargoDomicilio) {
                throw new Error(`Cargo domicilio no encontrado para pago ${pago._id}`);
            }

            console.log(`📊 Procesando cargo: ${cargoDomicilio.cargo_id?.nombre || 'N/A'}`);
            console.log(`   Saldo anterior: ${cargoDomicilio.saldo_pendiente}`);
            console.log(`   Monto a aplicar: ${pago.monto_aplicado}`);

            // Verificar que el monto no excede saldo
            if (pago.monto_aplicado > cargoDomicilio.saldo_pendiente) {
                throw new Error(`El pago de ${pago.monto_aplicado} excede el saldo pendiente (${cargoDomicilio.saldo_pendiente}) del cargo "${cargoDomicilio.cargo_id?.nombre || 'N/A'}"`);
            }

            // Actualizar saldo
            cargoDomicilio.saldo_pendiente -= pago.monto_aplicado;
            
            // Cambiar estatus si se pagó completamente
            if (cargoDomicilio.saldo_pendiente <= 0) {
                cargoDomicilio.estatus = 'pagado';
                cargoDomicilio.fecha_pago = new Date();
                console.log(`   ✅ Cargo completamente pagado`);
            } else {
                console.log(`   ✅ Saldo nuevo: ${cargoDomicilio.saldo_pendiente}`);
            }
            
            await cargoDomicilio.save({ session });
            
            cargosActualizados.push({
                cargo_id: cargoDomicilio._id,
                nombre: cargoDomicilio.cargo_id?.nombre,
                saldo_anterior: cargoDomicilio.saldo_pendiente + pago.monto_aplicado,
                saldo_nuevo: cargoDomicilio.saldo_pendiente,
                monto_aplicado: pago.monto_aplicado,
                pagado_completamente: cargoDomicilio.saldo_pendiente <= 0
            });
        }

        // 7. ACTUALIZAR COMPROBANTE
        comprobante.estatus = 'aprobado';
        comprobante.fecha_aprobacion = new Date();
        comprobante.usuario_aprobador_id = req.userId;
        comprobante.observaciones = comentarios || comprobante.observaciones;

        // 8. ✅ GENERAR COMPROBANTE PDF
        console.log(`📄 Generando comprobante PDF para ${comprobante.folio}...`);
        
        // OPCION 1: Si ComprobanteGenerator está importado correctamente
        let comprobantePDF;
try {
    comprobantePDF = await ComprobanteGenerator.generateComprobante(
        comprobante,
        pagosAplicados
    );
} catch (pdfError) {
    console.error('❌ Error generando PDF:', pdfError);
    await session.abortTransaction();
    throw new Error(`No se pudo generar el comprobante PDF: ${pdfError.message}`);
}
        
        // Guardar URL del comprobante generado
        comprobante.comprobante_final_url = comprobantePDF.url;
        await comprobante.save({ session });

        // 9. CONFIRMAR TRANSACCIÓN
        await session.commitTransaction();
        console.log(`✅ Comprobante ${comprobante.folio} aprobado y PDF generado: ${comprobantePDF.fileName}`);

        // ========== OPERACIONES FUERA DE TRANSACCIÓN ==========

        // 10. NOTIFICAR AL RESIDENTE
        let notificacionEnviada = false;
        try {
            const residente = await Residente.findById(comprobante.residente_id._id)
                .populate('user_id');
            
            if (residente && residente.user_id) {
                await NotificationService.sendNotification({
                    userId: residente.user_id._id,
                    tipo: 'push',
                    titulo: '✅ Pago aprobado',
                    mensaje: `Tu comprobante ${comprobante.folio} ha sido aprobado. Se ha generado tu recibo oficial.`,
                    data: {
                        tipo: 'comprobante',
                        action: 'approved',
                        comprobante_id: comprobante._id,
                        comprobante_url: comprobante.comprobante_final_url,
                        folio: comprobante.folio,
                        monto_total: comprobante.monto_total,
                        fecha_aprobacion: comprobante.fecha_aprobacion
                    },
                    accionRequerida: true,
                    accionTipo: 'descargar_comprobante',
                    accionData: { 
                        comprobanteId: comprobante._id,
                        pdfUrl: comprobante.comprobante_final_url 
                    }
                });
                
                notificacionEnviada = true;
                console.log(`📨 Notificación enviada a residente: ${residente.user_id?.email || 'N/A'}`);
            }
        } catch (notifError) {
            console.warn('⚠️ Error enviando notificación al residente:', notifError.message);
        }

        // 11. RESPUESTA EXITOSA
        res.json({
            success: true,
            message: 'Comprobante aprobado exitosamente. Comprobante PDF generado.',
            comprobante: {
                id: comprobante._id,
                folio: comprobante.folio,
                estatus: comprobante.estatus,
                monto_total: comprobante.monto_total,
                comprobante_final_url: comprobante.comprobante_final_url,
                fecha_aprobacion: comprobante.fecha_aprobacion,
                aprobado_por: {
                    id: req.userId,
                    nombre: req.user?.nombre || 'Administrador'
                }
            },
            detalles: {
                pagos_aplicados: pagosAplicados.length,
                cargos_afectados: cargosActualizados.length,
                pdf_generado: true,
                nombre_pdf: comprobantePDF.fileName,
                notificacion_enviada: notificacionEnviada,
                cargos_actualizados: cargosActualizados
            }
        });

    } catch (error) {
        // 12. MANEJO DE ERRORES
        console.error('❌ Error aprobando comprobante:', error.message);
        console.error('❌ Stack trace:', error.stack);
        
        if (session && session.inTransaction()) {
            try {
                await session.abortTransaction();
                console.log('🔄 Transacción abortada');
            } catch (abortError) {
                console.error('❌ Error abortando transacción:', abortError.message);
            }
        }
        
        // Determinar código de error apropiado
        let statusCode = 500;
        let errorMessage = 'Error al aprobar el comprobante';
        
        if (error.message.includes('no tiene un cargo domicilio') || 
            error.message.includes('excede el saldo') ||
            error.message.includes('no coincide')) {
            statusCode = 400;
            errorMessage = error.message;
        } else if (error.message.includes('no encontrado')) {
            statusCode = 404;
            errorMessage = error.message;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error_details: process.env.NODE_ENV === 'development' ? {
                message: error.message,
                comprobante_id: id
            } : undefined
        });
        
    } finally {
        // 13. LIMPIEZA
        if (session) {
            await session.endSession();
        }
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
        
        if (residente && residente.user_id) {
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
                    monto: comprobante.monto_total,
                    fecha_rechazo: new Date()
                },
                accionRequerida: true,
                accionTipo: 'ver_comprobante',
                accionData: { comprobanteId: comprobante._id }
            });
        }

        res.json({
            success: true,
            message: 'Comprobante rechazado exitosamente',
            comprobante: {
                id: comprobante._id,
                folio: comprobante.folio,
                estatus: comprobante.estatus,
                motivo_rechazo: comprobante.motivo_rechazo,
                fecha_rechazo: new Date()
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