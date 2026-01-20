import { AutorizacionVisita } from '../models/autorizacionVisita.model.js';
import { RegistroAcceso } from '../models/registroAcceso.model.js';
import { TipoVisita } from '../models/tipoVisita.model.js';
import { Proveedor } from '../models/proveedor.model.js';
import { Evento } from '../models/evento.model.js';
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
        const residenteId = req.residenteId; // Del middleware
        const {
            tipo_visita_id,
            proveedor_id,
            evento_id,
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

        // Para visitas únicas, ajustar fechas
        let fechaInicio, fechaFin;
        if (es_visita_unica && fecha_visita_unica) {
            fechaInicio = new Date(fecha_visita_unica);
            fechaFin = new Date(fecha_visita_unica);
            fechaFin.setHours(23, 59, 59, 999); // Fin del día
        } else {
            fechaInicio = new Date(fecha_inicio_vigencia);
            fechaFin = new Date(fecha_fin_vigencia);
        }

        // Crear autorización
        const autorizacion = await AutorizacionVisita.create({
            residente_id: residenteId,
            tipo_visita_id,
            proveedor_id,
            evento_id,
            nombre_visitante,
            telefono_visitante,
            fecha_inicio_vigencia: fechaInicio,
            fecha_fin_vigencia: fechaFin,
            es_visita_unica,
            fecha_visita_unica: es_visita_unica ? fechaInicio : null,
            limite_ingresos,
            ingresos_disponibles: limite_ingresos,
            usuario_creador_id: req.userId
        });

        // Generar código QR
        const qrData = await QRService.generateQRForAuthorization(
            autorizacion._id,
            residenteId,
            {
                tipoVisita: tipoVisita.nombre,
                nombreVisitante: nombre_visitante
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
            .populate('evento_id', 'nombre_evento')
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
            mensaje: `Has creado una autorización para ${nombre_visitante}`,
            data: { 
                tipo: 'visita', 
                action: 'authorization_created',
                autorizacion_id: autorizacion._id,
                nombre_visitante 
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
        if (autorizacion.residente_id.toString() !== req.residenteId) {
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
        if (autorizacion.residente_id.toString() !== req.residenteId) {
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
                autorizacion_id: autorizacion._id,
                nombre_visitante: autorizacion.nombre_visitante 
            }
        });

        res.json({
            success: true,
            message: 'Autorización cancelada exitosamente'
        });
    }),

    /**
     * Registrar ingreso de visitante (desde caseta)
     */
    registerVisitAccess: catchAsync(async (req, res) => {
        const { 
            qr_code, 
            codigo_acceso, 
            metodo_acceso = 'qr',
            observaciones 
        } = req.body;

        let autorizacion;

        // Buscar autorización por código QR o código de texto
        if (qr_code) {
            // Decodificar QR (en producción, esto vendría del escáner)
            const qrResult = QRService.validateQRPayload(qr_code);
            if (!qrResult.valid) {
                return res.status(400).json({
                    success: false,
                    message: qrResult.reason
                });
            }
            console.log(qrResult)
            autorizacion = await AutorizacionVisita.findById(qrResult.authorizationId);
            console.log(autorizacion)
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
        const esProveedor = tipoVisita.nombre === 'proveedor';
        
        let accesoPermitido = true;
        let motivoDenegacion = null;

        if (esProveedor && estadoRecepcion && !estadoRecepcion.recibiendo_personal) {
            accesoPermitido = false;
            motivoDenegacion = 'El residente no está recibiendo personal/proveedores';
        } else if (!esProveedor && estadoRecepcion && !estadoRecepcion.recibiendo_visitas) {
            accesoPermitido = false;
            motivoDenegacion = 'El residente no está recibiendo visitas';
        }

        // Registrar acceso
        const registroAcceso = await RegistroAcceso.create({
            autorizacion_id: autorizacion._id,
            nombre_visitante: autorizacion.nombre_visitante,
            tipo_acceso: tipoVisita.nombre,
            residente_id: autorizacion.residente_id,
            metodo_acceso,
            fecha_hora_ingreso: ahora,
            usuario_caseta_id: req.userId,
            estado: accesoPermitido ? 'permitido' : 'denegado',
            motivo_denegacion: motivoDenegacion,
            observaciones
        });

        // Actualizar contadores de la autorización
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
        }
        
        await autorizacion.save();

        // Obtener información del residente para notificación
        const residente = await Residente.findById(autorizacion.residente_id)
            .populate('user_id');

        // Enviar notificación al residente
        if (residente && residente.user_id) {
            await NotificationService.notifications.visitaIngreso(
                residente.user_id._id,
                {
                    nombreVisitante: autorizacion.nombre_visitante,
                    tipoVisita: tipoVisita.nombre,
                    hora: Utils.formatDate(ahora, true),
                    permitido: accesoPermitido,
                    visitaId: autorizacion._id
                }
            );
        }

        // Respuesta
        if (!accesoPermitido) {
            return res.status(200).json({
                success: false,
                message: 'Acceso denegado',
                motivo: motivoDenegacion,
                registro: registroAcceso
            });
        }

        res.json({
            success: true,
            message: 'Acceso registrado exitosamente',
            registro: registroAcceso,
            autorizacion: {
                ingresos_restantes: autorizacion.ingresos_disponibles,
                estado: autorizacion.estado
            }
        });
    }),

    /**
     * Registrar salida de visitante
     */
    registerVisitExit: catchAsync(async (req, res) => {
        const { registro_id } = req.body;

        const registro = await RegistroAcceso.findById(registro_id);
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
        registro.fecha_hora_salida = new Date();
        registro.estado = 'finalizado';
        await registro.save();

        res.json({
            success: true,
            message: 'Salida registrada exitosamente',
            registro
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
     * Obtener proveedores disponibles
     */
    getAvailableProviders: catchAsync(async (req, res) => {
        const { search, servicio } = req.query;

        let query = { estatus: 'activo' };

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
            .sort({ nombre: 1 })
            .limit(50);

        res.json({
            success: true,
            proveedores
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