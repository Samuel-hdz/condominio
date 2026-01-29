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
            tipo_recargo,
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
        const tiposValidos = ['monto_fijo', 'porcentaje_original', 'porcentaje_saldo', 'porcentaje_total_acumulado'];
        if (!tiposValidos.includes(tipo_recargo)) {
            return res.status(400).json({
                success: false,
                message: 'Tipo de recargo no válido'
            });
        }

        // Validar que aplicar_solo_a solo contenga valores válidos
        const tiposCargoValidos = ['mantenimiento', 'extraordinario', 'multa'];
        if (aplicar_solo_a.length > 0) {
            for (const tipo of aplicar_solo_a) {
                if (!tiposCargoValidos.includes(tipo)) {
                    return res.status(400).json({
                        success: false,
                        message: `Tipo de cargo no válido: ${tipo}`
                    });
                }
            }
        }

        // Crear recargo
        const recargo = await Recargo.create({
            nombre,
            descripcion,
            tipo_recargo,
            valor: parseFloat(valor),
            considerar_adeudos_mayores_de: parseFloat(considerar_adeudos_mayores_de),
            aplicar_solo_a: aplicar_solo_a.length > 0 ? aplicar_solo_a : undefined,
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
                // Validar tipo de filtro
                if (!['nombre_contiene', 'tipo_cargo'].includes(filtro.tipo_filtro)) {
                    continue; // Saltar filtro inválido
                }

                const filtroCreado = await RecargoFiltro.create({
                    recargo_id: recargo._id,
                    tipo_filtro: filtro.tipo_filtro,
                    valor_filtro: filtro.valor_filtro
                });
                filtrosCreados.push(filtroCreado);
            }
            
            // Actualizar recargo con referencia a filtros
            recargo.filtros = filtrosCreados.map(f => f._id);
            await recargo.save();
        }

        // Aplicar recargo a cargos existentes que cumplan criterios
        const aplicacionesCreadas = await surchargesController.aplicarRecargoACargosExistentes(recargo);

        res.status(201).json({
            success: true,
            message: 'Recargo creado exitosamente',
            recargo: {
                id: recargo._id,
                nombre: recargo.nombre,
                tipo_recargo: recargo.tipo_recargo,
                valor: recargo.valor,
                aplicaciones_iniciales: aplicacionesCreadas.length,
                total_monto_recargado: aplicacionesCreadas.reduce((sum, app) => sum + app.monto_recargo, 0),
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
            saldo_pendiente: { $gt: 0 }
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
                const tipoCargo = cargoDom.cargo_id?.tipo_cargo_id?.tipo;
                if (!tipoCargo || !recargo.aplicar_solo_a.includes(tipoCargo)) {
                    return false;
                }
            }

            // Aplicar filtros personalizados desde RecargoFiltro
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
            const montoRecargo = await this.calcularMontoRecargo(
                recargo.tipo_recargo,
                recargo.valor,
                cargoDom
            );

            if (montoRecargo > 0) {
                const aplicacion = await AplicacionRecargo.create({
                    recargo_id: recargo._id,
                    cargo_domicilio_id: cargoDom._id,
                    monto_recargo: montoRecargo,
                    motivo: `Aplicación del recargo "${recargo.nombre}"`,
                    usuario_aplicador_id: recargo.usuario_creador_id
                });

                // Actualizar saldo del cargo domicilio
                cargoDom.saldo_pendiente += montoRecargo;
                cargoDom.monto_final += montoRecargo;
                await cargoDom.save();

                aplicacionesCreadas.push(aplicacion);

                // Notificar al residente
                await this.notificarRecargoResidente(cargoDom.domicilio_id, recargo, montoRecargo, cargoDom);
            }
        }

        return aplicacionesCreadas;
    },

    /**
     * Verificar si un cargo cumple con un filtro
     */
    cumpleFiltro: (cargoDomicilio, filtro) => {
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
            
            default:
                return true;
        }
    },

    /**
     * Calcular monto del recargo según tipo (CORREGIDO)
     */
    calcularMontoRecargo: async (tipoRecargo, valor, cargoDomicilio) => {
    switch (tipoRecargo) {
        case 'monto_fijo':
            return parseFloat(valor);
        
        case 'porcentaje_original':
            return (cargoDomicilio.monto * parseFloat(valor)) / 100;
        
        case 'porcentaje_saldo':
            return (cargoDomicilio.saldo_pendiente * parseFloat(valor)) / 100;
        
        case 'porcentaje_total_acumulado':
            const recargosAnteriores = await AplicacionRecargo.aggregate([
                { $match: { cargo_domicilio_id: cargoDomicilio._id } },
                { $group: { _id: null, total: { $sum: '$monto_recargo' } } }
            ]);
            
            const totalRecargos = recargosAnteriores[0]?.total || 0;
            const base = cargoDomicilio.monto + totalRecargos;
            return (base * parseFloat(valor)) / 100;
        
        default:
            return 0;
    }
    },

    /**
     * Notificar recargo a residente
     */
    notificarRecargoResidente: async (domicilioId, recargo, montoRecargo, cargoDomicilio) => {
        try {
            // Buscar residente principal del domicilio
            const Residente = mongoose.model('Residente');
            const residente = await Residente.findOne({
                domicilio_id: domicilioId,
                estatus: 'activo'
            }).populate('user_id');

            if (!residente || !residente.user_id) {
                console.log(`⚠️ No se encontró residente para domicilio: ${domicilioId}`);
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
                    cargo_id: cargoDomicilio.cargo_id.toString(), 
                    recargo_id: recargo._id.toString(), 
                    monto_recargo: montoRecargo.toString(),  
                    recargo_nombre: recargo.nombre,
                    nuevo_saldo: (cargoDomicilio.saldo_pendiente + montoRecargo).toString() 
                },
                accionRequerida: true,
                accionTipo: 'ver_estado_cuenta'
            });

        } catch (error) {
            console.error('Error notificando recargo a residente:', error);
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
                total_monto_recargado: aplicaciones.reduce((sum, app) => sum + app.monto_recargo, 0),
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

        // Estadísticas por tipo de cargo
        const statsPorTipoCargo = await AplicacionRecargo.aggregate([
            { $match: matchStage },
            {
                $lookup: {
                    from: 'cargodomicilios',
                    localField: 'cargo_domicilio_id',
                    foreignField: '_id',
                    as: 'cargo_domicilio'
                }
            },
            { $unwind: '$cargo_domicilio' },
            {
                $lookup: {
                    from: 'cargos',
                    localField: 'cargo_domicilio.cargo_id',
                    foreignField: '_id',
                    as: 'cargo'
                }
            },
            { $unwind: '$cargo' },
            {
                $lookup: {
                    from: 'tipocargos',
                    localField: 'cargo.tipo_cargo_id',
                    foreignField: '_id',
                    as: 'tipo_cargo'
                }
            },
            { $unwind: '$tipo_cargo' },
            {
                $group: {
                    _id: '$tipo_cargo.tipo',
                    count: { $sum: 1 },
                    totalMonto: { $sum: '$monto_recargo' }
                }
            },
            { $sort: { totalMonto: -1 } }
        ]);

        res.json({
            success: true,
            estadisticas: {
                por_recargo: stats,
                por_mes: statsPorMes,
                por_tipo_cargo: statsPorTipoCargo,
                total_recargos: await Recargo.countDocuments({ activo: true }),
                total_aplicaciones: await AplicacionRecargo.countDocuments(matchStage),
                monto_total_recargado: stats.reduce((sum, stat) => sum + stat.totalMontoRecargado, 0)
            }
        });
    }),

    /**
     * Modificar recargo existente
     */
    updateSurcharge: catchAsync(async (req, res) => {
        const { id } = req.params;
        const updates = req.body;

        const recargo = await Recargo.findById(id);
        if (!recargo) {
            return res.status(404).json({
                success: false,
                message: 'Recargo no encontrado'
            });
        }

        // Campos que no se pueden modificar directamente
        const camposNoModificables = ['usuario_creador_id', 'created_at'];
        for (const campo of camposNoModificables) {
            if (updates[campo]) {
                delete updates[campo];
            }
        }

        // Actualizar recargo
        Object.assign(recargo, updates);
        await recargo.save();

        res.json({
            success: true,
            message: 'Recargo actualizado exitosamente',
            recargo
        });
    }),

    /**
     * Eliminar recargo (lógico - desactivar)
     */
    deleteSurcharge: catchAsync(async (req, res) => {
        const { id } = req.params;

        const recargo = await Recargo.findById(id);
        if (!recargo) {
            return res.status(404).json({
                success: false,
                message: 'Recargo no encontrado'
            });
        }

        // Verificar si tiene aplicaciones activas
        const aplicacionesActivas = await AplicacionRecargo.countDocuments({
            recargo_id: id
        });

        if (aplicacionesActivas > 0) {
            return res.status(400).json({
                success: false,
                message: 'No se puede eliminar un recargo que ya tiene aplicaciones. Desactívelo en su lugar.'
            });
        }

        // Eliminar filtros asociados
        await RecargoFiltro.deleteMany({ recargo_id: id });

        // Eliminar recargo
        await recargo.deleteOne();

        res.json({
            success: true,
            message: 'Recargo eliminado exitosamente'
        });
    })
};