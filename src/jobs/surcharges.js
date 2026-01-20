import cron from 'node-cron';
import { Recargo } from '../models/recargo.model.js';
import { AplicacionRecargo } from '../models/aplicacionRecargo.model.js';
import { CargoDomicilio } from '../models/cargoDomicilio.model.js';
import { Cargo } from '../models/cargo.model.js';
import { Residente } from '../models/residente.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';
import mongoose from 'mongoose';

/**
 * Job para aplicar recargos automáticamente
 */

class SurchargesJob {
    /**
     * Configurar el job programado
     */
    static setup() {
        // Ejecutar diariamente a las 02:00 AM
        cron.schedule('0 2 * * *', async () => {
            try {
                console.log('💸 Iniciando aplicación de recargos automáticos...');
                const resultados = await this.applyScheduledSurcharges();
                console.log(`✅ Aplicación de recargos completada: ${resultados.length} recargos procesados`);
            } catch (error) {
                console.error('❌ Error en aplicación de recargos:', error);
            }
        });

        console.log('⏰ Job de recargos automáticos configurado (02:00 diario)');
    }

    /**
     * Aplicar recargos programados
     */
    static async applyScheduledSurcharges() {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Obtener recargos activos
        const recargosActivos = await Recargo.find({
            activo: true,
            fecha_inicio_vigencia: { $lte: hoy },
            $or: [
                { fecha_fin_vigencia: null },
                { fecha_fin_vigencia: { $gte: hoy } }
            ]
        })
        .populate('filtros')
        .populate('usuario_creador_id');

        if (recargosActivos.length === 0) {
            console.log('📭 No hay recargos activos para aplicar hoy');
            return [];
        }

        console.log(`🔍 Encontrados ${recargosActivos.length} recargos activos`);

        const resultados = [];

        for (const recargo of recargosActivos) {
            try {
                // Verificar si es recargo repetitivo y toca aplicar hoy
                if (recargo.repetitivo) {
                    const debeAplicar = await this.debeAplicarHoy(recargo, hoy);
                    if (!debeAplicar) {
                        console.log(`⏭️ Recargo "${recargo.nombre}" no toca aplicar hoy`);
                        continue;
                    }
                }

                // Aplicar recargo
                const resultado = await this.applySurcharge(recargo, hoy);
                resultados.push({
                    recargo_id: recargo._id,
                    nombre: recargo.nombre,
                    ...resultado,
                    success: true
                });

                console.log(`✅ Aplicado: ${recargo.nombre} -> ${resultado.total_aplicaciones} cargos afectados`);

            } catch (error) {
                console.error(`❌ Error aplicando recargo ${recargo.nombre}:`, error.message);
                resultados.push({
                    recargo_id: recargo._id,
                    nombre: recargo.nombre,
                    error: error.message,
                    success: false
                });
            }
        }

        // Generar reporte
        const exitosos = resultados.filter(r => r.success).length;
        const fallidos = resultados.filter(r => !r.success).length;

        console.log(`📊 Reporte: ${exitosos} recargos aplicados, ${fallidos} fallidos`);

        // Notificar a administradores
        await this.notificarResultados(resultados);

        return resultados;
    }

    /**
     * Verificar si un recargo repetitivo debe aplicarse hoy
     */
    static async debeAplicarHoy(recargo, hoy) {
        if (!recargo.repetitivo || !recargo.frecuencia_dias) {
            return false;
        }

        // Obtener última aplicación
        const ultimaAplicacion = await AplicacionRecargo.findOne({
            recargo_id: recargo._id
        })
        .sort({ fecha_aplicacion: -1 });

        // Si nunca se ha aplicado, aplicar si la fecha de inicio ya pasó
        if (!ultimaAplicacion) {
            return recargo.fecha_inicio_vigencia <= hoy;
        }

        // Calcular días desde última aplicación
        const diasDesdeUltima = Utils.daysBetween(ultimaAplicacion.fecha_aplicacion, hoy);
        
        // Aplicar si han pasado los días de frecuencia
        return diasDesdeUltima >= recargo.frecuencia_dias;
    }

    /**
     * Aplicar un recargo específico
     */
    static async applySurcharge(recargo, fechaAplicacion) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Buscar cargos domicilio que cumplan criterios
            const cargosDomicilio = await this.findCargosParaRecargo(recargo, fechaAplicacion);

            if (cargosDomicilio.length === 0) {
                throw new Error('No se encontraron cargos que cumplan los criterios');
            }

            const aplicacionesCreadas = [];
            let totalMontoRecargado = 0;

            // Aplicar recargo a cada cargo
            for (const cargoDom of cargosDomicilio) {
                const montoRecargo = this.calcularMontoRecargo(
                    recargo.tipo_recargo,
                    recargo.valor,
                    cargoDom
                );

                if (montoRecargo > 0) {
                    // Crear aplicación de recargo
                    const aplicacion = await AplicacionRecargo.create([{
                        recargo_id: recargo._id,
                        cargo_domicilio_id: cargoDom._id,
                        monto_recargo: montoRecargo,
                        fecha_aplicacion: fechaAplicacion,
                        motivo: `Aplicación automática del recargo "${recargo.nombre}"`,
                        usuario_aplicador_id: recargo.usuario_creador_id._id
                    }], { session });

                    // Actualizar cargo domicilio
                    cargoDom.saldo_pendiente += montoRecargo;
                    cargoDom.monto_final += montoRecargo;
                    await cargoDom.save({ session });

                    aplicacionesCreadas.push(aplicacion[0]);
                    totalMontoRecargado += montoRecargo;

                    // Notificar al residente (asincrónicamente fuera de la transacción)
                    this.notificarResidenteRecargo(cargoDom, recargo, montoRecargo)
                        .catch(err => console.error('Error notificando residente:', err));
                }
            }

            await session.commitTransaction();

            return {
                total_aplicaciones: aplicacionesCreadas.length,
                total_monto_recargado: totalMontoRecargado,
                cargos_afectados: cargosDomicilio.length,
                fecha_aplicacion: fechaAplicacion,
                aplicaciones: aplicacionesCreadas.slice(0, 10) // Limitar para respuesta
            };

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Buscar cargos que cumplan criterios para recargo
     */
    static async findCargosParaRecargo(recargo, fechaAplicacion) {
        // Query base: cargos vencidos con saldo pendiente
        let query = {
            estatus: 'vencido',
            saldo_pendiente: { $gt: 0 },
            fecha_pago: null
        };

        // Filtrar por monto mínimo
        if (recargo.considerar_adeudos_mayores_de > 0) {
            query.saldo_pendiente.$gt = recargo.considerar_adeudos_mayores_de;
        }

        // Obtener cargos domicilio que cumplan criterios básicos
        let cargosDomicilio = await CargoDomicilio.find(query)
            .populate('cargo_id')
            .populate({
                path: 'cargo_id',
                populate: {
                    path: 'tipo_cargo_id'
                }
            });

        // Aplicar filtros adicionales
        cargosDomicilio = cargosDomicilio.filter(cargoDom => {
            // Filtrar por tipo de cargo si se especifica
            if (recargo.aplicar_solo_a && recargo.aplicar_solo_a.length > 0) {
                const tipoCargo = cargoDom.cargo_id.tipo_cargo_id?.tipo;
                if (!tipoCargo || !recargo.aplicar_solo_a.includes(tipoCargo)) {
                    return false;
                }
            }

            // Aplicar filtros personalizados
            if (recargo.filtros && recargo.filtros.length > 0) {
                for (const filtro of recargo.filtros) {
                    if (!this.cumpleFiltro(cargoDom, filtro)) {
                        return false;
                    }
                }
            }

            return true;
        });

        return cargosDomicilio;
    }

    /**
     * Verificar si un cargo cumple con un filtro
     */
    static cumpleFiltro(cargoDomicilio, filtro) {
        if (!cargoDomicilio.cargo_id || !cargoDomicilio.cargo_id.tipo_cargo_id) {
            return false;
        }

        switch (filtro.tipo_filtro) {
            case 'tipo_cargo':
                return cargoDomicilio.cargo_id.tipo_cargo_id.tipo === filtro.valor_filtro;
            
            case 'nombre_contiene':
                return cargoDomicilio.cargo_id.nombre
                    .toLowerCase()
                    .includes(filtro.valor_filtro.toLowerCase());
            
            case 'dias_vencido_mayor':
                const diasVencido = Utils.daysBetween(
                    cargoDomicilio.cargo_id.fecha_vencimiento,
                    new Date()
                );
                return diasVencido > parseInt(filtro.valor_filtro);
            
            default:
                return true;
        }
    }

    /**
     * Calcular monto del recargo según tipo
     */
    static calcularMontoRecargo(tipoRecargo, valor, cargoDomicilio) {
        switch (tipoRecargo) {
            case 'monto_fijo':
                return parseFloat(valor);
            
            case 'porcentaje_adeudo':
                return (cargoDomicilio.monto_final * parseFloat(valor)) / 100;
            
            case 'porcentaje_saldo':
                return (cargoDomicilio.saldo_pendiente * parseFloat(valor)) / 100;
            
            case 'porcentaje_mas_recargos':
                // Obtener recargos anteriores aplicados
                return (cargoDomicilio.monto_final * parseFloat(valor)) / 100;
            
            default:
                return 0;
        }
    }

    /**
     * Notificar a residente sobre recargo aplicado
     */
    static async notificarResidenteRecargo(cargoDomicilio, recargo, montoRecargo) {
        try {
            // Buscar residente principal del domicilio
            const residente = await Residente.findOne({
                domicilio_id: cargoDomicilio.domicilio_id,
                estatus: 'activo'
            })
            .populate('user_id');

            if (!residente || !residente.user_id) {
                console.log(`⚠️ No se encontró residente para domicilio: ${cargoDomicilio.domicilio_id}`);
                return;
            }

            // Obtener información del cargo
            const cargo = await Cargo.findById(cargoDomicilio.cargo_id)
                .populate('tipo_cargo_id');

            await NotificationService.sendNotification({
                userId: residente.user_id._id,
                tipo: 'push',
                titulo: '⚠️ Recargo aplicado',
                mensaje: `Se aplicó un recargo de ${Utils.formatCurrency(montoRecargo)} a tu adeudo "${cargo?.nombre || 'N/A'}"`,
                data: {
                    tipo: 'recargo',
                    action: 'applied',
                    cargo_id: cargoDomicilio.cargo_id,
                    recargo_id: recargo._id,
                    monto_recargo: montoRecargo,
                    recargo_nombre: recargo.nombre,
                    nuevo_saldo: cargoDomicilio.saldo_pendiente + montoRecargo
                },
                accionRequerida: true,
                accionTipo: 'ver_estado_cuenta'
            });

        } catch (error) {
            console.error('Error notificando recargo a residente:', error);
        }
    }

    /**
     * Notificar resultados a administradores
     */
    static async notificarResultados(resultados) {
        const exitosos = resultados.filter(r => r.success);
        const fallidos = resultados.filter(r => !r.success);

        const admins = await mongoose.model('User').find({ role: 'administrador' });
        
        for (const admin of admins) {
            try {
                await NotificationService.sendNotification({
                    userId: admin._id,
                    tipo: 'in_app',
                    titulo: '📊 Reporte de recargos automáticos',
                    mensaje: `${exitosos.length} recargos aplicados, ${fallidos.length} fallidos`,
                    data: {
                        tipo: 'reporte',
                        action: 'surcharges_applied',
                        exitosos: exitosos.length,
                        fallidos: fallidos.length,
                        total_monto: exitosos.reduce((sum, r) => sum + (r.total_monto_recargado || 0), 0),
                        fecha: new Date().toISOString().split('T')[0]
                    }
                });
            } catch (error) {
                console.error('Error notificando administrador:', error);
            }
        }
    }

    /**
     * Endpoint manual para forzar aplicación (para testing)
     */
    static async forceApply(req, res) {
        try {
            const resultados = await this.applyScheduledSurcharges();
            
            res.json({
                success: true,
                message: 'Aplicación manual ejecutada',
                resultados,
                total: resultados.length,
                exitosos: resultados.filter(r => r.success).length,
                fallidos: resultados.filter(r => !r.success).length,
                fecha_ejecucion: new Date()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error en aplicación manual',
                error: error.message
            });
        }
    }

    /**
     * Verificar estado de recargos programados
     */
    static async getSurchargesStatus(req, res) {
        try {
            const hoy = new Date();
            
            // Recargos activos
            const recargosActivos = await Recargo.find({ activo: true })
                .populate('filtros')
                .sort({ nombre: 1 });

            // Estadísticas de aplicaciones hoy
            const inicioHoy = new Date();
            inicioHoy.setHours(0, 0, 0, 0);
            const finHoy = new Date();
            finHoy.setHours(23, 59, 59, 999);

            const aplicacionesHoy = await AplicacionRecargo.countDocuments({
                fecha_aplicacion: { $gte: inicioHoy, $lte: finHoy }
            });

            const montoHoy = await AplicacionRecargo.aggregate([
                {
                    $match: {
                        fecha_aplicacion: { $gte: inicioHoy, $lte: finHoy }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$monto_recargo' }
                    }
                }
            ]);

            // Próximos recargos repetitivos
            const recargosRepetitivos = await Recargo.find({
                activo: true,
                repetitivo: true
            });

            const proximosRecargos = [];
            for (const recargo of recargosRepetitivos) {
                const ultimaAplicacion = await AplicacionRecargo.findOne({
                    recargo_id: recargo._id
                })
                .sort({ fecha_aplicacion: -1 });

                let proximaAplicacion = null;
                if (ultimaAplicacion && recargo.frecuencia_dias) {
                    proximaAplicacion = new Date(ultimaAplicacion.fecha_aplicacion);
                    proximaAplicacion.setDate(proximaAplicacion.getDate() + recargo.frecuencia_dias);
                }

                if (proximaAplicacion && proximaAplicacion > hoy) {
                    proximosRecargos.push({
                        recargo_id: recargo._id,
                        nombre: recargo.nombre,
                        proxima_aplicacion: proximaAplicacion,
                        dias_restantes: Utils.daysBetween(hoy, proximaAplicacion)
                    });
                }
            }

            res.json({
                success: true,
                estado: {
                    total_recargos_activos: recargosActivos.length,
                    aplicaciones_hoy: aplicacionesHoy,
                    monto_recargado_hoy: montoHoy[0]?.total || 0,
                    proximos_recargos: proximosRecargos.sort((a, b) => 
                        new Date(a.proxima_aplicacion) - new Date(b.proxima_aplicacion)
                    ),
                    recargos_activos: recargosActivos.map(r => ({
                        id: r._id,
                        nombre: r.nombre,
                        tipo: r.tipo_recargo,
                        valor: r.valor,
                        repetitivo: r.repetitivo,
                        frecuencia_dias: r.frecuencia_dias
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

export default SurchargesJob;