import { Evento } from '../models/evento.model.js';
import { Residente } from '../models/residente.model.js';
import QRService from '../libs/qrGenerator.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import { EstadoRecepcion } from '../models/estadoRecepcion.model.js';

export const eventsController = {
    /**
     * Crear nuevo evento (desde app residente)
     */
    createEvent: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const {
            nombre_evento,
            descripcion,
            ubicacion,
            fecha_inicio,
            fecha_fin,
            max_invitados = 0,
            es_qr_compartido = true
        } = req.body;

        // Validar fechas
        if (new Date(fecha_inicio) >= new Date(fecha_fin)) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de fin debe ser posterior a la fecha de inicio'
            });
        }

        // Crear evento
        const evento = await Evento.create({
            residente_id: residenteId,
            nombre_evento,
            descripcion,
            ubicacion,
            fecha_inicio: new Date(fecha_inicio),
            fecha_fin: new Date(fecha_fin),
            max_invitados,
            es_qr_compartido
        });

        // Si es QR compartido, generar QR único para el evento
        if (es_qr_compartido) {
            const qrData = await QRService.generateQRForEvent(
                evento._id,
                max_invitados
            );
            
            evento.codigo_qr_evento = qrData.qrDataURL;
            await evento.save();
        }

        res.status(201).json({
            success: true,
            message: 'Evento creado exitosamente',
            evento,
            qr_compartido: es_qr_compartido ? evento.codigo_qr_evento : null
        });
    }),

    /**
     * Obtener eventos de un residente
     */
    getResidentEvents: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { activos = true } = req.query;

        let query = { residente_id: residenteId };

        if (activos === 'true') {
            query.fecha_fin = { $gte: new Date() };
        }

        const eventos = await Evento.find(query)
            .sort({ fecha_inicio: 1 });

        res.json({
            success: true,
            eventos
        });
    }),

    /**
     * Obtener detalles de un evento
     */
    getEventById: catchAsync(async (req, res) => {
        const { id } = req.params;
        const residenteId = req.residenteId;

        const evento = await Evento.findOne({
            _id: id,
            residente_id: residenteId
        });

        if (!evento) {
            return res.status(404).json({
                success: false,
                message: 'Evento no encontrado'
            });
        }

        // Obtener autorizaciones vinculadas a este evento
        const { AutorizacionVisita } = await import('../models/autorizacionVisita.model.js');
        const autorizaciones = await AutorizacionVisita.find({
            evento_id: evento._id
        }).populate('nombre_visitante');

        res.json({
            success: true,
            evento,
            autorizaciones,
            capacidad: evento.max_invitados > 0 ? 
                `${evento.invitados_registrados}/${evento.max_invitados}` : 
                'Ilimitado'
        });
    }),

    registerEventAccess: catchAsync(async (req, res) => {
    const { 
        event_qr, 
        nombre_invitado,
        observaciones 
    } = req.body;

    if (!event_qr) {
        return res.status(400).json({
            success: false,
            message: 'Se requiere código QR del evento'
        });
    }

    let payload;
    try {
        // Decodificar QR del evento
        payload = JSON.parse(event_qr);
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: 'QR de evento inválido'
        });
    }

    // Validar payload del evento
    const qrResult = QRService.validateEventQRPayload(payload);
    if (!qrResult.valid) {
        return res.status(400).json({
            success: false,
            message: qrResult.reason
        });
    }

    // Buscar evento
    const evento = await Evento.findById(qrResult.eventId);
    if (!evento) {
        return res.status(404).json({
            success: false,
            message: 'Evento no encontrado'
        });
    }

    // Verificar que el evento esté activo
    const ahora = new Date();
    if (ahora < evento.fecha_inicio || ahora > evento.fecha_fin) {
        return res.status(400).json({
            success: false,
            message: 'El evento no está activo en este momento'
        });
    }

    // Verificar límite de invitados
    if (!evento.puedeAceptarInvitado()) {
        return res.status(400).json({
            success: false,
            message: 'El evento ha alcanzado el límite máximo de invitados'
        });
    }

    // Verificar estado de recepción del residente
    const estadoRecepcion = await EstadoRecepcion.findOne({ 
        residente_id: evento.residente_id 
    });

    if (estadoRecepcion && !estadoRecepcion.recibiendo_visitas) {
        return res.status(400).json({
            success: false,
            message: 'El residente no está recibiendo visitas'
        });
    }

    // Registrar invitado
    await evento.registrarInvitado();

    // Importar modelos necesarios dinámicamente
    const { RegistroAcceso } = await import('../models/registroAcceso.model.js');
    const NotificationService = await import('../libs/notifications.js').then(m => m.default);
    const Utils = await import('../libs/utils.js').then(m => m.default);

    // Registrar acceso
    const registroAcceso = await RegistroAcceso.create({
        nombre_visitante: nombre_invitado || 'Invitado de evento',
        tipo_acceso: 'evento',
        residente_id: evento.residente_id,
        evento_id: evento._id,
        metodo_acceso: 'qr_evento_compartido',
        fecha_hora_ingreso: ahora,
        usuario_caseta_id: req.userId,
        estado: 'permitido',
        observaciones
    });

    // Notificar al residente
    const residente = await Residente.findById(evento.residente_id)
        .populate('user_id');

    if (residente && residente.user_id) {
        await NotificationService.sendNotification({
    userId: residente.user_id._id,
    tipo: 'push',
    titulo: '🚪 Visitante en acceso',
    mensaje: `${nombre_invitado || 'Invitado'} está ingresando al evento`,
    data: {
        tipo: 'visita',
        nombreVisitante: nombre_invitado || 'Invitado',
        tipoVisita: 'evento',
        hora: Utils.formatDate(ahora, true),
        permitido: true,
        eventoId: evento._id,
        eventoNombre: evento.nombre_evento,
        action: 'ver_visita'
    },
    accionRequerida: false
});
    }

    res.json({
        success: true,
        message: 'Acceso al evento registrado exitosamente',
        registro: registroAcceso,
        evento: {
            nombre: evento.nombre_evento,
            invitados_registrados: evento.invitados_registrados,
            cupos_restantes: evento.max_invitados === 0 ? 
                'Ilimitado' : 
                evento.max_invitados - evento.invitados_registrados
        }
    });
}),

    /**
     * Obtener eventos próximos para caseta
     */
    getUpcomingEventsForGatehouse: catchAsync(async (req, res) => {
        const ahora = new Date();
        const finDia = new Date();
        finDia.setHours(23, 59, 59, 999);

        // Buscar eventos activos hoy
        const eventos = await Evento.find({
            fecha_inicio: { $lte: finDia },
            fecha_fin: { $gte: ahora },
            es_qr_compartido: true
        })
        .populate('residente_id')
        .populate({
            path: 'residente_id',
            populate: {
                path: 'user_id',
                select: 'nombre apellido'
            }
        })
        .sort({ fecha_inicio: 1 });

        // Formatear respuesta
        const eventosFormateados = eventos.map(evento => ({
            id: evento._id,
            nombre_evento: evento.nombre_evento,
            residente: evento.residente_id?.user_id?.nombre + ' ' + 
                      evento.residente_id?.user_id?.apellido,
            ubicacion: evento.ubicacion,
            fecha_inicio: evento.fecha_inicio,
            fecha_fin: evento.fecha_fin,
            invitados_registrados: evento.invitados_registrados,
            max_invitados: evento.max_invitados,
            capacidad: evento.max_invitados === 0 ? 
                'Ilimitado' : 
                `${evento.invitados_registrados}/${evento.max_invitados}`,
            esta_activo: ahora >= evento.fecha_inicio && ahora <= evento.fecha_fin
        }));

        res.json({
            success: true,
            eventos: eventosFormateados
        });
    }),


    /**
     * Crear autorización individual para evento (para eventos NO compartidos)
     */
    createEventAuthorization: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { id: evento_id } = req.params;
        const { nombre_visitante, telefono_visitante } = req.body;

        // Verificar que el evento exista y pertenezca al residente
        const evento = await Evento.findOne({
            _id: evento_id,
            residente_id: residenteId
        });

        if (!evento) {
            return res.status(404).json({
                success: false,
                message: 'Evento no encontrado'
            });
        }

        // Verificar límite de invitados
        if (!evento.puedeAceptarInvitado()) {
            return res.status(400).json({
                success: false,
                message: 'El evento ha alcanzado el límite máximo de invitados'
            });
        }

        // Obtener tipo de visita "evento"
        const { TipoVisita } = await import('../models/tipoVisita.model.js');
        const tipoEvento = await TipoVisita.findOne({ nombre: 'evento' });
        if (!tipoEvento) {
            return res.status(500).json({
                success: false,
                message: 'Tipo de visita "evento" no configurado'
            });
        }

        // Importar modelos necesarios
        const { AutorizacionVisita } = await import('../models/autorizacionVisita.model.js');
        const { Proveedor } = await import('../models/proveedor.model.js');
        const { Personal } = await import('../models/personal.model.js');

        // Crear autorización
        const autorizacion = await AutorizacionVisita.create({
            residente_id: residenteId,
            tipo_visita_id: tipoEvento._id,
            evento_id: evento._id,
            nombre_visitante,
            telefono_visitante,
            fecha_inicio_vigencia: evento.fecha_inicio,
            fecha_fin_vigencia: evento.fecha_fin,
            limite_ingresos: 1,
            ingresos_disponibles: 1,
            es_acceso_evento: true,
            usuario_creador_id: req.userId
        });

        // Registrar invitado en el evento
        await evento.registrarInvitado();

        // Generar QR
        const qrData = await QRService.generateQRForAuthorization(
            autorizacion._id,
            residenteId,
            {
                tipoVisita: 'evento',
                nombreVisitante: nombre_visitante,
                eventoId: evento._id
            }
        );

        // Generar código de texto
        const textCode = QRService.generateTextCode(autorizacion._id);

        // Actualizar autorización con códigos
        autorizacion.codigo_acceso = textCode;
        autorizacion.qr_code = qrData.qrDataURL;
        await autorizacion.save();

        res.status(201).json({
            success: true,
            message: 'Invitación para evento creada exitosamente',
            autorizacion: {
                id: autorizacion._id,
                nombre_visitante: autorizacion.nombre_visitante,
                evento: evento.nombre_evento,
                fecha_evento: evento.fecha_inicio
            },
            qr_code: qrData.qrDataURL,
            text_code: textCode
        });
    })
};