import { Residente } from '../models/residente.model.js';
import { User } from '../models/user.model.js';
import { UserRole } from '../models/userRole.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import { CalleTorre } from '../models/calleTorre.model.js';
import { EstadoRecepcion } from '../models/estadoRecepcion.model.js';
import { ResidenteMorosidad } from '../models/residenteMorosidad.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';

export const residentsController = {
    /**
     * Crear nuevo residente (por administrador)
     */
    createResident: catchAsync(async (req, res) => {
        const { 
            user_id, 
            domicilio_id, 
            es_principal = false,
            estatus = 'activo' 
        } = req.body;

        // Verificar que el usuario existe
        const user = await User.findById(user_id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Verificar que el domicilio existe
        const domicilio = await Domicilio.findById(domicilio_id);
        if (!domicilio) {
            return res.status(404).json({
                success: false,
                message: 'Domicilio no encontrado'
            });
        }

        // Verificar que el usuario no sea ya residente de otro domicilio
        const existingResident = await Residente.findOne({ user_id });
        if (existingResident) {
            return res.status(400).json({
                success: false,
                message: 'El usuario ya es residente de otro domicilio'
            });
        }

        // Si es principal, verificar que no haya otro residente principal en el domicilio
        if (es_principal) {
            const existingPrincipal = await Residente.findOne({
                domicilio_id,
                es_principal: true,
                estatus: 'activo'
            });
            
            if (existingPrincipal) {
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe un residente principal en este domicilio'
                });
            }
        }

        // Crear residente
        const residente = await Residente.create({
            user_id,
            domicilio_id,
            es_principal,
            estatus
        });

        // Asignar rol de residente al usuario
        await UserRole.findOneAndUpdate(
            { user_id, role: 'residente' },
            { user_id, role: 'residente' },
            { upsert: true }
        );

        // Crear estado de recepción por defecto
        await EstadoRecepcion.create({
            residente_id: residente._id,
            recibiendo_visitas: true,
            recibiendo_personal: true,
            ultima_modificacion_por: req.userId
        });

        // Crear registro de morosidad
        await ResidenteMorosidad.create({
            residente_id: residente._id,
            es_moroso: false,
            monto_adeudado: 0,
            dias_morosidad: 0
        });

        // Obtener información completa para respuesta
        const residenteCompleto = await Residente.findById(residente._id)
            .populate('user_id', 'nombre apellido email telefono')
            .populate({
                path: 'domicilio_id',
                populate: {
                    path: 'calle_torre_id',
                    populate: {
                        path: 'unidad_geografica_id'
                    }
                }
            });

        // Enviar notificación al residente
        await NotificationService.sendNotification({
            userId: user_id,
            tipo: 'push',
            titulo: '🏠 ¡Bienvenido como residente!',
            mensaje: `Has sido registrado como residente ${es_principal ? 'principal' : ''} en el domicilio.`,
            data: { 
                tipo: 'resident', 
                action: 'registered',
                residente_id: residente._id,
                es_principal 
            }
        });

        res.status(201).json({
            success: true,
            message: 'Residente creado exitosamente',
            residente: residenteCompleto
        });
    }),

    /**
     * Obtener todos los residentes (con filtros y paginación)
     */
    getAllResidents: catchAsync(async (req, res) => {
        const { 
            page = 1, 
            limit = 20, 
            search, 
            calle_torre_id,
            domicilio_id,
            es_principal,
            estatus,
            es_moroso 
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        let query = {};

        // Filtro por búsqueda
        if (search) {
            const users = await User.find({
                $or: [
                    { nombre: { $regex: search, $options: 'i' } },
                    { apellido: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }).select('_id');
            
            query.user_id = { $in: users.map(u => u._id) };
        }

        // Filtro por calle/torre
        if (calle_torre_id) {
            const domicilios = await Domicilio.find({ calle_torre_id }).select('_id');
            query.domicilio_id = { $in: domicilios.map(d => d._id) };
        }

        // Filtro por domicilio específico
        if (domicilio_id) {
            query.domicilio_id = domicilio_id;
        }

        // Filtro por residente principal
        if (es_principal !== undefined) {
            query.es_principal = es_principal === 'true';
        }

        // Filtro por estatus
        if (estatus) {
            query.estatus = estatus;
        }

        // Filtro por morosidad
        if (es_moroso !== undefined) {
            const morosos = await ResidenteMorosidad.find({ 
                es_moroso: es_moroso === 'true' 
            }).select('residente_id');
            
            if (!query._id) query._id = {};
            query._id.$in = morosos.map(m => m.residente_id);
        }

        // Obtener residentes
        const [residentes, total] = await Promise.all([
            Residente.find(query)
                .populate('user_id', 'nombre apellido email telefono')
                .populate({
                    path: 'domicilio_id',
                    populate: {
                        path: 'calle_torre_id',
                        select: 'nombre tipo'
                    }
                })
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Residente.countDocuments(query)
        ]);

        // Agregar información de morosidad
        const residentesCompletos = await Promise.all(
            residentes.map(async (residente) => {
                const morosidad = await ResidenteMorosidad.findOne({ 
                    residente_id: residente._id 
                });
                
                const estadoRecepcion = await EstadoRecepcion.findOne({
                    residente_id: residente._id
                });

                return {
                    ...residente.toObject(),
                    morosidad: morosidad || null,
                    estado_recepcion: estadoRecepcion || null
                };
            })
        );

        res.json({
            success: true,
            residentes: residentesCompletos,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener residente por ID
     */
    getResidentById: catchAsync(async (req, res) => {
        const { id } = req.params;

        const residente = await Residente.findById(id)
            .populate('user_id', 'nombre apellido email telefono')
            .populate({
                path: 'domicilio_id',
                populate: {
                    path: 'calle_torre_id',
                    populate: {
                        path: 'unidad_geografica_id'
                    }
                }
            })
            .populate('creado_por_residente_id', 'user_id')
            .populate({
                path: 'creado_por_residente_id',
                populate: {
                    path: 'user_id',
                    select: 'nombre apellido'
                }
            });

        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Obtener información adicional
        const [morosidad, estadoRecepcion, residentesMismoDomicilio] = await Promise.all([
            ResidenteMorosidad.findOne({ residente_id: residente._id }),
            EstadoRecepcion.findOne({ residente_id: residente._id }),
            Residente.find({ 
                domicilio_id: residente.domicilio_id._id,
                _id: { $ne: residente._id }
            }).populate('user_id', 'nombre apellido email')
        ]);

        res.json({
            success: true,
            residente: {
                ...residente.toObject(),
                morosidad: morosidad || null,
                estado_recepcion: estadoRecepcion || null,
                otros_residentes: residentesMismoDomicilio
            }
        });
    }),

    /**
     * Actualizar residente
     */
    updateResident: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { es_principal, estatus } = req.body;

        const residente = await Residente.findById(id);
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Si se cambia a principal, verificar que no haya otro principal
        if (es_principal === true && residente.es_principal === false) {
            const existingPrincipal = await Residente.findOne({
                domicilio_id: residente.domicilio_id,
                es_principal: true,
                _id: { $ne: residente._id }
            });
            
            if (existingPrincipal) {
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe un residente principal en este domicilio'
                });
            }
        }

        // Actualizar campos
        if (es_principal !== undefined) residente.es_principal = es_principal;
        if (estatus) residente.estatus = estatus;

        await residente.save();

        // Si se cambió el estatus a inactivo, enviar notificación
        if (estatus === 'inactivo') {
            await NotificationService.sendNotification({
                userId: residente.user_id,
                tipo: 'push',
                titulo: '⚠️ Estado de residente actualizado',
                mensaje: 'Tu estatus como residente ha sido cambiado a inactivo.',
                data: { 
                    tipo: 'resident', 
                    action: 'status_changed',
                    nuevo_estatus: estatus 
                }
            });
        }

        res.json({
            success: true,
            message: 'Residente actualizado exitosamente',
            residente: {
                id: residente._id,
                es_principal: residente.es_principal,
                estatus: residente.estatus
            }
        });
    }),

    /**
     * Actualizar estado de recepción (desde app móvil)
     */
    updateReceptionStatus: catchAsync(async (req, res) => {
        const residenteId = req.residenteId; // Del middleware requireResidentMobileAccess
        const { recibiendo_visitas, recibiendo_personal } = req.body;

        const estado = await EstadoRecepcion.findOneAndUpdate(
            { residente_id: residenteId },
            { 
                recibiendo_visitas, 
                recibiendo_personal,
                ultima_modificacion_por: req.userId
            },
            { new: true, upsert: true }
        );

        res.json({
            success: true,
            message: 'Estado de recepción actualizado',
            estado_recepcion: estado
        });
    }),

    /**
     * Obtener estado de recepción del residente
     */
    getReceptionStatus: catchAsync(async (req, res) => {
        const { id } = req.params;

        const estado = await EstadoRecepcion.findOne({ residente_id: id });
        if (!estado) {
            return res.status(404).json({
                success: false,
                message: 'Estado de recepción no encontrado'
            });
        }

        res.json({
            success: true,
            estado_recepcion: estado
        });
    }),

    /**
     * Crear usuario residente secundario (desde app de residente principal)
     */
    createSecondaryResident: catchAsync(async (req, res) => {
        const { 
            email, 
            username, 
            password, 
            nombre, 
            apellido, 
            telefono 
        } = req.body;

        // Verificar que el residente que hace la solicitud es principal
        const residentePrincipal = await Residente.findOne({
            user_id: req.userId,
            es_principal: true,
            estatus: 'activo'
        });

        if (!residentePrincipal) {
            return res.status(403).json({
                success: false,
                message: 'Solo residentes principales pueden crear usuarios secundarios'
            });
        }

        // Verificar si el email ya existe
        const existingEmail = await User.findOne({ email: email.toLowerCase() });
        if (existingEmail) {
            return res.status(400).json({
                success: false,
                message: 'El email ya está registrado'
            });
        }

        // Verificar si el username ya existe
        const existingUsername = await User.findOne({ username });
        if (existingUsername) {
            return res.status(400).json({
                success: false,
                message: 'El nombre de usuario ya está en uso'
            });
        }

        // Crear usuario
        const user = await User.create({
            email: email.toLowerCase(),
            username,
            password_hash: password,
            nombre,
            apellido,
            telefono,
            estatus: 'activo'
        });

        // Crear residente asociado al mismo domicilio
        const residente = await Residente.create({
            user_id: user._id,
            domicilio_id: residentePrincipal.domicilio_id,
            es_principal: false,
            creado_por_residente_id: residentePrincipal._id,
            estatus: 'activo'
        });

        // Asignar rol de residente
        await UserRole.create({
            user_id: user._id,
            role: 'residente'
        });

        // Crear estado de recepción por defecto
        await EstadoRecepcion.create({
            residente_id: residente._id,
            recibiendo_visitas: true,
            recibiendo_personal: true,
            ultima_modificacion_por: req.userId
        });

        // Enviar notificación al nuevo residente
        await NotificationService.sendNotification({
            userId: user._id,
            tipo: 'push',
            titulo: '👋 ¡Bienvenido como residente!',
            mensaje: `${residentePrincipal.user_id.nombre} te ha registrado como residente en el domicilio.`,
            data: { 
                tipo: 'resident', 
                action: 'added_by_principal',
                residente_principal: residentePrincipal.user_id.nombre
            }
        });

        // Enviar notificación al residente principal
        await NotificationService.sendNotification({
            userId: req.userId,
            tipo: 'in_app',
            titulo: '✅ Usuario creado exitosamente',
            mensaje: `Has creado el usuario para ${nombre} ${apellido}`,
            data: { 
                tipo: 'resident', 
                action: 'user_created',
                nuevo_usuario: user._id 
            }
        });

        res.status(201).json({
            success: true,
            message: 'Usuario residente creado exitosamente',
            user: {
                id: user._id,
                email: user.email,
                nombre: user.nombre,
                apellido: user.apellido
            },
            residente: {
                id: residente._id,
                es_principal: false
            }
        });
    }),

    /**
     * Obtener usuarios secundarios creados por un residente principal
     */
    getSecondaryResidents: catchAsync(async (req, res) => {
        const residentePrincipal = await Residente.findOne({
            user_id: req.userId,
            es_principal: true
        });

        if (!residentePrincipal) {
            return res.status(403).json({
                success: false,
                message: 'Solo residentes principales pueden ver usuarios secundarios'
            });
        }

        const residentesSecundarios = await Residente.find({
            creado_por_residente_id: residentePrincipal._id
        })
        .populate('user_id', 'nombre apellido email telefono estatus')
        .sort({ created_at: -1 });

        res.json({
            success: true,
            residentes: residentesSecundarios
        });
    }),

    /**
     * Activar/desactivar usuario residente secundario
     */
    toggleSecondaryResident: catchAsync(async (req, res) => {
        const { residenteId } = req.params;
        const { activar } = req.body;

        // Verificar que el residente que hace la solicitud es principal
        const residentePrincipal = await Residente.findOne({
            user_id: req.userId,
            es_principal: true,
            estatus: 'activo'
        });

        if (!residentePrincipal) {
            return res.status(403).json({
                success: false,
                message: 'Solo residentes principales pueden activar/desactivar usuarios'
            });
        }

        // Verificar que el residente objetivo fue creado por este principal
        const residenteSecundario = await Residente.findOne({
            _id: residenteId,
            creado_por_residente_id: residentePrincipal._id
        }).populate('user_id');

        if (!residenteSecundario) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado o no tienes permisos'
            });
        }

        // Actualizar estatus
        residenteSecundario.estatus = activar ? 'activo' : 'inactivo';
        await residenteSecundario.save();

        // Actualizar estatus del usuario
        await User.findByIdAndUpdate(
            residenteSecundario.user_id._id,
            { estatus: activar ? 'activo' : 'inactivo' }
        );

        // Enviar notificación al residente afectado
        await NotificationService.sendNotification({
            userId: residenteSecundario.user_id._id,
            tipo: 'push',
            titulo: activar ? '✅ Cuenta activada' : '⚠️ Cuenta desactivada',
            mensaje: activar 
                ? 'Tu cuenta de residente ha sido activada.' 
                : 'Tu cuenta de residente ha sido desactivada.',
            data: { 
                tipo: 'resident', 
                action: activar ? 'activated' : 'deactivated'
            }
        });

        res.json({
            success: true,
            message: activar 
                ? 'Residente activado exitosamente' 
                : 'Residente desactivado exitosamente',
            residente: {
                id: residenteSecundario._id,
                estatus: residenteSecundario.estatus,
                user: {
                    nombre: residenteSecundario.user_id.nombre,
                    apellido: residenteSecundario.user_id.apellido
                }
            }
        });
    }),

    // En residents.controller.js, agregar estos métodos al export:

    /**
     * Obtener residentes morosos con información detallada
     */
    getMorososDetallado: catchAsync(async (req, res) => {
        const { 
            page = 1, 
            limit = 20, 
            dias_minimos = 0,
            solo_suspendibles = false 
        } = req.query;
        
        const skip = (page - 1) * limit;

        // Construir query base
        let query = { es_moroso: true, monto_adeudado: { $gt: 0 } };

        // Filtrar por días mínimos
        if (dias_minimos > 0) {
            const fechaLimite = new Date(Date.now() - dias_minimos * 24 * 60 * 60 * 1000);
            query.fecha_primer_morosidad = { $lte: fechaLimite };
        }

        // Solo suspendibles (>=60 días)
        if (solo_suspendibles === 'true') {
            const sesentaDiasAtras = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            query.fecha_primer_morosidad = { $lte: sesentaDiasAtras };
            query.suspendido_por_morosidad = false;
        }

        const [morosidades, total] = await Promise.all([
            ResidenteMorosidad.find(query)
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'user_id',
                        select: 'nombre apellido email telefono estatus'
                    }
                })
                .sort({ dias_morosidad: -1, monto_adeudado: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            ResidenteMorosidad.countDocuments(query)
        ]);

        // Formatear respuesta
        const residentesFormateados = morosidades
            .filter(m => m.residente_id) // Filtrar nulls
            .map(m => {
                const residente = m.residente_id;
                const diasMoroso = m.dias_morosidad;
                const puedeSuspender = diasMoroso >= 60 && !m.suspendido_por_morosidad;

                return {
                    id: residente._id,
                    user_id: residente.user_id._id,
                    nombre: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                    email: residente.user_id.email,
                    telefono: residente.user_id.telefono,
                    estatus_residente: residente.estatus,
                    estatus_usuario: residente.user_id.estatus,
                    morosidad: {
                        monto_adeudado: m.monto_adeudado,
                        dias_morosidad: diasMoroso,
                        fecha_primer_morosidad: m.fecha_primer_morosidad,
                        suspendido_por_morosidad: m.suspendido_por_morosidad,
                        fecha_suspension: m.fecha_suspension,
                        motivo_suspension: m.motivo_suspension,
                        puede_suspender: puedeSuspender,
                        dias_faltantes: puedeSuspender ? 0 : Math.max(0, 60 - diasMoroso)
                    },
                    acciones: {
                        puede_suspender: puedeSuspender && residente.estatus === 'activo',
                        puede_reactivar: residente.estatus === 'suspendido' || residente.estatus === 'inactivo',
                        ya_suspendido: m.suspendido_por_morosidad
                    }
                };
            });

        // Estadísticas
        const totalMorosos = await ResidenteMorosidad.countDocuments({ es_moroso: true });
        const morososSuspendibles = await ResidenteMorosidad.countDocuments({
            es_moroso: true,
            dias_morosidad: { $gte: 60 },
            suspendido_por_morosidad: false
        });
        const yaSuspendidos = await ResidenteMorosidad.countDocuments({
            es_moroso: true,
            suspendido_por_morosidad: true
        });

        res.json({
            success: true,
            residentes: residentesFormateados,
            estadisticas: {
                total_morosos,
                morosos_suspendibles,
                ya_suspendidos,
                total_activos_morosos: totalMorosos - yaSuspendidos
            },
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Suspender residente por morosidad (individual)
     */
    suspendResidentForMorosidad: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { motivo = 'Morosidad' } = req.body;

        // Buscar residente con información completa
        const residente = await Residente.findById(id)
            .populate('user_id');
        
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Verificar morosidad
        const morosidad = await ResidenteMorosidad.findOne({ 
            residente_id: id,
            es_moroso: true,
            monto_adeudado: { $gt: 0 }
        });
        
        if (!morosidad) {
            return res.status(400).json({
                success: false,
                message: 'El residente no tiene morosidad activa'
            });
        }

        // Verificar que no esté ya suspendido
        if (residente.estatus === 'suspendido') {
            return res.status(400).json({
                success: false,
                message: 'El residente ya está suspendido'
            });
        }

        // Verificar que tenga al menos 60 días de morosidad (excepto si es manual por admin)
        if (morosidad.dias_morosidad < 60) {
            // Si el admin quiere suspender antes, se permite pero se registra
            console.log(`⚠️ Admin suspendiendo residente con solo ${morosidad.dias_morosidad} días de morosidad`);
        }

        // Guardar estado anterior para posible rollback
        const estadoAnterior = {
            residente: residente.estatus,
            usuario: residente.user_id.estatus
        };

        try {
            // Suspender residente
            residente.estatus = 'suspendido';
            await residente.save();

            // Actualizar morosidad
            morosidad.suspendido_por_morosidad = true;
            morosidad.fecha_suspension = new Date();
            morosidad.motivo_suspension = motivo || 'Suspensión manual por administrador';
            await morosidad.save();

            // Suspender usuario asociado
            await User.findByIdAndUpdate(residente.user_id._id, {
                estatus: 'suspendido'
            });

            // Registrar auditoría
            const { AuditoriaGeneral } = await import('../models/auditoriaGeneral.model.js');
            await AuditoriaGeneral.create({
                usuario_id: req.userId,
                accion: 'SUSPENDER_RESIDENTE_MOROSO',
                detalle: {
                    residente_id: residente._id,
                    motivo,
                    dias_morosidad: morosidad.dias_morosidad,
                    monto_adeudado: morosidad.monto_adeudado,
                    estado_anterior: estadoAnterior
                },
                ip: req.ip
            });

            // Notificar al residente
            await NotificationService.sendNotification({
                userId: residente.user_id._id,
                tipo: 'push',
                titulo: '⛔ Acceso suspendido por morosidad',
                mensaje: `Tu acceso ha sido suspendido. Motivo: ${motivo}`,
                data: { 
                    tipo: 'morosidad', 
                    action: 'suspended_manual',
                    motivo,
                    fecha_suspension: new Date(),
                    monto_adeudado: morosidad.monto_adeudado,
                    dias_morosidad: morosidad.dias_morosidad
                }
            });

            res.json({
                success: true,
                message: 'Residente suspendido por morosidad',
                residente: {
                    id: residente._id,
                    nombre: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                    estatus: residente.estatus,
                    fecha_suspension: new Date(),
                    motivo,
                    morosidad: {
                        monto_adeudado: morosidad.monto_adeudado,
                        dias_morosidad: morosidad.dias_morosidad
                    }
                }
            });

        } catch (error) {
            // Rollback en caso de error
            await Residente.findByIdAndUpdate(id, { estatus: estadoAnterior.residente });
            await User.findByIdAndUpdate(residente.user_id._id, { estatus: estadoAnterior.usuario });
            
            console.error('Error suspendiendo residente:', error);
            return res.status(500).json({
                success: false,
                message: 'Error al suspender residente'
            });
        }
    }),

    /**
     * Suspender TODOS los residentes morosos (>60 días)
     */
    suspendAllMorosos: catchAsync(async (req, res) => {
        const { motivo = 'Morosidad colectiva (>60 días)' } = req.body;

        // Buscar residentes morosos por más de 60 días y no suspendidos
        const sesentaDiasAtras = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        
        const morosidades = await ResidenteMorosidad.find({
            es_moroso: true,
            fecha_primer_morosidad: { $lte: sesentaDiasAtras },
            suspendido_por_morosidad: false,
            monto_adeudado: { $gt: 0 }
        }).populate('residente_id');

        const resultados = [];
        const errores = [];

        for (const morosidad of morosidades) {
            try {
                const residente = morosidad.residente_id;
                
                // Verificar que el residente exista y esté activo
                if (!residente || residente.estatus !== 'activo') {
                    errores.push({
                        residente_id: morosidad.residente_id._id,
                        error: 'Residente no encontrado o ya suspendido'
                    });
                    continue;
                }

                // Guardar estado anterior
                const estadoAnterior = residente.estatus;

                // Suspender residente
                residente.estatus = 'suspendido';
                await residente.save();

                // Actualizar morosidad
                morosidad.suspendido_por_morosidad = true;
                morosidad.fecha_suspension = new Date();
                morosidad.motivo_suspension = motivo;
                await morosidad.save();

                // Suspender usuario
                await User.findByIdAndUpdate(residente.user_id._id, {
                    estatus: 'suspendido'
                });

                resultados.push({
                    residente_id: residente._id,
                    nombre: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                    monto_adeudado: morosidad.monto_adeudado,
                    dias_morosidad: morosidad.dias_morosidad,
                    suspendido: true,
                    estado_anterior: estadoAnterior
                });

                // Notificar
                await NotificationService.sendNotification({
                    userId: residente.user_id._id,
                    tipo: 'push',
                    titulo: '⛔ Acceso suspendido por morosidad',
                    mensaje: `Tu acceso ha sido suspendido por morosidad de más de 2 meses. Motivo: ${motivo}`,
                    data: { 
                        tipo: 'morosidad', 
                        action: 'suspended_mass',
                        motivo,
                        monto_adeudado: morosidad.monto_adeudado
                    }
                });

            } catch (error) {
                errores.push({
                    residente_id: morosidad.residente_id?._id || 'desconocido',
                    error: error.message
                });
                console.error(`Error suspendiendo residente ${morosidad.residente_id?._id}:`, error);
            }
        }

        // Registrar auditoría masiva
        if (resultados.length > 0) {
            const { AuditoriaGeneral } = await import('../models/auditoriaGeneral.model.js');
            await AuditoriaGeneral.create({
                usuario_id: req.userId,
                accion: 'SUSPENDER_TODOS_MOROSOS',
                detalle: {
                    total_suspendidos: resultados.length,
                    total_errores: errores.length,
                    motivo,
                    resultados: resultados.map(r => ({
                        residente_id: r.residente_id,
                        nombre: r.nombre
                    }))
                },
                ip: req.ip
            });
        }

        res.json({
            success: true,
            message: `Suspensión masiva completada`,
            resultados: {
                total_procesados: morosidades.length,
                suspendidos: resultados.length,
                errores: errores.length,
                detalles: {
                    exitosos: resultados,
                    fallidos: errores
                }
            }
        });
    }),

    /**
     * Reactivar residente suspendido
     */
    reactivateResident: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { motivo = 'Reactivación manual' } = req.body;

        const residente = await Residente.findById(id)
            .populate('user_id');
        
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Verificar que esté suspendido o inactivo
        if (residente.estatus === 'activo') {
            return res.status(400).json({
                success: false,
                message: 'El residente ya está activo'
            });
        }

        // Guardar estado anterior
        const estadoAnterior = residente.estatus;

        // Reactivar residente
        residente.estatus = 'activo';
        await residente.save();

        // Reactivar usuario
        await User.findByIdAndUpdate(residente.user_id._id, {
            estatus: 'activo'
        });

        // Actualizar morosidad si estaba suspendido por eso
        const morosidad = await ResidenteMorosidad.findOne({ residente_id: id });
        if (morosidad && morosidad.suspendido_por_morosidad) {
            morosidad.suspendido_por_morosidad = false;
            morosidad.motivo_suspension = `${morosidad.motivo_suspension} - Reactivado: ${motivo}`;
            await morosidad.save();
        }

        // Registrar auditoría
        const { AuditoriaGeneral } = await import('../models/auditoriaGeneral.model.js');
        await AuditoriaGeneral.create({
            usuario_id: req.userId,
            accion: 'REACTIVAR_RESIDENTE',
            detalle: {
                residente_id: residente._id,
                motivo,
                estado_anterior: estadoAnterior,
                estado_nuevo: 'activo'
            },
            ip: req.ip
        });

        // Notificar al residente
        await NotificationService.sendNotification({
            userId: residente.user_id._id,
            tipo: 'push',
            titulo: '✅ Cuenta reactivada',
            mensaje: `Tu acceso ha sido reactivado. Motivo: ${motivo}`,
            data: { 
                tipo: 'resident', 
                action: 'reactivated',
                motivo
            }
        });

        res.json({
            success: true,
            message: 'Residente reactivado exitosamente',
            residente: {
                id: residente._id,
                nombre: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                estatus: residente.estatus,
                estado_anterior: estadoAnterior,
                fecha_reactivacion: new Date()
            }
        });
    }),

    /**
     * Actualizar monto de morosidad de un residente
     */
    updateMorosidad: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { monto_adeudado, motivo } = req.body;

        // Verificar que el residente existe
        const residente = await Residente.findById(id);
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Buscar o crear registro de morosidad
        let morosidad = await ResidenteMorosidad.findOne({ residente_id: id });
        
        if (!morosidad) {
            morosidad = await ResidenteMorosidad.create({
                residente_id: id,
                monto_adeudado: monto_adeudado || 0
            });
        } else {
            const montoAnterior = morosidad.monto_adeudado;
            morosidad.monto_adeudado = monto_adeudado || 0;
            await morosidad.save();

            // Registrar auditoría del cambio
            const { AuditoriaGeneral } = await import('../models/auditoriaGeneral.model.js');
            await AuditoriaGeneral.create({
                usuario_id: req.userId,
                accion: 'ACTUALIZAR_MOROSIDAD',
                detalle: {
                    residente_id: id,
                    monto_anterior: montoAnterior,
                    monto_nuevo: monto_adeudado,
                    motivo,
                    cambio: monto_adeudado - montoAnterior
                },
                ip: req.ip
            });

            // Notificar al residente si el monto aumentó
            if (monto_adeudado > montoAnterior) {
                await NotificationService.sendNotification({
                    userId: residente.user_id,
                    tipo: 'push',
                    titulo: '💰 Actualización de morosidad',
                    mensaje: `Tu morosidad ha sido actualizada. Nuevo monto: $${monto_adeudado}`,
                    data: { 
                        tipo: 'morosidad', 
                        action: 'updated',
                        monto_anterior: montoAnterior,
                        monto_nuevo: monto_adeudado
                    }
                });
            }
        }

        res.json({
            success: true,
            message: 'Morosidad actualizada',
            morosidad
        });
    }),

    };