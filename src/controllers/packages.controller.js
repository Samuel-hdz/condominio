import { Paquete } from '../models/paquete.model.js';
import { Residente } from '../models/residente.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';

export const packagesController = {
    /**
     * Registrar nuevo paquete (desde caseta)
     */
    registerPackage: catchAsync(async (req, res) => {
        const { 
            residente_id,
            numero_guia,
            empresa_paqueteria,
            descripcion,
            observaciones 
        } = req.body;

        // Verificar que el residente existe
        const residente = await Residente.findById(residente_id)
            .populate('user_id');
        
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Crear paquete
        const paquete = await Paquete.create({
            residente_id,
            usuario_caseta_id: req.userId,
            numero_guia,
            empresa_paqueteria,
            descripcion,
            observaciones,
            estado: 'por_retirar',
            fecha_recepcion: new Date()
        });

        // Enviar notificación al residente
        await NotificationService.sendNotification({
            userId: residente.user_id._id,
            tipo: 'push',
            titulo: '📦 Paquete recibido',
            mensaje: `Tienes un paquete de ${empresa_paqueteria} en caseta`,
            data: {
                tipo: 'paquete',
                empresa: empresa_paqueteria,
                descripcion: descripcion || '',
                fecha: Utils.formatDate(new Date(), true),
                paqueteId: paquete._id.toString(),  // ✅ Convertir a string
                action: 'ver_paquete'
            },
            accionRequerida: true,
            accionTipo: 'ver_paquete',
            accionData: { paqueteId: paquete._id.toString() }  // ✅ Convertir a string
        });

        // Marcar como notificado
        paquete.estado = 'notificado';
        paquete.fecha_notificacion = new Date();
        await paquete.save();

        res.status(201).json({
            success: true,
            message: 'Paquete registrado exitosamente',
            paquete
        });
    }),

    /**
     * Obtener paquetes de un residente
     */
    getResidentPackages: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { 
            page = 1, 
            limit = 20,
            estado 
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        let query = { residente_id: residenteId };

        if (estado) {
            query.estado = estado;
        }

        // Obtener paquetes
        const [paquetes, total] = await Promise.all([
            Paquete.find(query)
                .populate('usuario_caseta_id', 'nombre apellido')
                .populate('usuario_retiro_id', 'nombre apellido')
                .sort({ fecha_recepcion: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Paquete.countDocuments(query)
        ]);

        res.json({
            success: true,
            paquetes,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Marcar paquete como retirado
     */
    markPackageAsRetrieved: catchAsync(async (req, res) => {
        const { id } = req.params;

        const paquete = await Paquete.findById(id);
        if (!paquete) {
            return res.status(404).json({
                success: false,
                message: 'Paquete no encontrado'
            });
        }

        // Verificar que el paquete esté disponible para retiro
        if (paquete.estado !== 'notificado') {
            return res.status(400).json({
                success: false,
                message: `El paquete no está disponible para retiro (estado: ${paquete.estado})`
            });
        }

        // Marcar como retirado
        paquete.estado = 'retirado';
        paquete.fecha_retiro = new Date();
        paquete.usuario_retiro_id = req.userId;
        await paquete.save();

        res.json({
            success: true,
            message: 'Paquete marcado como retirado exitosamente',
            paquete
        });
    }),

    /**
     * Obtener paquetes por estado (para caseta)
     */
    getPackagesByStatus: catchAsync(async (req, res) => {
        const { estado, page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        // Construir query
        let query = {};
        if (estado) {
            query.estado = estado;
        }

        // Obtener paquetes
        const [paquetes, total] = await Promise.all([
            Paquete.find(query)
                .populate('residente_id', 'user_id')
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'user_id',
                        select: 'nombre apellido telefono'
                    }
                })
                .populate('usuario_caseta_id', 'nombre apellido')
                .sort({ fecha_recepcion: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Paquete.countDocuments(query)
        ]);

        res.json({
            success: true,
            paquetes,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Actualizar información de paquete
     */
    updatePackage: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { descripcion, observaciones, estado } = req.body;

        const paquete = await Paquete.findById(id);
        if (!paquete) {
            return res.status(404).json({
                success: false,
                message: 'Paquete no encontrado'
            });
        }

        // Actualizar campos
        if (descripcion) paquete.descripcion = descripcion;
        if (observaciones !== undefined) paquete.observaciones = observaciones;
        if (estado) {
            // Validar transición de estado
            const estadosValidos = ['por_retirar', 'notificado', 'retirado', 'eliminado'];
            if (!estadosValidos.includes(estado)) {
                return res.status(400).json({
                    success: false,
                    message: `Estado inválido. Estados permitidos: ${estadosValidos.join(', ')}`
                });
            }
            paquete.estado = estado;

            // Actualizar fechas según estado
            const ahora = new Date();
            if (estado === 'notificado' && !paquete.fecha_notificacion) {
                paquete.fecha_notificacion = ahora;
            } else if (estado === 'retirado' && !paquete.fecha_retiro) {
                paquete.fecha_retiro = ahora;
                paquete.usuario_retiro_id = req.userId;
            }
        }

        await paquete.save();

        res.json({
            success: true,
            message: 'Paquete actualizado exitosamente',
            paquete
        });
    }),

    /**
     * Eliminar paquete (marcar como eliminado)
     */
    deletePackage: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { motivo } = req.body;

        const paquete = await Paquete.findById(id);
        if (!paquete) {
            return res.status(404).json({
                success: false,
                message: 'Paquete no encontrado'
            });
        }

        // Marcar como eliminado en lugar de borrar físicamente
        paquete.estado = 'eliminado';
        if (motivo) {
            paquete.observaciones = (paquete.observaciones || '') + `\n[ELIMINADO: ${motivo}]`;
        }
        await paquete.save();

        res.json({
            success: true,
            message: 'Paquete marcado como eliminado'
        });
    }),

    /**
     * Obtener estadísticas de paquetería
     */
    getPackageStatistics: catchAsync(async (req, res) => {
        const { mes, año } = req.query;

        // Determinar rango de fechas
        const ahora = new Date();
        const inicioMes = mes && año 
            ? new Date(año, mes - 1, 1)
            : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        
        const finMes = new Date(inicioMes.getFullYear(), inicioMes.getMonth() + 1, 0);
        finMes.setHours(23, 59, 59, 999);

        // Estadísticas generales
        const totalPaquetes = await Paquete.countDocuments({
            fecha_recepcion: { $gte: inicioMes, $lte: finMes }
        });

        const porRetirar = await Paquete.countDocuments({
            estado: 'por_retirar',
            fecha_recepcion: { $gte: inicioMes, $lte: finMes }
        });

        const notificados = await Paquete.countDocuments({
            estado: 'notificado',
            fecha_recepcion: { $gte: inicioMes, $lte: finMes }
        });

        const retirados = await Paquete.countDocuments({
            estado: 'retirado',
            fecha_recepcion: { $gte: inicioMes, $lte: finMes }
        });

        // Empresas de paquetería más comunes
        const empresasMasComunes = await Paquete.aggregate([
            { 
                $match: { 
                    fecha_recepcion: { $gte: inicioMes, $lte: finMes },
                    empresa_paqueteria: { $exists: true, $ne: null }
                } 
            },
            { $group: { 
                _id: '$empresa_paqueteria', 
                count: { $sum: 1 } 
            }},
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        // Tiempo promedio de retiro
        const retirosConTiempo = await Paquete.aggregate([
            { 
                $match: { 
                    estado: 'retirado',
                    fecha_recepcion: { $gte: inicioMes, $lte: finMes },
                    fecha_retiro: { $exists: true }
                } 
            },
            {
                $addFields: {
                    tiempoRetiro: {
                        $divide: [
                            { $subtract: ['$fecha_retiro', '$fecha_recepcion'] },
                            1000 * 60 * 60 // Convertir a horas
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    promedioHoras: { $avg: '$tiempoRetiro' },
                    minimoHoras: { $min: '$tiempoRetiro' },
                    maximoHoras: { $max: '$tiempoRetiro' },
                    total: { $sum: 1 }
                }
            }
        ]);

        const tiempoStats = retirosConTiempo[0] || {
            promedioHoras: 0,
            minimoHoras: 0,
            maximoHoras: 0,
            total: 0
        };

        res.json({
            success: true,
            estadisticas: {
                periodo: {
                    inicio: inicioMes,
                    fin: finMes
                },
                total: totalPaquetes,
                por_estado: {
                    por_retirar: porRetirar,
                    notificados: notificados,
                    retirados: retirados,
                    eliminados: totalPaquetes - (porRetirar + notificados + retirados)
                },
                empresas_mas_comunes: empresasMasComunes,
                tiempos_retiro: {
                    promedio_horas: tiempoStats.promedioHoras.toFixed(1),
                    minimo_horas: tiempoStats.minimoHoras.toFixed(1),
                    maximo_horas: tiempoStats.maximoHoras.toFixed(1),
                    total_retirados: tiempoStats.total
                }
            }
        });
    })
};