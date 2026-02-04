import { Conversacion } from '../models/conversacion.model.js';
import { Mensaje } from '../models/mensaje.model.js';
import { Publicacion } from '../models/publicacion.model.js';
import { DestinatarioPublicacion } from '../models/destinatarioPublicacion.model.js';
import { Residente } from '../models/residente.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import { CalleTorre } from '../models/calleTorre.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';
import mongoose from 'mongoose';

export const communicationsController = {
    /**
     * Enviar mensaje a caseta
     */
    sendMessageToCaseta: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { mensaje, asunto } = req.body;

        // Buscar o crear conversación con caseta
        const usuariosCaseta = await UserRole.find({ role: 'caseta' })
            .distinct('user_id');

        if (usuariosCaseta.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No hay personal de caseta disponible'
            });
        }

        // Para simplificar, usar el primer usuario de caseta
        // En producción, podrías implementar un sistema de turnos
        const usuarioCasetaId = usuariosCaseta[0];

        // Buscar conversación existente
        let conversacion = await Conversacion.findOne({
            tipo: 'caseta',
            residente_id: residenteId,
            usuario_id: usuarioCasetaId
        });

        // Si no existe, crear nueva conversación
        if (!conversacion) {
            conversacion = await Conversacion.create({
                tipo: 'caseta',
                residente_id: residenteId,
                usuario_id: usuarioCasetaId,
                asunto: asunto || 'Consulta con caseta',
                estatus: 'abierta'
            });
        }

        // Crear mensaje
        const nuevoMensaje = await Mensaje.create({
            conversacion_id: conversacion._id,
            remitente_id: req.userId,
            mensaje,
            tipo: 'texto',
            leido: false
        });

        // Actualizar última actividad
        conversacion.ultimo_mensaje_at = new Date();
        await conversacion.save();

        // Enviar notificación al personal de caseta
        const residente = await Residente.findById(residenteId)
            .populate('user_id');
        
        for (const casetaUserId of usuariosCaseta) {
            await NotificationService.sendNotification({
                userId: casetaUserId,
                tipo: 'push',
                titulo: '💬 Nuevo mensaje',
                mensaje: `${residente.user_id.nombre} ${residente.user_id.apellido}: ${mensaje.length > 50 ? mensaje.substring(0, 50) + '...' : mensaje}`,
                data: {
                    tipo: 'chat',
                    remitente: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                    mensajePreview: mensaje.length > 50 ? mensaje.substring(0, 50) + '...' : mensaje,
                    conversacionId: conversacion._id.toString(),
                    action: 'responder_chat'
                },
                accionRequerida: true,
                accionTipo: 'responder_chat',
                accionData: { conversacionId: conversacion._id.toString() }
            });
        }

        res.status(201).json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            mensaje: nuevoMensaje,
            conversacion_id: conversacion._id
        });
    }),

    /**
     * Enviar mensaje a administrador
     */
    sendMessageToAdmin: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { mensaje, asunto } = req.body;

        // Buscar usuarios administradores
        const usuariosAdmin = await UserRole.find({ role: 'administrador' })
            .distinct('user_id');

        if (usuariosAdmin.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No hay administradores disponibles'
            });
        }

        // Para simplificar, usar el primer administrador
        const usuarioAdminId = usuariosAdmin[0];

        // Buscar conversación existente
        let conversacion = await Conversacion.findOne({
            tipo: 'administrador',
            residente_id: residenteId,
            usuario_id: usuarioAdminId
        });

        // Si no existe, crear nueva conversación
        if (!conversacion) {
            conversacion = await Conversacion.create({
                tipo: 'administrador',
                residente_id: residenteId,
                usuario_id: usuarioAdminId,
                asunto: asunto || 'Consulta con administración',
                estatus: 'abierta'
            });
        }

        // Crear mensaje
        const nuevoMensaje = await Mensaje.create({
            conversacion_id: conversacion._id,
            remitente_id: req.userId,
            mensaje,
            tipo: 'texto',
            leido: false
        });

        // Actualizar última actividad
        conversacion.ultimo_mensaje_at = new Date();
        await conversacion.save();

        // Enviar notificación a administradores
        const residente = await Residente.findById(residenteId)
            .populate('user_id');
        
        for (const adminUserId of usuariosAdmin) {
            await NotificationService.notifications.nuevoMensaje(
                adminUserId,
                {
                    remitente: `${residente.user_id.nombre} ${residente.user_id.apellido}`,
                    mensajePreview: mensaje.length > 50 ? mensaje.substring(0, 50) + '...' : mensaje,
                    conversacionId: conversacion._id
                }
            );
        }

        res.status(201).json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            mensaje: nuevoMensaje,
            conversacion_id: conversacion._id
        });
    }),

    /**
     * Obtener conversaciones de un usuario
     */
    getUserConversations: catchAsync(async (req, res) => {
        const userId = req.userId;
        const { tipo } = req.query;

        // Construir query según el tipo de usuario
        let query = {};

        if (req.userRoles.includes('residente')) {
            // Residentes ven conversaciones donde son el residente
            const residente = await Residente.findOne({ user_id: userId });
            if (!residente) {
                return res.json({
                    success: true,
                    conversaciones: []
                });
            }

            query.residente_id = residente._id;
        } else {
            // Administradores y caseta ven conversaciones donde son el usuario
            query.usuario_id = userId;
        }

        // Filtro por tipo
        if (tipo) {
            query.tipo = tipo;
        }

        // Obtener conversaciones
        const conversaciones = await Conversacion.find(query)
            .populate('residente_id', 'user_id')
            .populate({
                path: 'residente_id',
                populate: {
                    path: 'user_id',
                    select: 'nombre apellido'
                }
            })
            .populate('usuario_id', 'nombre apellido')
            .sort({ ultimo_mensaje_at: -1 });

        // Contar mensajes no leídos para cada conversación
        const conversacionesConInfo = await Promise.all(
            conversaciones.map(async (conv) => {
                const mensajesNoLeidos = await Mensaje.countDocuments({
                    conversacion_id: conv._id,
                    remitente_id: { $ne: userId },
                    leido: false
                });

                return {
                    ...conv.toObject(),
                    mensajes_no_leidos: mensajesNoLeidos
                };
            })
        );

        res.json({
            success: true,
            conversaciones: conversacionesConInfo
        });
    }),

    /**
     * Obtener mensajes de una conversación
     */
    getConversationMessages: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;

        // Verificar que el usuario tenga acceso a la conversación
        const conversacion = await Conversacion.findById(id);
        if (!conversacion) {
            return res.status(404).json({
                success: false,
                message: 'Conversación no encontrada'
            });
        }

        // Validar acceso
        let tieneAcceso = false;
        
        if (req.userRoles.includes('residente')) {
            const residente = await Residente.findOne({ user_id: req.userId });
            tieneAcceso = residente && residente._id.equals(conversacion.residente_id);
        } else {
            tieneAcceso = conversacion.usuario_id.equals(req.userId);
        }

        if (!tieneAcceso) {
            return res.status(403).json({
                success: false,
                message: 'No tienes acceso a esta conversación'
            });
        }

        // Obtener mensajes
        const [mensajes, total] = await Promise.all([
            Mensaje.find({ conversacion_id: id })
                .populate('remitente_id', 'nombre apellido')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Mensaje.countDocuments({ conversacion_id: id })
        ]);

        // Marcar mensajes como leídos (solo los que no son del usuario actual)
        await Mensaje.updateMany(
            {
                conversacion_id: id,
                remitente_id: { $ne: req.userId },
                leido: false
            },
            {
                leido: true,
                fecha_leido: new Date()
            }
        );

        // Invertir orden para mostrar del más antiguo al más reciente
        const mensajesOrdenados = mensajes.reverse();

        res.json({
            success: true,
            mensajes: mensajesOrdenados,
            conversacion,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Enviar mensaje en una conversación existente
     */
    sendMessage: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { mensaje, tipo = 'texto', archivo_url } = req.body;

        // Verificar que la conversación existe
        const conversacion = await Conversacion.findById(id);
        if (!conversacion) {
            return res.status(404).json({
                success: false,
                message: 'Conversación no encontrada'
            });
        }

        // Validar acceso
        let tieneAcceso = false;
        let destinatarioId = null;
        
        if (req.userRoles.includes('residente')) {
            const residente = await Residente.findOne({ user_id: req.userId });
            tieneAcceso = residente && residente._id.equals(conversacion.residente_id);
            destinatarioId = conversacion.usuario_id;
        } else {
            tieneAcceso = conversacion.usuario_id.equals(req.userId);
            destinatarioId = (await Residente.findById(conversacion.residente_id)).user_id;
        }

        if (!tieneAcceso) {
            return res.status(403).json({
                success: false,
                message: 'No tienes acceso a esta conversación'
            });
        }

        // Crear mensaje
        const nuevoMensaje = await Mensaje.create({
            conversacion_id: id,
            remitente_id: req.userId,
            mensaje,
            tipo,
            archivo_url,
            leido: false
        });

        // Actualizar conversación
        conversacion.ultimo_mensaje_at = new Date();
        await conversacion.save();

        // Enviar notificación al destinatario
        const remitente = await User.findById(req.userId);
        await NotificationService.notifications.nuevoMensaje(
            destinatarioId,
            {
                remitente: `${remitente.nombre} ${remitente.apellido}`,
                mensajePreview: mensaje.length > 50 ? mensaje.substring(0, 50) + '...' : mensaje,
                conversacionId: conversacion._id
            }
        );

        res.status(201).json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            mensaje: nuevoMensaje
        });
    }),

    /**
     * Crear nueva publicación/boletín
     */
    createPublication: catchAsync(async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { 
            titulo, 
            contenido, 
            tipo = 'boletin', 
            adjunto_url,
            programado = false,
            fecha_programada,
            prioridad = 'normal',
            destinatarios 
        } = req.body;

        // 1. Crear publicación
        const [publicacion] = await Publicacion.create([{
            usuario_id: req.userId,
            titulo,
            contenido,
            tipo,
            adjunto_url,
            programado,
            fecha_programada: programado && fecha_programada ? new Date(fecha_programada) : null,
            prioridad,
            notificaciones_enviadas: false
        }], { session });

        // 2. Crear destinatarios
        if (destinatarios && Array.isArray(destinatarios)) {
            const destinatariosDocs = destinatarios.map(dest => ({
                publicacion_id: publicacion._id,
                tipo_destino: dest.tipo,
                calle_torre_id: dest.calle_torre_id,
                domicilio_id: dest.domicilio_id
            }));

            await DestinatarioPublicacion.create(destinatariosDocs, { session });
        }

        await session.commitTransaction();
        session.endSession();

        // 3. Enviar notificaciones (FUERA de la transacción)
        if (!programado) {
            await communicationsController.sendPublicationNotifications(publicacion._id);
        }

        res.status(201).json({
            success: true,
            message: 'Publicación creada exitosamente',
            publicacion
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
}),


    /**
     * Helper para enviar notificaciones de publicación
     */
    sendPublicationNotifications: async (publicacionId) => {
    const publicacion = await Publicacion.findById(publicacionId);
    if (!publicacion || publicacion.notificaciones_enviadas) return;

    const destinatarios = await DestinatarioPublicacion.find({ 
        publicacion_id: publicacionId 
    });

    let residentesIds = [];

    for (const dest of destinatarios) {
        switch (dest.tipo_destino) {
            case 'todos': {
                const ids = await Residente.find({ estatus: 'activo' })
                    .distinct('user_id');
                residentesIds.push(...ids);
                break;
            }
            case 'calle': {
                const domicilios = await Domicilio.find({
                    calle_torre_id: dest.calle_torre_id
                }).distinct('_id');

                const ids = await Residente.find({
                    domicilio_id: { $in: domicilios },
                    estatus: 'activo'
                }).distinct('user_id');

                residentesIds.push(...ids);
                break;
            }
            case 'domicilio': {
                const ids = await Residente.find({
                    domicilio_id: dest.domicilio_id,
                    estatus: 'activo'
                }).distinct('user_id');

                residentesIds.push(...ids);
                break;
            }
        }
    }

    residentesIds = [...new Set(residentesIds)];

    await Promise.allSettled(
        residentesIds.map(userId =>
            NotificationService.sendNotification({
                userId,
                tipo: 'push',
                titulo: '📢 Nuevo boletín',
                mensaje: publicacion.titulo,
                data: {
                    tipo: 'boletin',
                    publicacionId: publicacion._id.toString()
                }
            })
        )
    );

    publicacion.notificaciones_enviadas = true;
    await publicacion.save();
},


    /**
     * Obtener publicaciones para un residente
     */
    getResidentPublications: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { 
            page = 1, 
            limit = 20,
            tipo,
            desde,
            hasta 
        } = req.query;

        const skip = (page - 1) * limit;

        // Obtener el residente y su domicilio
        const residente = await Residente.findById(residenteId);
        if (!residente) {
            return res.json({
                success: true,
                publicaciones: [],
                pagination: { total: 0 }
            });
        }

        // Buscar publicaciones dirigidas a este residente
        // 1. Publicaciones para todos
        const publicacionesTodos = await Publicacion.find({
            _id: {
                $in: (await DestinatarioPublicacion.find({ 
                    tipo_destino: 'todos' 
                })).map(p => p.publicacion_id)
            }
        });

        // 2. Publicaciones para su calle/torre
        const domicilio = await Domicilio.findById(residente.domicilio_id);
        const publicacionesCalle = await Publicacion.find({
            _id: {
                $in: (await DestinatarioPublicacion.find({ 
                    tipo_destino: 'calle',
                    calle_torre_id: domicilio.calle_torre_id
                })).map(p => p.publicacion_id)
            },
            fecha_expiracion: { $gte: new Date() }
        });

        // 3. Publicaciones para su domicilio específico
        const publicacionesDomicilio = await Publicacion.find({
            _id: {
                $in: (await DestinatarioPublicacion.find({ 
                    tipo_destino: 'domicilio',
                    domicilio_id: residente.domicilio_id
                })).map(p => p.publicacion_id)
            },
            fecha_expiracion: { $gte: new Date() }
        });

        // Combinar y eliminar duplicados
        const todasPublicaciones = [
            ...publicacionesTodos,
            ...publicacionesCalle,
            ...publicacionesDomicilio
        ];

        const publicacionesUnicas = todasPublicaciones.filter(
            (pub, index, self) => self.findIndex(p => p._id.equals(pub._id)) === index
        );

        // Aplicar filtros adicionales
        let publicacionesFiltradas = publicacionesUnicas;

        if (tipo) {
            publicacionesFiltradas = publicacionesFiltradas.filter(p => p.tipo === tipo);
        }

        if (desde) {
            const fechaDesde = new Date(desde);
            publicacionesFiltradas = publicacionesFiltradas.filter(p => 
                new Date(p.fecha_publicacion) >= fechaDesde
            );
        }

        if (hasta) {
            const fechaHasta = new Date(hasta);
            fechaHasta.setHours(23, 59, 59, 999);
            publicacionesFiltradas = publicacionesFiltradas.filter(p => 
                new Date(p.fecha_publicacion) <= fechaHasta
            );
        }

        // Ordenar por fecha de publicación (más recientes primero)
        publicacionesFiltradas.sort((a, b) => 
            new Date(b.fecha_publicacion) - new Date(a.fecha_publicacion)
        );

        // Paginación
        const total = publicacionesFiltradas.length;
        const publicacionesPaginadas = publicacionesFiltradas.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            publicaciones: publicacionesPaginadas,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Marcar publicación como leída
     */
    markPublicationAsRead: catchAsync(async (req, res) => {
        // En este sistema, las publicaciones no tienen estado de "leído"
        // Se considera que el residente las ve cuando las solicita
        // Podrías implementar tracking si es necesario
        
        res.json({
            success: true,
            message: 'Publicación marcada como vista'
        });
    }),

    /**
     * Cerrar conversación
     */
    closeConversation: catchAsync(async (req, res) => {
        const { id } = req.params;

        const conversacion = await Conversacion.findById(id);
        if (!conversacion) {
            return res.status(404).json({
                success: false,
                message: 'Conversación no encontrada'
            });
        }

        // Validar acceso
        let tieneAcceso = false;
        
        if (req.userRoles.includes('residente')) {
            const residente = await Residente.findOne({ user_id: req.userId });
            tieneAcceso = residente && residente._id.equals(conversacion.residente_id);
        } else {
            tieneAcceso = conversacion.usuario_id.equals(req.userId);
        }

        if (!tieneAcceso) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permisos para cerrar esta conversación'
            });
        }

        // Cerrar conversación
        conversacion.estatus = 'cerrada';
        await conversacion.save();

        res.json({
            success: true,
            message: 'Conversación cerrada exitosamente'
        });
    })
};