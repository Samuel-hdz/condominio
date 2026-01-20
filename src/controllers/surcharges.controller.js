import { Recargo } from '../models/recargo.model.js';
import { RecargoFiltro } from '../models/recargoFiltro.model.js';
import { AplicacionRecargo } from '../models/aplicacionRecargo.model.js';
import { CargoDomicilio } from '../models/cargoDomicilio.model.js';
import { Cargo } from '../models/cargo.model.js';
import { TipoCargo } from '../models/tipoCargo.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';
import mongoose from 'mongoose';

export const surchargesController = {
    /**
     * Crear nuevo recargo
     */
    createSurcharge: catchAsync(async (req, res) => {
        const {
            nombre,
            descripcion,
            tipo_recargo, // 'monto_fijo', 'porcentaje_adeudo', 'porcentaje_saldo', 'porcentaje_mas_recargos'
            valor,
            considerar_adeudos_mayores_de = 0,
            aplicar_solo_a = [], // ['mantenimiento', 'extraordinario', 'multa']
            repetitivo = false,
            frecuencia_dias = 30,
            fecha_inicio_vigencia = new Date(),
            fecha_fin_vigencia = null,
            filtros = [] // [{ tipo_filtro: 'tipo_cargo', valor_filtro: 'mantenimiento' }, ...]
        } = req.body;

        // Validar tipo de recargo
        const tiposValidos = ['monto_fijo', 'porcentaje_adeudo', 'porcentaje_saldo', 'porcentaje_mas_recargos'];
        if (!tiposValidos.includes(tipo_recargo)) {
            return res.status(400).json({
                success: false,
                message: 'Tipo de recargo no válido'
            });
        }

        // Crear recargo
        const recargo = await Recargo.create({
            nombre,
            descripcion,
            tipo_recargo,
            valor: parseFloat(valor),
            considerar_adeudos_mayores_de: parseFloat(considerar_adeudos_mayores_de),
            aplicar_solo_a,
            repetitivo,
            frecuencia_dias: repetitivo ? parseInt(frecuencia_dias) : null,
            fecha_inicio_vigencia: new Date(fecha_inicio_vigencia),
            fecha_fin_vigencia: fecha_fin_vigencia ? new Date(fecha_fin_vigencia) : null,
            activo: true,
            usuario_creador_id: req.userId
        });

        // Crear filtros si existen
        if (filtros && filtros.length > 0) {
            const filtrosCreados = [];
            for (const filtro of filtros) {
                const filtroCreado = await RecargoFiltro.create({
                    recargo_id: recargo._id,
                    tipo_filtro: filtro.tipo_filtro,
                    valor_filtro: filtro.valor_filtro
                });
                filtrosCreados.push(filtroCreado);
            }
        }

        // Aplicar recargo a cargos existentes que cumplan criterios
        const aplicacionesCreadas = await this.aplicarRecargoACargosExistentes(recargo);

        res.status(201).json({
            success: true,
            message: 'Recargo creado exitosamente',
            recargo: {
                id: recargo._id,
                nombre: recargo.nombre,
                tipo_recargo: recargo.tipo_recargo,
                valor: recargo.valor,
                aplicaciones_iniciales: aplicacionesCreadas.length,
                detalles: aplicacionesCreadas.slice(0, 5) // Mostrar primeras 5 aplicaciones
            }
        });
    }),

    /**
     * Obtener todos los recargos
     */
    getAllSurcharges: catchAsync(async (req, res) => {
        const { page = 1, limit = 20, activo } = req.query;
        const skip = (page - 1) * limit;

        const query = {};
        if (activo !== undefined) query.activo = activo === 'true';

        const [recargos, total] = await Promise.all([
            Recargo.find(query)
                .populate('usuario_creador_id', 'nombre apellido')
                .populate('filtros')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Recargo.countDocuments(query)
        ]);

        // Para cada recargo, obtener estadísticas
        const recargosDetallados = await Promise.all(
            recargos.map(async (recargo) => {
                const estadisticas = await AplicacionRecargo.aggregate([
                    { $match: { recargo_id: recargo._id } },
                    {
                        $group: {
                            _id: null,
                            totalAplicaciones: { $sum: 1 },
                            totalMontoRecargado: { $sum: '$monto_recargo' },
                            ultimaAplicacion: { $max: '$fecha_aplicacion' }
                        }
                    }
                ]);

                return {
                    ...recargo.toObject(),
                    estadisticas: estadisticas[0] || {
                        totalAplicaciones: 0,
                        totalMontoRecargado: 0,
                        ultimaAplicacion: null
                    }
                };
            })
        );

        res.json({
            success: true,
            recargos: recargosDetallados,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Aplicar recargo a cargos existentes
     */
    aplicarRecargoACargosExistentes: async (recargo) => {
        const aplicacionesCreadas = [];
        const hoy = new Date();

        // Construir query para cargos domicilio vencidos
        let query = {
            estatus: 'vencido',
            saldo_pendiente: { $gt: 0 },
            fecha_pago: null
        };

        // Filtrar por monto mínimo
        if (recargo.considerar_adeudos_mayores_de > 0) {
            query.saldo_pendiente = { 
                ...query.saldo_pendiente,
                $gt: recargo.considerar_adeudos_mayores_de 
            };
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
                const tipoCargo = cargoDom.cargo_id.tipo_cargo_id.tipo;
                if (!recargo.aplicar_solo_a.includes(tipoCargo)) {
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

        // Aplicar recargo a cada cargo filtrado
        for (const cargoDom of cargosDomicilio) {
            const montoRecargo = this.calcularMontoRecargo(
                recargo.tipo_recargo,
                recargo.valor,
                cargoDom
            );

            if (montoRecargo > 0) {
                const aplicacion = await AplicacionRecargo.create({
                    recargo_id: recargo._id,
                    cargo_domicilio_id: cargoDom._id,
                    monto_recargo: montoRecargo,
                    motivo: `Aplicación inicial del recargo "${recargo.nombre}"`,
                    usuario_aplicador_id: recargo.usuario_creador_id
                });

                // Actualizar saldo del cargo domicilio
                cargoDom.saldo_pendiente += montoRecargo;
                cargoDom.monto_final += montoRecargo;
                await cargoDom.save();

                aplicacionesCreadas.push(aplicacion);

                // Notificar al residente (en producción, buscar residente por domicilio)
                // await this.notificarRecargoResidente(cargoDom.domicilio_id, recargo, montoRecargo);
            }
        }

        return aplicacionesCreadas;
    },

    /**
     * Verificar si un cargo cumple con un filtro
     */
    cumpleFiltro: (cargoDomicilio, filtro) => {
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
    },

    /**
     * Calcular monto del recargo según tipo
     */
    calcularMontoRecargo: (tipoRecargo, valor, cargoDomicilio) => {
        switch (tipoRecargo) {
            case 'monto_fijo':
                return parseFloat(valor);
            
            case 'porcentaje_adeudo':
                return (cargoDomicilio.monto_final * parseFloat(valor)) / 100;
            
            case 'porcentaje_saldo':
                return (cargoDomicilio.saldo_pendiente * parseFloat(valor)) / 100;
            
            case 'porcentaje_mas_recargos':
                // Obtener recargos anteriores aplicados a este cargo
                // Por ahora, usar monto_final
                return (cargoDomicilio.monto_final * parseFloat(valor)) / 100;
            
            default:
                return 0;
        }
    },

    /**
     * Aplicar recargos programados (para job diario)
     */
    aplicarRecargosProgramados: catchAsync(async (req, res) => {
        const hoy = new Date();
        
        // Obtener recargos repetitivos activos
        const recargosRepetitivos = await Recargo.find({
            activo: true,
            repetitivo: true,
            fecha_inicio_vigencia: { $lte: hoy },
            $or: [
                { fecha_fin_vigencia: null },
                { fecha_fin_vigencia: { $gte: hoy } }
            ]
        }).populate('filtros');

        const resultados = [];

        for (const recargo of recargosRepetitivos) {
            // Verificar si toca aplicar hoy según frecuencia
            const ultimaAplicacion = await AplicacionRecargo.findOne({
                recargo_id: recargo._id
            })
            .sort({ fecha_aplicacion: -1 });

            if (ultimaAplicacion) {
                const diasDesdeUltima = Utils.daysBetween(
                    ultimaAplicacion.fecha_aplicacion,
                    hoy
                );
                
                if (diasDesdeUltima < recargo.frecuencia_dias) {
                    continue; // No toca aplicar aún
                }
            }

            // Aplicar recargo
            const aplicaciones = await this.aplicarRecargoACargosExistentes(recargo);
            
            resultados.push({
                recargo_id: recargo._id,
                nombre: recargo.nombre,
                aplicaciones_creadas: aplicaciones.length,
                fecha_aplicacion: hoy
            });
        }

        res.json({
            success: true,
            message: 'Recargos programados aplicados',
            resultados,
            total_recargos_aplicados: resultados.length,
            fecha_ejecucion: hoy
        });
    }),

    /**
     * Activar/desactivar recargo
     */
    toggleSurcharge: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { activo } = req.body;

        const recargo = await Recargo.findById(id);
        if (!recargo) {
            return res.status(404).json({
                success: false,
                message: 'Recargo no encontrado'
            });
        }

        recargo.activo = activo;
        await recargo.save();

        res.json({
            success: true,
            message: `Recargo ${activo ? 'activado' : 'desactivado'} exitosamente`,
            recargo: {
                id: recargo._id,
                nombre: recargo.nombre,
                activo: recargo.activo
            }
        });
    }),

    /**
     * Obtener estadísticas de aplicaciones de recargos
     */
    getSurchargeStats: catchAsync(async (req, res) => {
        const { recargo_id, fecha_desde, fecha_hasta } = req.query;

        const matchStage = {};
        
        if (recargo_id) {
            matchStage.recargo_id = new mongoose.Types.ObjectId(recargo_id);
        }
        
        if (fecha_desde || fecha_hasta) {
            matchStage.fecha_aplicacion = {};
            if (fecha_desde) {
                matchStage.fecha_aplicacion.$gte = new Date(fecha_desde);
            }
            if (fecha_hasta) {
                const fechaHasta = new Date(fecha_hasta);
                fechaHasta.setHours(23, 59, 59, 999);
                matchStage.fecha_aplicacion.$lte = fechaHasta;
            }
        }

        const stats = await AplicacionRecargo.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$recargo_id',
                    totalAplicaciones: { $sum: 1 },
                    totalMontoRecargado: { $sum: '$monto_recargo' },
                    primeraAplicacion: { $min: '$fecha_aplicacion' },
                    ultimaAplicacion: { $max: '$fecha_aplicacion' }
                }
            },
            {
                $lookup: {
                    from: 'recargos',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'recargo_info'
                }
            },
            { $unwind: '$recargo_info' },
            {
                $project: {
                    recargo_nombre: '$recargo_info.nombre',
                    tipo_recargo: '$recargo_info.tipo_recargo',
                    totalAplicaciones: 1,
                    totalMontoRecargado: 1,
                    primeraAplicacion: 1,
                    ultimaAplicacion: 1
                }
            },
            { $sort: { totalMontoRecargado: -1 } }
        ]);

        // Estadísticas por mes
        const statsPorMes = await AplicacionRecargo.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        year: { $year: '$fecha_aplicacion' },
                        month: { $month: '$fecha_aplicacion' }
                    },
                    count: { $sum: 1 },
                    totalMonto: { $sum: '$monto_recargo' }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 }
        ]);

        res.json({
            success: true,
            estadisticas: {
                por_recargo: stats,
                por_mes: statsPorMes,
                total_recargos: await Recargo.countDocuments({ activo: true }),
                total_aplicaciones: await AplicacionRecargo.countDocuments(matchStage)
            }
        });
    })
};