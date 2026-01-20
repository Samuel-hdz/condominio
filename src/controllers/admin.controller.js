import { UnidadGeografica } from '../models/unidadGeografica.model.js';
import { CalleTorre } from '../models/calleTorre.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import { User } from '../models/user.model.js';
import { UserRole } from '../models/userRole.model.js';
import { Publicacion } from '../models/publicacion.model.js';
import { DestinatarioPublicacion } from '../models/destinatarioPublicacion.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import { ModuloSistema } from '../models/moduloSistema.model.js';
import { PerfilPermiso } from '../models/perfilPermiso.model.js';

export const adminController = {
    /**
     * Crear nueva unidad geográfica (condominio/fraccionamiento)
     */
    createGeographicUnit: catchAsync(async (req, res) => {
        const { nombre, tipo, direccion, telefono, email } = req.body;

        // Verificar si ya existe una unidad con ese nombre
        const existingUnit = await UnidadGeografica.findOne({ nombre });
        if (existingUnit) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe una unidad geográfica con ese nombre'
            });
        }

        // Crear unidad
        const unidad = await UnidadGeografica.create({
            nombre,
            tipo: tipo || 'condominio',
            direccion,
            telefono,
            email
        });

        res.status(201).json({
            success: true,
            message: 'Unidad geográfica creada exitosamente',
            unidad
        });
    }),

    /**
     * Obtener todas las unidades geográficas
     */
    getGeographicUnits: catchAsync(async (req, res) => {
        const unidades = await UnidadGeografica.find()
            .sort({ nombre: 1 });

        res.json({
            success: true,
            unidades
        });
    }),

    /**
     * Crear nueva calle/torre
     */
    createStreetTower: catchAsync(async (req, res) => {
        const { unidad_geografica_id, nombre, tipo, orden } = req.body;

        // Verificar que la unidad geográfica existe
        const unidad = await UnidadGeografica.findById(unidad_geografica_id);
        if (!unidad) {
            return res.status(404).json({
                success: false,
                message: 'Unidad geográfica no encontrada'
            });
        }

        // Verificar si ya existe una calle/torre con ese nombre en la misma unidad
        const existingStreet = await CalleTorre.findOne({
            unidad_geografica_id,
            nombre
        });
        if (existingStreet) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe una calle/torre con ese nombre en esta unidad'
            });
        }

        // Crear calle/torre
        const calleTorre = await CalleTorre.create({
            unidad_geografica_id,
            nombre,
            tipo: tipo || 'calle',
            orden: orden || 0
        });

        res.status(201).json({
            success: true,
            message: 'Calle/torre creada exitosamente',
            calle_torre: calleTorre
        });
    }),

    /**
     * Obtener calles/torres por unidad geográfica
     */
    getStreetsTowers: catchAsync(async (req, res) => {
        const { unidad_geografica_id } = req.query;

        let query = {};
        if (unidad_geografica_id) {
            query.unidad_geografica_id = unidad_geografica_id;
        }

        const callesTorres = await CalleTorre.find(query)
            .populate('unidad_geografica_id', 'nombre tipo')
            .sort({ orden: 1, nombre: 1 });

        res.json({
            success: true,
            calles_torres: callesTorres
        });
    }),

    /**
     * Crear nuevo domicilio
     */
    createDomicile: catchAsync(async (req, res) => {
        const { calle_torre_id, numero, letra, referencia } = req.body;

        // Verificar que la calle/torre existe
        const calleTorre = await CalleTorre.findById(calle_torre_id);
        if (!calleTorre) {
            return res.status(404).json({
                success: false,
                message: 'Calle/torre no encontrada'
            });
        }

        // Verificar si ya existe el domicilio
        const existingDomicile = await Domicilio.findOne({
            calle_torre_id,
            numero,
            letra: letra || null
        });
        if (existingDomicile) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un domicilio con esa dirección'
            });
        }

        // Crear domicilio
        const domicilio = await Domicilio.create({
            calle_torre_id,
            numero,
            letra,
            referencia
        });

        res.status(201).json({
            success: true,
            message: 'Domicilio creado exitosamente',
            domicilio
        });
    }),

    /**
     * Obtener domicilios
     */
    getDomiciles: catchAsync(async (req, res) => {
        const { 
            calle_torre_id, 
            page = 1, 
            limit = 50,
            search 
        } = req.query;

        const skip = (page - 1) * limit;
        let query = {};

        if (calle_torre_id) {
            query.calle_torre_id = calle_torre_id;
        }

        if (search) {
            query.$or = [
                { numero: { $regex: search, $options: 'i' } },
                { letra: { $regex: search, $options: 'i' } }
            ];
        }

        const [domicilios, total] = await Promise.all([
            Domicilio.find(query)
                .populate({
                    path: 'calle_torre_id',
                    populate: {
                        path: 'unidad_geografica_id',
                        select: 'nombre'
                    }
                })
                .sort({ numero: 1, letra: 1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Domicilio.countDocuments(query)
        ]);

        // Obtener información de residentes para cada domicilio
        const { Residente } = await import('../models/residente.model.js');
        
        const domiciliosConResidentes = await Promise.all(
            domicilios.map(async (domicilio) => {
                const residentes = await Residente.find({
                    domicilio_id: domicilio._id,
                    estatus: 'activo'
                }).populate('user_id', 'nombre apellido email telefono');

                return {
                    ...domicilio.toObject(),
                    residentes: residentes.map(r => ({
                        id: r._id,
                        user: r.user_id,
                        es_principal: r.es_principal
                    }))
                };
            })
        );

        res.json({
            success: true,
            domicilios: domiciliosConResidentes,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener módulos del sistema
     */
    getSystemModules: catchAsync(async (req, res) => {
        const modules = await ModuloSistema.find({ activo: true })
            .sort({ orden: 1 });

        // Construir árbol jerárquico
        const buildTree = (parentId = null) => {
            return modules
                .filter(module => 
                    (parentId === null && !module.parent_id) || 
                    (module.parent_id && module.parent_id.toString() === parentId)
                )
                .map(module => ({
                    ...module.toObject(),
                    children: buildTree(module._id.toString())
                }));
        };

        const moduleTree = buildTree();

        res.json({
            success: true,
            modules: moduleTree
        });
    }),

    /**
     * Obtener perfiles de permisos
     */
    getPermissionProfiles: catchAsync(async (req, res) => {
        const perfiles = await PerfilPermiso.find()
            .sort({ nombre_perfil: 1 });

        res.json({
            success: true,
            perfiles
        });
    }),

    /**
     * Crear perfil de permisos
     */
    createPermissionProfile: catchAsync(async (req, res) => {
        const { nombre_perfil, descripcion, permisos_json, roles_asociados } = req.body;

        // Verificar si ya existe un perfil con ese nombre
        const existingProfile = await PerfilPermiso.findOne({ nombre_perfil });
        if (existingProfile) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un perfil con ese nombre'
            });
        }

        // Crear perfil
        const perfil = await PerfilPermiso.create({
            nombre_perfil,
            descripcion,
            permisos_json,
            roles_asociados: roles_asociados || []
        });

        res.status(201).json({
            success: true,
            message: 'Perfil de permisos creado exitosamente',
            perfil
        });
    }),

    /**
     * Actualizar perfil de permisos
     */
    updatePermissionProfile: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { nombre_perfil, descripcion, permisos_json, roles_asociados } = req.body;

        const perfil = await PerfilPermiso.findById(id);
        if (!perfil) {
            return res.status(404).json({
                success: false,
                message: 'Perfil no encontrado'
            });
        }

        // Verificar nombre único si se cambia
        if (nombre_perfil && nombre_perfil !== perfil.nombre_perfil) {
            const existingProfile = await PerfilPermiso.findOne({ 
                nombre_perfil,
                _id: { $ne: id }
            });
            if (existingProfile) {
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe otro perfil con ese nombre'
                });
            }
            perfil.nombre_perfil = nombre_perfil;
        }

        if (descripcion !== undefined) perfil.descripcion = descripcion;
        if (permisos_json !== undefined) perfil.permisos_json = permisos_json;
        if (roles_asociados !== undefined) perfil.roles_asociados = roles_asociados;

        await perfil.save();

        res.json({
            success: true,
            message: 'Perfil actualizado exitosamente',
            perfil
        });
    }),

    /**
     * Eliminar perfil de permisos
     */
    deletePermissionProfile: catchAsync(async (req, res) => {
        const { id } = req.params;

        const perfil = await PerfilPermiso.findById(id);
        if (!perfil) {
            return res.status(404).json({
                success: false,
                message: 'Perfil no encontrado'
            });
        }

        // Verificar si hay usuarios usando este perfil
        // (Implementar esta verificación si se asocian usuarios a perfiles)

        await perfil.deleteOne();

        res.json({
            success: true,
            message: 'Perfil eliminado exitosamente'
        });
    }),

    /**
     * Obtener estadísticas generales del sistema
     */
    getSystemStatistics: catchAsync(async (req, res) => {
        // Estadísticas de usuarios
        const totalUsuarios = await User.countDocuments();
        const usuariosActivos = await User.countDocuments({ estatus: 'activo' });
        
        // Estadísticas por rol
        const rolesStats = await UserRole.aggregate([
            { $group: { _id: '$role', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        // Estadísticas de residentes
        const { Residente } = await import('../models/residente.model.js');
        const totalResidentes = await Residente.countDocuments();
        const residentesActivos = await Residente.countDocuments({ estatus: 'activo' });
        const residentesPrincipales = await Residente.countDocuments({ es_principal: true });

        // Estadísticas de domicilios
        const totalDomicilios = await Domicilio.countDocuments();

        // Estadísticas de visitas recientes
        const { RegistroAcceso } = await import('../models/registroAcceso.model.js');
        const visitasHoy = await RegistroAcceso.countDocuments({
            fecha_hora_ingreso: {
                $gte: new Date().setHours(0, 0, 0, 0)
            }
        });

        // Estadísticas de paquetes
        const { Paquete } = await import('../models/paquete.model.js');
        const paquetesPorRetirar = await Paquete.countDocuments({ estado: 'por_retirar' });

        // Estadísticas de pagos
        const { ComprobantePago } = await import('../models/comprobantePago.model.js');
        const comprobantesPendientes = await ComprobantePago.countDocuments({ estatus: 'pendiente' });

        // Estadísticas de publicaciones
        const publicacionesRecientes = await Publicacion.countDocuments({
            fecha_publicacion: {
                $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Últimos 7 días
            }
        });

        res.json({
            success: true,
            estadisticas: {
                usuarios: {
                    total: totalUsuarios,
                    activos: usuariosActivos,
                    por_rol: rolesStats
                },
                residentes: {
                    total: totalResidentes,
                    activos: residentesActivos,
                    principales: residentesPrincipales
                },
                ubicaciones: {
                    domicilios: totalDomicilios
                },
                actividad: {
                    visitas_hoy: visitasHoy,
                    paquetes_por_retirar: paquetesPorRetirar,
                    comprobantes_pendientes: comprobantesPendientes,
                    publicaciones_recientes: publicacionesRecientes
                },
                actualizado: new Date()
            }
        });
    }),

    /**
     * Enviar notificación masiva
     */
    sendBulkNotification: catchAsync(async (req, res) => {
        const { 
            titulo, 
            mensaje, 
            tipo_destino,
            calle_torre_id,
            domicilio_id,
            user_ids 
        } = req.body;

        let destinatarios = [];

        // Determinar destinatarios según el tipo
        if (user_ids && Array.isArray(user_ids)) {
            // Usuarios específicos
            destinatarios = user_ids;
        } else if (tipo_destino === 'todos') {
            // Todos los residentes activos
            const { Residente } = await import('../models/residente.model.js');
            const residentes = await Residente.find({ estatus: 'activo' })
                .populate('user_id');
            destinatarios = residentes.map(r => r.user_id._id);
        } else if (tipo_destino === 'calle' && calle_torre_id) {
            // Residentes de una calle/torre específica
            const domicilios = await Domicilio.find({ calle_torre_id })
                .distinct('_id');
            
            const { Residente } = await import('../models/residente.model.js');
            const residentes = await Residente.find({
                domicilio_id: { $in: domicilios },
                estatus: 'activo'
            }).populate('user_id');
            
            destinatarios = residentes.map(r => r.user_id._id);
        } else if (tipo_destino === 'domicilio' && domicilio_id) {
            // Residentes de un domicilio específico
            const { Residente } = await import('../models/residente.model.js');
            const residentes = await Residente.find({
                domicilio_id,
                estatus: 'activo'
            }).populate('user_id');
            
            destinatarios = residentes.map(r => r.user_id._id);
        } else {
            return res.status(400).json({
                success: false,
                message: 'Se requiere especificar destinatarios válidos'
            });
        }

        // Eliminar duplicados
        destinatarios = [...new Set(destinatarios)];

        // Enviar notificaciones
        const resultados = await NotificationService.sendBulkNotification(
            destinatarios,
            {
                tipo: 'push',
                titulo,
                mensaje,
                data: { tipo: 'system', action: 'bulk_notification' }
            }
        );

        res.json({
            success: true,
            message: `Notificación enviada a ${resultados.length} destinatarios`,
            total_enviadas: resultados.length,
            resultados
        });
    }),

    /**
     * Obtener logs del sistema
     */
    getSystemLogs: catchAsync(async (req, res) => {
        const { 
            page = 1, 
            limit = 50,
            desde,
            hasta,
            accion,
            usuario_id 
        } = req.query;

        const skip = (page - 1) * limit;

        const { AuditoriaGeneral } = await import('../models/auditoriaGeneral.model.js');

        // Construir query
        let query = {};

        if (desde || hasta) {
            query.created_at = {};
            if (desde) query.created_at.$gte = new Date(desde);
            if (hasta) {
                const fechaHasta = new Date(hasta);
                fechaHasta.setHours(23, 59, 59, 999);
                query.created_at.$lte = fechaHasta;
            }
        }

        if (accion) query.accion = accion;
        if (usuario_id) query.usuario_id = usuario_id;

        // Obtener logs
        const [logs, total] = await Promise.all([
            AuditoriaGeneral.find(query)
                .populate('usuario_id', 'nombre apellido email')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            AuditoriaGeneral.countDocuments(query)
        ]);

        res.json({
            success: true,
            logs,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener información de sistema y versiones
     */
    getSystemInfo: catchAsync(async (req, res) => {
        // Información básica del sistema
        const systemInfo = {
            nombre: 'Sistema de Gestión Residencial',
            version: '1.0.0',
            entorno: process.env.NODE_ENV || 'development',
            base_datos: 'MongoDB',
            tiempo_activo: process.uptime(),
            memoria: process.memoryUsage(),
            fecha_servidor: new Date()
        };

        // Verificar conectividad con servicios externos
        const servicesStatus = {
            database: 'connected', // Asumiendo que si llegamos aquí, la DB está conectada
            // Agregar más servicios según sea necesario
        };

        res.json({
            success: true,
            system: systemInfo,
            services: servicesStatus
        });
    })
};