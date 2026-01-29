import cron from 'node-cron';
import { Cargo } from '../models/cargo.model.js';
import { CargoDomicilio } from '../models/cargoDomicilio.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import NotificationService from '../libs/notifications.js';
import mongoose from 'mongoose';

/**
 * Job para generar cargos recurrentes automáticamente
 */

class RecurrentChargesJob {
    /**
     * Configurar el job programado
     */
    static setup() {
        // Ejecutar diariamente a las 00:05 AM
        cron.schedule('5 0 * * *', async () => {
            try {
                console.log('🔔 Iniciando generación de cargos recurrentes...');
                await this.generateRecurrentCharges();
                console.log('✅ Generación de cargos recurrentes completada');
            } catch (error) {
                console.error('❌ Error en generación de cargos recurrentes:', error);
            }
        });

        console.log('⏰ Job de cargos recurrentes configurado (00:05 diario)');
    }

    /**
     * Generar cargos recurrentes
     */
    static async generateRecurrentCharges() {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Buscar cargos recurrentes con siguiente_generacion <= hoy
        const cargosRecurrentes = await Cargo.find({
            periodicidad: { $ne: null },
            siguiente_generacion: { $lte: hoy },
            estatus: 'activo'
        })
        .populate('tipo_cargo_id')
        .populate('usuario_creador_id');

        if (cargosRecurrentes.length === 0) {
            console.log('📭 No hay cargos recurrentes para generar hoy');
            return;
        }

        console.log(`🔍 Encontrados ${cargosRecurrentes.length} cargos recurrentes para generar`);

        const resultados = [];

        for (const cargoBase of cargosRecurrentes) {
            try {
                const resultado = await this.generateNextCharge(cargoBase, hoy);
                resultados.push(resultado);
                
                console.log(`✅ Generado: ${cargoBase.nombre} -> ${resultado.nuevoCargoId}`);
            } catch (error) {
                console.error(`❌ Error generando cargo ${cargoBase.nombre}:`, error.message);
                resultados.push({
                    cargoBaseId: cargoBase._id,
                    nombre: cargoBase.nombre,
                    error: error.message,
                    success: false
                });
            }
        }

        // Generar reporte
        const exitosos = resultados.filter(r => r.success).length;
        const fallidos = resultados.filter(r => !r.success).length;

        console.log(`📊 Reporte: ${exitosos} exitosos, ${fallidos} fallidos`);

        // Notificar a administradores si hay fallos
        if (fallidos > 0) {
            await this.notificarAdminFallos(resultados.filter(r => !r.success));
        }

        return resultados;
    }

    /**
     * Generar siguiente cargo basado en uno existente
     */
    static async generateNextCharge(cargoBase, fechaBase) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Calcular nuevas fechas
            const nuevaFechaCargo = new Date(cargoBase.siguiente_generacion);
            const nuevaFechaVencimiento = this.calculateNextDueDate(
                nuevaFechaCargo,
                cargoBase.periodicidad
            );
            const siguienteGeneracion = this.calculateNextGenerationDate(
                nuevaFechaVencimiento,
                cargoBase.periodicidad
            );

            // Crear nuevo cargo
            const nuevoCargo = await Cargo.create([{
                tipo_cargo_id: cargoBase.tipo_cargo_id._id,
                nombre: cargoBase.nombre,
                descripcion: cargoBase.descripcion,
                monto_base: cargoBase.monto_base,
                monto_total: cargoBase.monto_total,
                fecha_cargo: nuevaFechaCargo,
                fecha_vencimiento: nuevaFechaVencimiento,
                periodicidad: cargoBase.periodicidad,
                siguiente_generacion: siguienteGeneracion,
                aplica_a: cargoBase.aplica_a,
                estatus: 'activo',
                usuario_creador_id: cargoBase.usuario_creador_id._id
            }], { session });

            // Obtener domicilios afectados según el tipo de aplicación
            let domiciliosAfectados = [];

            switch (cargoBase.aplica_a) {
                case 'todos':
                    domiciliosAfectados = await Domicilio.find({ estatus: 'activo' }).session(session);
                    break;

                case 'domicilios':
                    // Obtener domicilios del cargo anterior
                    const cargosDomicilioAnterior = await CargoDomicilio.find({
                        cargo_id: cargoBase._id
                    }).distinct('domicilio_id').session(session);
                    
                    domiciliosAfectados = await Domicilio.find({
                        _id: { $in: cargosDomicilioAnterior },
                        estatus: 'activo'
                    }).session(session);
                    break;

                case 'calles':
                    // Obtener calles del cargo anterior
                    const cargosDomicilioCalles = await CargoDomicilio.find({
                        cargo_id: cargoBase._id
                    })
                    .populate('domicilio_id')
                    .session(session);
                    
                    const callesIds = [...new Set(
                        cargosDomicilioCalles.map(cd => cd.domicilio_id.calle_torre_id.toString())
                    )];
                    
                    domiciliosAfectados = await Domicilio.find({
                        calle_torre_id: { $in: callesIds },
                        estatus: 'activo'
                    }).session(session);
                    break;
            }

            // Crear CargoDomicilio para cada domicilio
            const cargosDomicilioCreados = [];
            const residentesNotificar = [];

            for (const domicilio of domiciliosAfectados) {
                const cargoDomicilio = await CargoDomicilio.create([{
                    cargo_id: nuevoCargo[0]._id,
                    domicilio_id: domicilio._id,
                    monto: cargoBase.monto_total,
                    monto_final: cargoBase.monto_total,
                    saldo_pendiente: cargoBase.monto_total,
                    estatus: 'pendiente'
                }], { session });

                cargosDomicilioCreados.push(cargoDomicilio[0]);

                // Obtener residentes para notificar
                const residentes = await mongoose.model('Residente').find({
                    domicilio_id: domicilio._id,
                    estatus: 'activo'
                }).populate('user_id').session(session);

                residentesNotificar.push(...residentes);
            }

            // Actualizar siguiente_generacion del cargo base
            cargoBase.siguiente_generacion = siguienteGeneracion;
            await cargoBase.save({ session });

            await session.commitTransaction();

            // Notificar a residentes (fuera de la transacción)
            await this.notificarResidentes(
                residentesNotificar,
                nuevoCargo[0],
                cargosDomicilioCreados.length
            );

            return {
                success: true,
                cargoBaseId: cargoBase._id,
                nuevoCargoId: nuevoCargo[0]._id,
                nombre: cargoBase.nombre,
                periodicidad: cargoBase.periodicidad,
                domicilios_afectados: cargosDomicilioCreados.length,
                residentes_notificados: residentesNotificar.length,
                nueva_fecha_vencimiento: nuevaFechaVencimiento,
                siguiente_generacion: siguienteGeneracion
            };

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Calcular fecha de vencimiento siguiente
     */
    static calculateNextDueDate(fechaBase, periodicidad) {
        const fecha = new Date(fechaBase);
        
        switch (periodicidad) {
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
                throw new Error('Periodicidad no válida');
        }
        
        return fecha;
    }

    /**
     * Calcular fecha de siguiente generación
     */
    static calculateNextGenerationDate(fechaVencimiento, periodicidad) {
    const fecha = new Date(fechaVencimiento);
    
    switch (periodicidad) {
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
            // Por defecto, generar al día siguiente de la fecha de vencimiento
            fecha.setDate(fecha.getDate() + 1);
    }
    
    return fecha;
}

    /**
     * Notificar a residentes sobre nuevo cargo recurrente
     */
    static async notificarResidentes(residentes, nuevoCargo, totalDomicilios) {
        let notificacionesEnviadas = 0;

        for (const residente of residentes) {
            try {
                await NotificationService.notifications.pagoPendiente(
                    residente.user_id._id,
                    {
                        concepto: nuevoCargo.nombre,
                        monto: nuevoCargo.monto_total,
                        fecha_vencimiento: nuevoCargo.fecha_vencimiento,
                        cargo_id: nuevoCargo._id,
                        tipo: 'recurrente',
                        periodicidad: nuevoCargo.periodicidad
                    }
                );
                notificacionesEnviadas++;
            } catch (error) {
                console.error(`Error notificando residente ${residente.user_id.email}:`, error.message);
            }
        }

        console.log(`📨 Notificaciones enviadas: ${notificacionesEnviadas} de ${residentes.length} residentes`);

        // Notificar a administradores sobre la generación exitosa
        const admins = await mongoose.model('User').find({ role: 'administrador' });
        for (const admin of admins) {
            await NotificationService.sendNotification({
                userId: admin._id,
                tipo: 'in_app',
                titulo: '🔔 Cargos recurrentes generados',
                mensaje: `Se generaron ${totalDomicilios} cargos de "${nuevoCargo.nombre}"`,
                data: {
                    tipo: 'cargo',
                    action: 'recurrent_generated',
                    cargo_id: nuevoCargo._id.toString(), 
                    total_domicilios: totalDomicilios.toString() 
                }
            });
        }
    }

    /**
     * Notificar a administradores sobre fallos
     */
    static async notificarAdminFallos(fallos) {
        const admins = await mongoose.model('User').find({ role: 'administrador' });
        
        for (const admin of admins) {
            await NotificationService.sendNotification({
                userId: admin._id,
                tipo: 'in_app',
                titulo: '⚠️ Fallos en cargos recurrentes',
                mensaje: `${fallos.length} cargos recurrentes no pudieron generarse`,
                data: {
                    tipo: 'cargo',
                    action: 'recurrent_failed',
                    fallos: JSON.stringify(fallos.map(f => ({
                        nombre: f.nombre || 'N/A',
                        error: f.error || 'Error desconocido'
                    })))
                },
                accionRequerida: true,
                accionTipo: 'ver_reportes'
            });
        }
    }

    /**
     * Endpoint manual para forzar generación (para testing)
     */
    static async forceGeneration(req, res) {
        try {
            const resultados = await this.generateRecurrentCharges();
            
            res.json({
                success: true,
                message: 'Generación manual ejecutada',
                resultados,
                total: resultados.length,
                exitosos: resultados.filter(r => r.success).length,
                fallidos: resultados.filter(r => !r.success).length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error en generación manual',
                error: error.message
            });
        }
    }

    /**
     * Verificar estado de cargos recurrentes
     */
    static async getRecurrentChargesStatus(req, res) {
        try {
            const hoy = new Date();
            const unaSemanaDespues = new Date(hoy);
            unaSemanaDespues.setDate(hoy.getDate() + 7);

            // Cargos que se generarán pronto
            const proximosCargos = await Cargo.find({
                periodicidad: { $ne: null },
                siguiente_generacion: { 
                    $gte: hoy,
                    $lte: unaSemanaDespues 
                },
                estatus: 'activo'
            })
            .populate('tipo_cargo_id')
            .sort({ siguiente_generacion: 1 });

            // Estadísticas
            const totalRecurrentes = await Cargo.countDocuments({
                periodicidad: { $ne: null },
                estatus: 'activo'
            });

            const generadosHoy = await Cargo.countDocuments({
                fecha_cargo: {
                    $gte: new Date().setHours(0, 0, 0, 0),
                    $lte: new Date().setHours(23, 59, 59, 999)
                },
                periodicidad: { $ne: null }
            });

            res.json({
                success: true,
                estado: {
                    total_cargos_recurrentes: totalRecurrentes,
                    generados_hoy: generadosHoy,
                    proximos_a_generar: proximosCargos.length,
                    proximos_cargos: proximosCargos.map(c => ({
                        id: c._id,
                        nombre: c.nombre,
                        periodicidad: c.periodicidad,
                        siguiente_generacion: c.siguiente_generacion,
                        tipo: c.tipo_cargo_id?.nombre || 'N/A'
                    }))
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error obteniendo estado',
                error: error.message
            });
        }
    }
}

export default RecurrentChargesJob;