import { AutorizacionVisita } from '../models/autorizacionVisita.model.js';
import { RegistroAcceso } from '../models/registroAcceso.model.js';
import { TipoVisita } from '../models/tipoVisita.model.js';
import { Proveedor } from '../models/proveedor.model.js';
import { Evento } from '../models/evento.model.js';
import { Personal } from '../models/personal.model.js';
import { Residente } from '../models/residente.model.js';
import { EstadoRecepcion } from '../models/estadoRecepcion.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import QRService from '../libs/qrGenerator.js';
import NotificationService from '../libs/notifications.js';
import Utils from '../libs/utils.js';

export const visitsController = {
    /**
     * Crear nueva autorización de visita (desde app móvil de residente)
     */
    createVisitAuthorization: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const {
            tipo_visita_id,
            proveedor_id,
            evento_id,
            personal_id,
            nombre_visitante,
            telefono_visitante,
            fecha_inicio_vigencia,
            fecha_fin_vigencia,
            es_visita_unica = false,
            fecha_visita_unica,
            limite_ingresos = 1
        } = req.body;

        // Verificar tipo de visita
        const tipoVisita = await TipoVisita.findById(tipo_visita_id);
        if (!tipoVisita) {
            return res.status(404).json({
                success: false,
                message: 'Tipo de visita no encontrado'
            });
        }

        // Validaciones específicas por tipo
        if (tipoVisita.nombre === 'proveedor' && !proveedor_id) {
            return res.status(400).json({
                success: false,
                message: 'Para proveedores se requiere especificar el proveedor'
            });
        }

        if (tipoVisita.nombre === 'evento' && !evento_id) {
            return res.status(400).json({
                success: false,
                message: 'Para eventos se requiere especificar el evento'
            });
        }

        if (tipoVisita.nombre === 'personal' && !personal_id) {
            return res.status(400).json({
                success: false,
                message: 'Para personal se requiere especificar el personal'
            });
        }

        // Para eventos, verificar límite de invitados
        if (tipoVisita.nombre === 'evento' && evento_id) {
            const evento = await Evento.findById(evento_id);
            if (evento && !evento.puedeAceptarInvitado()) {
                return res.status(400).json({
                    success: false,
                    message: 'El evento ha alcanzado el límite máximo de invitados'
                });
            }
        }

        // Para personal, verificar que existe y pertenece al residente
        if (tipoVisita.nombre === 'personal' && personal_id) {
            const personal = await Personal.findOne({
                _id: personal_id,
                residente_id: residenteId,
                estatus: 'activo'
            });
            
            if (!personal) {
                return res.status(404).json({
                    success: false,
                    message: 'Personal no encontrado o no pertenece al residente'
                });
            }
        }

        // Para visitas únicas, ajustar fechas
        let fechaInicio, fechaFin;
        if (es_visita_unica && fecha_visita_unica) {
            fechaInicio = new Date(fecha_visita_unica);
            fechaFin = new Date(fecha_visita_unica);
            fechaFin.setHours(23, 59, 59, 999);
        } else {
            fechaInicio = new Date(fecha_inicio_vigencia);
            fechaFin = new Date(fecha_fin_vigencia);
        }

        let limiteIngresosFinal = limite_ingresos;

        if (tipoVisita.nombre === 'visitante_vip') {
            limiteIngresosFinal = 999;
        }

        // Crear autorización
        const autorizacionData = {
            residente_id: residenteId,
            tipo_visita_id,
            proveedor_id,
            evento_id,
            personal_id,
            nombre_visitante,
            telefono_visitante,
            fecha_inicio_vigencia: fechaInicio,
            fecha_fin_vigencia: fechaFin,
            es_visita_unica,
            fecha_visita_unica: es_visita_unica ? fechaInicio : null,
            limite_ingresos: limiteIngresosFinal,
            ingresos_disponibles: limite_ingresos,
            usuario_creador_id: req.userId
        };

        // Si es evento, marcar como acceso de evento
        if (tipoVisita.nombre === 'evento') {
            autorizacionData.es_acceso_evento = true;
        }

        const autorizacion = await AutorizacionVisita.create(autorizacionData);

        // Para eventos, registrar el invitado
        if (tipoVisita.nombre === 'evento' && evento_id) {
            const evento = await Evento.findById(evento_id);
            if (evento) {
                await evento.registrarInvitado();
            }
        }

        // Generar código QR
        const qrData = await QRService.generateQRForAuthorization(
            autorizacion._id,
            residenteId,
            {
                tipoVisita: tipoVisita.nombre,
                nombreVisitante: nombre_visitante || 
                               (proveedor_id ? (await Proveedor.findById(proveedor_id))?.nombre : null) ||
                               (personal_id ? (await Personal.findById(personal_id))?.nombre : null) ||
                               'Invitado'
            }
        );

        // Generar código de texto
        const textCode = QRService.generateTextCode(autorizacion._id);

        // Actualizar autorización con códigos
        autorizacion.codigo_acceso = textCode;
        autorizacion.qr_code = qrData.qrDataURL;
        await autorizacion.save();

        // Populate para respuesta
        const autorizacionCompleta = await AutorizacionVisita.findById(autorizacion._id)
            .populate('tipo_visita_id', 'nombre descripcion')
            .populate('proveedor_id', 'nombre servicio')
            .populate('evento_id', 'nombre_evento max_invitados invitados_registrados')
            .populate('personal_id', 'nombre tipo_servicio frecuencia') // 👈 NUEVO
            .populate('residente_id', 'user_id')
            .populate({
                path: 'residente_id',
                populate: {
                    path: 'user_id',
                    select: 'nombre apellido'
                }
            });

        // Enviar notificación al residente
        await NotificationService.sendNotification({
            userId: req.userId,
            tipo: 'in_app',
            titulo: '✅ Autorización creada',
            mensaje: `Has creado una autorización para ${nombre_visitante || tipoVisita.nombre}`,
            data: { 
                tipo: 'visita', 
                action: 'authorization_created',
                autorizacion_id: autorizacion._id.toString(),
                tipo_visita: tipoVisita.nombre
            }
        });

        res.status(201).json({
            success: true,
            message: 'Autorización de visita creada exitosamente',
            autorizacion: autorizacionCompleta,
            qr_code: qrData.qrDataURL,
            text_code: textCode,
            expiration: qrData.expirationDate
        });
    }),

    /**
     * Obtener autorizaciones de un residente
     */
    getResidentAuthorizations: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { 
            page = 1, 
            limit = 20, 
            estado,
            tipo_visita_id,
            activas = true 
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        let query = { residente_id: residenteId };

        // Filtro por estado
        if (estado) {
            query.estado = estado;
        } else if (activas === 'true') {
            query.estado = 'activa';
            query.fecha_fin_vigencia = { $gte: new Date() };
        }

        // Filtro por tipo de visita
        if (tipo_visita_id) {
            query.tipo_visita_id = tipo_visita_id;
        }

        // Obtener autorizaciones
        const [autorizaciones, total] = await Promise.all([
            AutorizacionVisita.find(query)
                .populate('tipo_visita_id', 'nombre descripcion')
                .populate('proveedor_id', 'nombre servicio')
                .populate('evento_id', 'nombre_evento')
                .sort({ fecha_creacion: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            AutorizacionVisita.countDocuments(query)
        ]);

        // Calcular días restantes para cada autorización
        const autorizacionesConInfo = autorizaciones.map(auth => {
            const hoy = new Date();
            const fin = new Date(auth.fecha_fin_vigencia);
            const diasRestantes = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));
            
            return {
                ...auth.toObject(),
                dias_restantes: diasRestantes > 0 ? diasRestantes : 0,
                esta_activa: auth.estado === 'activa' && fin >= hoy
            };
        });

        res.json({
            success: true,
            autorizaciones: autorizacionesConInfo,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener autorización por ID
     */
    getAuthorizationById: catchAsync(async (req, res) => {
        const { id } = req.params;

        const autorizacion = await AutorizacionVisita.findById(id)
            .populate('tipo_visita_id', 'nombre descripcion')
            .populate('proveedor_id', 'nombre servicio telefono empresa')
            .populate('evento_id', 'nombre_evento descripcion ubicacion')
            .populate('residente_id', 'user_id')
            .populate({
                path: 'residente_id',
                populate: {
                    path: 'user_id',
                    select: 'nombre apellido telefono'
                }
            });

        if (!autorizacion) {
            return res.status(404).json({
                success: false,
                message: 'Autorización no encontrada'
            });
        }

        // Obtener historial de accesos para esta autorización
        const accesos = await RegistroAcceso.find({ autorizacion_id: id })
            .sort({ fecha_hora_ingreso: -1 })
            .limit(10);

        // Calcular días restantes
        const hoy = new Date();
        const fin = new Date(autorizacion.fecha_fin_vigencia);
        const diasRestantes = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));

        res.json({
            success: true,
            autorizacion: {
                ...autorizacion.toObject(),
                dias_restantes: diasRestantes > 0 ? diasRestantes : 0,
                esta_activa: autorizacion.estado === 'activa' && fin >= hoy
            },
            historial_accesos: accesos
        });
    }),

    /**
     * Actualizar autorización
     */
    updateAuthorization: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { 
            nombre_visitante, 
            telefono_visitante, 
            fecha_fin_vigencia,
            limite_ingresos,
            estado 
        } = req.body;

        const autorizacion = await AutorizacionVisita.findById(id);
        if (!autorizacion) {
            return res.status(404).json({
                success: false,
                message: 'Autorización no encontrada'
            });
        }

        // Verificar que el residente es el dueño de la autorización
        if (autorizacion.residente_id.toString() !== req.residenteId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permisos para modificar esta autorización'
            });
        }

        // Validar que no se pueda modificar una autorización ya usada o expirada
        if (autorizacion.estado !== 'activa') {
            return res.status(400).json({
                success: false,
                message: 'No se puede modificar una autorización no activa'
            });
        }

        // Actualizar campos
        if (nombre_visitante) autorizacion.nombre_visitante = nombre_visitante;
        if (telefono_visitante) autorizacion.telefono_visitante = telefono_visitante;
        if (fecha_fin_vigencia) {
            const nuevaFecha = new Date(fecha_fin_vigencia);
            if (nuevaFecha <= autorizacion.fecha_inicio_vigencia) {
                return res.status(400).json({
                    success: false,
                    message: 'La fecha de fin debe ser posterior a la fecha de inicio'
                });
            }
            autorizacion.fecha_fin_vigencia = nuevaFecha;
        }
        if (limite_ingresos) {
            if (limite_ingresos < autorizacion.ingresos_realizados) {
                return res.status(400).json({
                    success: false,
                    message: `El límite no puede ser menor a los ingresos ya realizados (${autorizacion.ingresos_realizados})`
                });
            }
            autorizacion.limite_ingresos = limite_ingresos;
            autorizacion.ingresos_disponibles = limite_ingresos - autorizacion.ingresos_realizados;
        }
        if (estado) autorizacion.estado = estado;

        await autorizacion.save();

        res.json({
            success: true,
            message: 'Autorización actualizada exitosamente',
            autorizacion: {
                id: autorizacion._id,
                nombre_visitante: autorizacion.nombre_visitante,
                fecha_fin_vigencia: autorizacion.fecha_fin_vigencia,
                limite_ingresos: autorizacion.limite_ingresos,
                ingresos_disponibles: autorizacion.ingresos_disponibles,
                estado: autorizacion.estado
            }
        });
    }),

    /**
     * Eliminar/cancelar autorización
     */
    cancelAuthorization: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { motivo } = req.body;

        const autorizacion = await AutorizacionVisita.findById(id);
        if (!autorizacion) {
            return res.status(404).json({
                success: false,
                message: 'Autorización no encontrada'
            });
        }

        // Verificar que el residente es el dueño de la autorización
        if (autorizacion.residente_id.toString() !== req.residenteId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permisos para cancelar esta autorización'
            });
        }

        // Verificar que no esté ya cancelada
        if (autorizacion.estado === 'cancelada') {
            return res.status(400).json({
                success: false,
                message: 'La autorización ya está cancelada'
            });
        }

        // Cancelar autorización
        autorizacion.estado = 'cancelada';
        autorizacion.motivo_cancelacion = motivo || 'Cancelada por el residente';
        await autorizacion.save();

        // Enviar notificación
        await NotificationService.sendNotification({
            userId: req.userId,
            tipo: 'in_app',
            titulo: '❌ Autorización cancelada',
            mensaje: `Has cancelado la autorización para ${autorizacion.nombre_visitante}`,
            data: { 
                tipo: 'visita', 
                action: 'authorization_cancelled',
                autorizacion_id: autorizacion._id.toString(), 
                nombre_visitante: autorizacion.nombre_visitante
            }
        });

        res.json({
            success: true,
            message: 'Autorización cancelada exitosamente'
        });
    }),

    /**
     * Registrar ingreso de visitante (desde caseta) - COMPLETAMENTE ACTUALIZADO
     */
    registerVisitAccess: catchAsync(async (req, res) => {
        const { 
            qr_code, 
            codigo_acceso, 
            metodo_acceso = 'qr',
            observaciones 
        } = req.body;

        let autorizacion;
        let qrResult = null;

        // Buscar autorización por código QR o código de texto
        if (qr_code) {
            try {
                let payload;
                
                // Intentar parsear como JSON directo
                try {
                    console.log(qr_code)
                    payload = JSON.parse(qr_code);
                    console.log("--")
                    console.log(payload)
                } catch (e) {
                    // Si no es JSON, intentar decodificar base64
                    const base64Match = qr_code.match(/^data:image\/[^;]+;base64,(.+)$/);
                    if (base64Match) {
                        // En producción usar librería de decodificación QR
                        console.log('⚠️ Necesita librería jsQR para decodificar QR base64');
                        return res.status(400).json({
                            success: false,
                            message: 'QR no decodificado. Se requiere librería jsQR'
                        });
                    }
                    throw new Error('Formato de QR no válido');
                }
                console.log("first")
                qrResult = QRService.validateQRPayload(payload);
                console.log(qrResult)
                if (!qrResult.valid) {
                    return res.status(400).json({
                        success: false,
                        message: qrResult.reason
                    });
                }
                
                autorizacion = await AutorizacionVisita.findById(qrResult.authorizationId);
            } catch (error) {
                console.error('Error decodificando QR:', error);
                return res.status(400).json({
                    success: false,
                    message: 'Error procesando código QR'
                });
            }
        } else if (codigo_acceso) {
            autorizacion = await AutorizacionVisita.findOne({ codigo_acceso });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Se requiere código QR o código de acceso'
            });
        }

        if (!autorizacion) {
            return res.status(404).json({
                success: false,
                message: 'Autorización no encontrada'
            });
        }

        // Verificar que la autorización esté activa
        if (autorizacion.estado !== 'activa') {
            return res.status(400).json({
                success: false,
                message: `La autorización está ${autorizacion.estado}`,
                estado: autorizacion.estado
            });
        }

        // Verificar vigencia
        const ahora = new Date();
        if (ahora < autorizacion.fecha_inicio_vigencia || ahora > autorizacion.fecha_fin_vigencia) {
            autorizacion.estado = 'expirada';
            await autorizacion.save();
            
            return res.status(400).json({
                success: false,
                message: 'La autorización ha expirado'
            });
        }

        // Verificar límite de ingresos
        if (autorizacion.ingresos_disponibles <= 0) {
            autorizacion.estado = 'usada';
            await autorizacion.save();
            
            return res.status(400).json({
                success: false,
                message: 'Límite de ingresos alcanzado'
            });
        }

        // Verificar estado de recepción del residente
        const estadoRecepcion = await EstadoRecepcion.findOne({ 
            residente_id: autorizacion.residente_id 
        });

        const tipoVisita = await TipoVisita.findById(autorizacion.tipo_visita_id);
        const tipoNombre = tipoVisita.nombre;
        
        let accesoPermitido = true;
        let motivoDenegacion = null;

        // Validar según tipo de visita
        switch (tipoNombre) {
            case 'proveedor':
            case 'personal':
                if (estadoRecepcion && !estadoRecepcion.recibiendo_personal) {
                    accesoPermitido = false;
                    motivoDenegacion = 'El residente no está recibiendo personal/proveedores';
                }
                break;
                
            case 'evento':
            case 'visitante_vip':
            case 'unica_vez':
                if (estadoRecepcion && !estadoRecepcion.recibiendo_visitas) {
                    accesoPermitido = false;
                    motivoDenegacion = 'El residente no está recibiendo visitas';
                }
                break;
        }

        // Validación ESPECIAL para personal: verificar días permitidos
if (accesoPermitido && tipoNombre === 'personal' && autorizacion.personal_id) {
    const personal = await Personal.findById(autorizacion.personal_id);
    if (personal) {
        // ✅ CORRECCIÓN: Usar visitsController directamente
        const puedeHoy = visitsController.canPersonalAccessToday(personal, ahora);
        if (!puedeHoy) {
            accesoPermitido = false;
            motivoDenegacion = 'Este personal no está autorizado para hoy según su frecuencia';
        }
    }
}

        // Validación ESPECIAL para eventos con QR compartido
        if (accesoPermitido && tipoNombre === 'evento' && autorizacion.evento_id) {
            const evento = await Evento.findById(autorizacion.evento_id);
            if (evento && evento.es_qr_compartido && evento.qr_agotado) {
                accesoPermitido = false;
                motivoDenegacion = 'El evento ha alcanzado el límite máximo de invitados';
            }
        }

        // Registrar acceso
        const registroAcceso = await RegistroAcceso.create({
            autorizacion_id: autorizacion._id,
            nombre_visitante: autorizacion.nombre_visitante || 
                             autorizacion.proveedor_id?.nombre ||
                             autorizacion.personal_id?.nombre ||
                             'Invitado de evento',
            tipo_acceso: tipoNombre,
            residente_id: autorizacion.residente_id,
            metodo_acceso,
            fecha_hora_ingreso: ahora,
            usuario_caseta_id: req.userId,
            estado: accesoPermitido ? 'permitido' : 'denegado',
            motivo_denegacion: motivoDenegacion,
            observaciones
        });

        // Actualizar contadores de la autorización si fue permitido
        if (accesoPermitido) {
            autorizacion.ingresos_realizados += 1;
            autorizacion.ingresos_disponibles -= 1;
            
            if (!autorizacion.fecha_primer_uso) {
                autorizacion.fecha_primer_uso = ahora;
            }
            autorizacion.fecha_ultimo_uso = ahora;

            if (autorizacion.ingresos_disponibles <= 0) {
                autorizacion.estado = 'usada';
            }
            
            await autorizacion.save();
        }

        // Obtener información del residente para notificación
        const residente = await Residente.findById(autorizacion.residente_id)
            .populate('user_id');

        // Enviar notificación al residente
        if (residente && residente.user_id) {
            const nombreVisitante = autorizacion.nombre_visitante || 
                                   (await Proveedor.findById(autorizacion.proveedor_id))?.nombre ||
                                   (await Personal.findById(autorizacion.personal_id))?.nombre ||
                                   'Invitado';
            
            // Determinar el título según el estado
            let titulo;
            if (accesoPermitido) {
                titulo = 'Visitante ingresó';
            } else {
                titulo = 'Acceso denegado';
            }

            await NotificationService.sendNotification({
                userId: residente.user_id._id,
                tipo: 'push',
                titulo: `${titulo}`,
                mensaje: accesoPermitido 
                    ? `${nombreVisitante} acaba de ingresar` 
                    : `Acceso denegado a ${nombreVisitante}: ${motivoDenegacion}`,
                data: {
                    tipo: 'visita_ingreso',
                    action: 'ver_visitas_actuales',
                    nombreVisitante: nombreVisitante,
                    tipoVisita: tipoNombre,
                    hora: ahora.toISOString(),
                    permitido: accesoPermitido,
                    visitaId: autorizacion._id.toString(),
                    registroId: registroAcceso._id.toString(),
                    motivoDenegacion: motivoDenegacion || null
                },
                accionRequerida: false,
                accionTipo: 'ver_visita',
                accionData: { 
                    autorizacionId: autorizacion._id.toString(),
                    registroId: registroAcceso._id.toString()
                }
            });
        }

        // Respuesta
        if (!accesoPermitido) {
            return res.status(200).json({
                success: false,
                message: 'Acceso denegado',
                motivo: motivoDenegacion,
                registro: registroAcceso,
                tipo_visita: tipoNombre
            });
        }

        res.json({
            success: true,
            message: 'Acceso registrado exitosamente',
            registro: registroAcceso,
            autorizacion: {
                ingresos_restantes: autorizacion.ingresos_disponibles,
                estado: autorizacion.estado,
                tipo_visita: tipoNombre
            }
        });
    }),

    /**
     * Verificar si personal puede ingresar HOY según sus días configurados
     */
    canPersonalAccessToday: (personal, fecha = new Date()) => {
        if (!personal || !personal.frecuencia) return true;
        
        const diaSemana = fecha.getDay(); // 0=Domingo, ..., 6=Sábado
        const fechaString = fecha.toISOString().split('T')[0];
        
        switch (personal.frecuencia.tipo) {
            case 'diario':
                return true;
                
            case 'semanal':
                if (!personal.frecuencia.dias_semana || 
                    personal.frecuencia.dias_semana.length === 0) {
                    return true;
                }
                return personal.frecuencia.dias_semana.includes(diaSemana);
                
            case 'fecha_especifica':
                if (!personal.frecuencia.fechas_especificas) return false;
                return personal.frecuencia.fechas_especificas.some(fechaEsp => {
                    const fechaEspString = new Date(fechaEsp).toISOString().split('T')[0];
                    return fechaEspString === fechaString;
                });
                
            case 'quincenal':
                // Ej: días 1 y 15 de cada mes
                const diaMes = fecha.getDate();
                return diaMes === 1 || diaMes === 15;
                
            case 'mensual':
                // Ej: día específico del mes
                const diaMesPersonal = 10; // Esto debería venir del personal
                return fecha.getDate() === diaMesPersonal;
                
            default:
                return true;
        }
    },

    /**
     * Obtener personal registrado por residente
     */
    getResidentPersonal: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        
        const personal = await Personal.find({ 
            residente_id: residenteId
        }).sort({ nombre: 1 });

        res.json({
            success: true,
            personal
        });
    }),

     /**
     * Crear nuevo personal
     */
    createPersonal: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const {
            nombre,
            telefono,
            tipo_servicio,
            frecuencia,
            fecha_inicio,
            fecha_fin
        } = req.body;

        // Validar fechas
        const fechaInicio = new Date(fecha_inicio);
        const fechaFin = new Date(fecha_fin);
        
        if (fechaInicio >= fechaFin) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de fin debe ser posterior a la fecha de inicio'
            });
        }

        // Crear registro de personal
        const personal = await Personal.create({
            residente_id: residenteId,
            nombre,
            telefono,
            tipo_servicio,
            frecuencia,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            creado_por_usuario_id: req.userId
        });

        // Buscar tipo de visita "personal"
        const tipoPersonal = await TipoVisita.findOne({ nombre: 'personal' });
        if (!tipoPersonal) {
            return res.status(500).json({
                success: false,
                message: 'Tipo de visita "personal" no configurado en el sistema'
            });
        }

        // Calcular límite de ingresos basado en frecuencia
        let limiteIngresos = 999; // Por defecto alto
        
        if (frecuencia.tipo === 'fecha_especifica' && frecuencia.fechas_especificas) {
            limiteIngresos = frecuencia.fechas_especificas.length;
        } else if (frecuencia.tipo === 'semanal' && frecuencia.dias_semana) {
            // Calcular número de semanas entre fechas
            const semanas = Math.ceil((fechaFin - fechaInicio) / (7 * 24 * 60 * 60 * 1000));
            limiteIngresos = frecuencia.dias_semana.length * semanas;
        }

        // Crear autorización automática para todo el periodo
        const autorizacion = await AutorizacionVisita.create({
            residente_id: residenteId,
            tipo_visita_id: tipoPersonal._id,
            personal_id: personal._id,
            nombre_visitante: nombre,
            telefono_visitante: telefono,
            fecha_inicio_vigencia: fechaInicio,
            fecha_fin_vigencia: fechaFin,
            limite_ingresos: Math.min(limiteIngresos, 999), // Máximo 999
            ingresos_disponibles: Math.min(limiteIngresos, 999),
            usuario_creador_id: req.userId
        });

        // Generar QR
        const qrData = await QRService.generateQRForAuthorization(
            autorizacion._id,
            residenteId,
            { 
                tipoVisita: 'personal', 
                nombreVisitante: nombre,
                esPersonal: true 
            }
        );

        autorizacion.qr_code = qrData.qrDataURL;
        autorizacion.codigo_acceso = QRService.generateTextCode(autorizacion._id);
        await autorizacion.save();

        res.status(201).json({
            success: true,
            message: 'Personal registrado exitosamente',
            personal,
            autorizacion: {
                id: autorizacion._id,
                qr_code: qrData.qrDataURL,
                codigo_acceso: autorizacion.codigo_acceso,
                limite_ingresos: autorizacion.limite_ingresos
            }
        });
    }),

    /**
     * Registrar salida de visitante
     */
    registerVisitExit: catchAsync(async (req, res) => {
        const { registro_id } = req.body;

        const registro = await RegistroAcceso.findById(registro_id)
            .populate('autorizacion_id')
            .populate('residente_id');

        if (!registro) {
            return res.status(404).json({
                success: false,
                message: 'Registro de acceso no encontrado'
            });
        }

        // Verificar que el acceso fue permitido y no tiene salida registrada
        if (registro.estado !== 'permitido' || registro.fecha_hora_salida) {
            return res.status(400).json({
                success: false,
                message: 'No se puede registrar salida para este acceso'
            });
        }

        // Registrar salida
        const horaSalida = new Date();
        registro.fecha_hora_salida = horaSalida;
        registro.estado = 'finalizado';
        await registro.save();

        // Calcular tiempo de estancia
        const tiempoIngreso = new Date(registro.fecha_hora_ingreso);
        const minutosDentro = Math.floor((horaSalida - tiempoIngreso) / (1000 * 60));
        const horasDentro = Math.floor(minutosDentro / 60);
        const minutosRestantes = minutosDentro % 60;

        // NOTIFICACIÓN DE SALIDA
        
        if (registro.residente_id) {
            const residente = await Residente.findById(registro.residente_id)
                .populate('user_id');

            if (residente && residente.user_id) {
                const nombreVisitante = registro.nombre_visitante || 'Visitante';
                
                // Formatear tiempo de estancia
                let tiempoTexto;
                if (horasDentro > 0) {
                    tiempoTexto = `${horasDentro}h ${minutosRestantes}m`;
                } else {
                    tiempoTexto = `${minutosDentro} minutos`;
                }

                await NotificationService.sendNotification({
                    userId: residente.user_id._id,
                    tipo: 'push',
                    titulo: '👋 Visitante salió',
                    mensaje: `${nombreVisitante} acaba de salir. Estuvo ${tiempoTexto}`,
                    data: {
                        tipo: 'visita_salida',
                        action: 'ver_historial_visitas',
                        nombreVisitante: nombreVisitante,
                        tipoVisita: registro.tipo_acceso,
                        hora_ingreso: registro.fecha_hora_ingreso.toISOString(),
                        hora_salida: horaSalida.toISOString(),
                        tiempo_estancia: {
                            minutos: minutosDentro,
                            horas: horasDentro,
                            texto: tiempoTexto
                        },
                        registroId: registro._id.toString(),
                        autorizacionId: registro.autorizacion_id?._id?.toString()
                    },
                    accionRequerida: false
                });
            }
        }

        res.json({
            success: true,
            message: 'Salida registrada exitosamente',
            registro: {
                id: registro._id,
                nombre_visitante: registro.nombre_visitante,
                fecha_hora_ingreso: registro.fecha_hora_ingreso,
                fecha_hora_salida: registro.fecha_hora_salida,
                tiempo_estancia: {
                    minutos: minutosDentro,
                    horas: horasDentro,
                    texto: horasDentro > 0 
                        ? `${horasDentro}h ${minutosRestantes}m`
                        : `${minutosDentro} minutos`
                }
            }
        });
    }),

    /**
     * Obtener visitas del residente que están actualmente dentro del condominio
     */
    getCurrentVisits: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;

        // Buscar registros de acceso que:
        // 1. Pertenecen a este residente
        // 2. Estado es 'permitido' (acceso autorizado)
        // 3. No tienen fecha de salida (aún están dentro)
        const visitasActuales = await RegistroAcceso.find({
            residente_id: residenteId,
            estado: 'permitido',
            fecha_hora_salida: null  // No han salido
        })
        .populate('autorizacion_id', 'tipo_visita_id nombre_visitante telefono_visitante')
        .populate({
            path: 'autorizacion_id',
            populate: [
                {
                    path: 'tipo_visita_id',
                    select: 'nombre descripcion'
                },
                {
                    path: 'proveedor_id',
                    select: 'nombre servicio empresa'
                },
                {
                    path: 'personal_id',
                    select: 'nombre tipo_servicio'
                }
            ]
        })
        .sort({ fecha_hora_ingreso: -1 });

        // Formatear respuesta con información útil
        const visitasFormateadas = visitasActuales.map(visita => {
            const ahora = new Date();
            const ingreso = new Date(visita.fecha_hora_ingreso);
            const minutosDentro = Math.floor((ahora - ingreso) / (1000 * 60));

            // Determinar el nombre del visitante según el tipo
            let nombreVisitante = visita.nombre_visitante;
            if (visita.autorizacion_id) {
                if (visita.autorizacion_id.proveedor_id) {
                    nombreVisitante = visita.autorizacion_id.proveedor_id.nombre;
                } else if (visita.autorizacion_id.personal_id) {
                    nombreVisitante = visita.autorizacion_id.personal_id.nombre;
                }
            }

            return {
                registro_id: visita._id,
                autorizacion_id: visita.autorizacion_id?._id,
                nombre_visitante: nombreVisitante,
                telefono_visitante: visita.autorizacion_id?.telefono_visitante,
                tipo_visita: visita.autorizacion_id?.tipo_visita_id?.nombre || visita.tipo_acceso,
                tipo_visita_descripcion: visita.autorizacion_id?.tipo_visita_id?.descripcion,
                fecha_hora_ingreso: visita.fecha_hora_ingreso,
                tiempo_dentro: {
                    minutos: minutosDentro,
                    horas: Math.floor(minutosDentro / 60),
                    texto: minutosDentro < 60 
                        ? `${minutosDentro} minutos`
                        : `${Math.floor(minutosDentro / 60)}h ${minutosDentro % 60}m`
                },
                metodo_acceso: visita.metodo_acceso,
                observaciones: visita.observaciones,
                // Información adicional según el tipo
                detalles_adicionales: visita.autorizacion_id?.proveedor_id ? {
                    tipo: 'proveedor',
                    servicio: visita.autorizacion_id.proveedor_id.servicio,
                    empresa: visita.autorizacion_id.proveedor_id.empresa
                } : visita.autorizacion_id?.personal_id ? {
                    tipo: 'personal',
                    tipo_servicio: visita.autorizacion_id.personal_id.tipo_servicio
                } : null
            };
        });

        res.json({
            success: true,
            visitas_actuales: visitasFormateadas,
            total: visitasFormateadas.length,
            timestamp: new Date()
        });
    }),

    /**
     * Obtener historial de accesos de un residente
     */
    getAccessHistory: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { 
            page = 1, 
            limit = 20,
            fecha_inicio,
            fecha_fin,
            estado
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        let query = { residente_id: residenteId };

        // Filtro por fechas
        if (fecha_inicio || fecha_fin) {
            query.fecha_hora_ingreso = {};
            if (fecha_inicio) {
                query.fecha_hora_ingreso.$gte = new Date(fecha_inicio);
            }
            if (fecha_fin) {
                const fechaFin = new Date(fecha_fin);
                fechaFin.setHours(23, 59, 59, 999);
                query.fecha_hora_ingreso.$lte = fechaFin;
            }
        }

        // Filtro por estado
        if (estado) {
            query.estado = estado;
        }

        // Obtener historial
        const [historial, total] = await Promise.all([
            RegistroAcceso.find(query)
                .populate('autorizacion_id', 'tipo_visita_id nombre_visitante')
                .populate({
                    path: 'autorizacion_id',
                    populate: {
                        path: 'tipo_visita_id',
                        select: 'nombre'
                    }
                })
                .sort({ fecha_hora_ingreso: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            RegistroAcceso.countDocuments(query)
        ]);

        res.json({
            success: true,
            historial,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener estadísticas de visitas
     */
    getVisitStatistics: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { mes, año } = req.query;

        // Determinar rango de fechas
        const ahora = new Date();
        const inicioMes = mes && año 
            ? new Date(año, mes - 1, 1)
            : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        
        const finMes = new Date(inicioMes.getFullYear(), inicioMes.getMonth() + 1, 0);
        finMes.setHours(23, 59, 59, 999);

        // Estadísticas de autorizaciones
        const totalAutorizaciones = await AutorizacionVisita.countDocuments({
            residente_id: residenteId,
            fecha_creacion: { $gte: inicioMes, $lte: finMes }
        });

        const autorizacionesActivas = await AutorizacionVisita.countDocuments({
            residente_id: residenteId,
            estado: 'activa',
            fecha_fin_vigencia: { $gte: ahora }
        });

        // Estadísticas de accesos
        const totalAccesos = await RegistroAcceso.countDocuments({
            residente_id: residenteId,
            fecha_hora_ingreso: { $gte: inicioMes, $lte: finMes }
        });

        const accesosPermitidos = await RegistroAcceso.countDocuments({
            residente_id: residenteId,
            estado: 'permitido',
            fecha_hora_ingreso: { $gte: inicioMes, $lte: finMes }
        });

        const accesosDenegados = await RegistroAcceso.countDocuments({
            residente_id: residenteId,
            estado: 'denegado',
            fecha_hora_ingreso: { $gte: inicioMes, $lte: finMes }
        });

        // Tipos de visita más comunes
        const tiposMasComunes = await AutorizacionVisita.aggregate([
            { 
                $match: { 
                    residente_id: residenteId,
                    fecha_creacion: { $gte: inicioMes, $lte: finMes }
                } 
            },
            { $group: { 
                _id: '$tipo_visita_id', 
                count: { $sum: 1 } 
            }},
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        // Populate nombres de tipos
        const tiposConNombres = await Promise.all(
            tiposMasComunes.map(async (tipo) => {
                const tipoInfo = await TipoVisita.findById(tipo._id);
                return {
                    tipo: tipoInfo ? tipoInfo.nombre : 'Desconocido',
                    count: tipo.count
                };
            })
        );

        res.json({
            success: true,
            estadisticas: {
                periodo: {
                    inicio: inicioMes,
                    fin: finMes
                },
                autorizaciones: {
                    total: totalAutorizaciones,
                    activas: autorizacionesActivas
                },
                accesos: {
                    total: totalAccesos,
                    permitidos: accesosPermitidos,
                    denegados: accesosDenegados,
                    tasa_exito: totalAccesos > 0 
                        ? ((accesosPermitidos / totalAccesos) * 100).toFixed(1)
                        : 0
                },
                tipos_mas_comunes: tiposConNombres
            }
        });
    }),

    /**
     * Obtener proveedores disponibles (ACTUALIZADO para residentes)
     */
    getAvailableProviders: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { search, servicio } = req.query;

        let query = { estatus: 'activo' };

        // Residentes solo ven proveedores globales O creados por ellos
        if (residenteId) {
            query.$or = [
                { es_global: true },
                { creado_por_residente_id: residenteId }
            ];
        } else {
            // Admin/caseta ven todos
            query = { estatus: 'activo' };
        }

        if (search) {
            query.$or = [
                { nombre: { $regex: search, $options: 'i' } },
                { servicio: { $regex: search, $options: 'i' } },
                { empresa: { $regex: search, $options: 'i' } }
            ];
        }

        if (servicio) {
            query.servicio = { $regex: servicio, $options: 'i' };
        }

        const proveedores = await Proveedor.find(query)
            .sort({ es_global: -1, nombre: 1 }) // Globales primero
            .limit(50);

        res.json({
            success: true,
            proveedores
        });
    }),

    /**
     * Crear proveedor desde app de residente
     */
    createProviderFromResident: catchAsync(async (req, res) => {
        const residenteId = req.residenteId;
        const { nombre, telefono, servicio, empresa } = req.body;

        // Crear proveedor solo para este residente
        const proveedor = await Proveedor.create({
            nombre,
            telefono,
            servicio,
            empresa,
            creado_por_residente_id: residenteId,
            es_global: false // Solo para este residente
        });

        res.status(201).json({
            success: true,
            message: 'Proveedor creado exitosamente',
            proveedor
        });
    }),


    /**
     * Obtener tipos de visita
     */
    getVisitTypes: catchAsync(async (req, res) => {
        const tipos = await TipoVisita.find().sort({ nombre: 1 });

        res.json({
            success: true,
            tipos
        });
    })
};