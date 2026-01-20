import { AutorizacionVisita } from '../models/autorizacionVisita.model.js';
import { RegistroAcceso } from '../models/registroAcceso.model.js';
import { Residente } from '../models/residente.model.js';
import { Domicilio } from '../models/domicilio.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';

export const gatehouseController = {
    /**
     * Buscar autorización por código de texto (para proveedores que dicen código)
     */
    lookupAuthorizationByCode: catchAsync(async (req, res) => {
        const { codigo_acceso } = req.params;

        const autorizacion = await AutorizacionVisita.findOne({ 
            codigo_acceso,
            estado: 'activa',
            fecha_fin_vigencia: { $gte: new Date() }
        })
        .populate('tipo_visita_id', 'nombre')
        .populate('proveedor_id', 'nombre servicio')
        .populate('evento_id', 'nombre_evento')
        .populate({
            path: 'residente_id',
            populate: [
                {
                    path: 'user_id',
                    select: 'nombre apellido'
                },
                {
                    path: 'domicilio_id',
                    populate: {
                        path: 'calle_torre_id',
                        select: 'nombre'
                    }
                }
            ]
        });

        if (!autorizacion) {
            return res.status(404).json({
                success: false,
                message: 'Código no encontrado o autorización no vigente'
            });
        }

        // Verificar si ya tuvo ingreso hoy
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const mañana = new Date(hoy);
        mañana.setDate(hoy.getDate() + 1);

        const ingresoHoy = await RegistroAcceso.findOne({
            autorizacion_id: autorizacion._id,
            fecha_hora_ingreso: { $gte: hoy, $lt: mañana },
            estado: 'permitido'
        });

        res.json({
            success: true,
            autorizacion: {
                id: autorizacion._id,
                nombre_visitante: autorizacion.nombre_visitante || 
                                 autorizacion.proveedor_id?.nombre ||
                                 'Invitado de evento',
                tipo_invitado: autorizacion.tipo_visita_id.nombre,
                calle_torre: autorizacion.residente_id.domicilio_id.calle_torre_id.nombre,
                numero: autorizacion.residente_id.domicilio_id.numero,
                fecha_inicio_vigencia: autorizacion.fecha_inicio_vigencia,
                fecha_fin_vigencia: autorizacion.fecha_fin_vigencia,
                ingresos_disponibles: autorizacion.ingresos_disponibles,
                ya_ingreso_hoy: !!ingresoHoy,
                ingreso_id: ingresoHoy?._id
            },
            residente: {
                nombre: `${autorizacion.residente_id.user_id.nombre} ${autorizacion.residente_id.user_id.apellido}`,
                domicilio: `${autorizacion.residente_id.domicilio_id.calle_torre_id.nombre} #${autorizacion.residente_id.domicilio_id.numero}`
            }
        });
    }),

    /**
     * Obtener visitas próximas (para mostrar en pantalla inicial)
     */
    getPendingVisits: catchAsync(async (req, res) => {
        const { fecha = new Date().toISOString().split('T')[0] } = req.query;
        
        const fechaConsulta = new Date(fecha);
        fechaConsulta.setHours(0, 0, 0, 0);
        const fechaFin = new Date(fechaConsulta);
        fechaFin.setDate(fechaConsulta.getDate() + 3); // Próximos 3 días

        // Buscar autorizaciones activas que inician en los próximos días
        const autorizaciones = await AutorizacionVisita.find({
            estado: 'activa',
            fecha_inicio_vigencia: { $lte: fechaFin }, // Inician antes del fin
            fecha_fin_vigencia: { $gte: fechaConsulta } // No expiradas aún
        })
        .populate('tipo_visita_id', 'nombre')
        .populate('proveedor_id', 'nombre')
        .populate({
            path: 'residente_id',
            populate: [
                {
                    path: 'user_id',
                    select: 'nombre apellido'
                },
                {
                    path: 'domicilio_id',
                    populate: {
                        path: 'calle_torre_id',
                        select: 'nombre'
                    }
                }
            ]
        })
        .sort({ fecha_inicio_vigencia: 1 });

        // Para cada autorización, verificar si ya ingresó hoy
        const visitasProcesadas = await Promise.all(
            autorizaciones.map(async (auth) => {
                const hoy = new Date();
                hoy.setHours(0, 0, 0, 0);
                const mañana = new Date(hoy);
                mañana.setDate(hoy.getDate() + 1);

                const ingresoHoy = await RegistroAcceso.findOne({
                    autorizacion_id: auth._id,
                    fecha_hora_ingreso: { $gte: hoy, $lt: mañana }
                });

                return {
                    id: auth._id,
                    codigo_acceso: auth.codigo_acceso,
                    nombre_visitante: auth.nombre_visitante || 
                                     auth.proveedor_id?.nombre ||
                                     'Invitado de evento',
                    tipo_invitado: auth.tipo_visita_id.nombre,
                    calle_torre: auth.residente_id.domicilio_id.calle_torre_id.nombre,
                    numero: auth.residente_id.domicilio_id.numero,
                    fecha_inicio_vigencia: auth.fecha_inicio_vigencia,
                    fecha_fin_vigencia: auth.fecha_fin_vigencia,
                    ingresos_disponibles: auth.ingresos_disponibles,
                    ya_ingreso_hoy: !!ingresoHoy,
                    puede_ingresar_hoy: new Date() >= auth.fecha_inicio_vigencia && 
                                       new Date() <= auth.fecha_fin_vigencia
                };
            })
        );

        // Filtrar solo las que pueden ingresar hoy/mañana
        const visitasProximas = visitasProcesadas.filter(v => 
            v.puede_ingresar_hoy && !v.ya_ingreso_hoy
        );

        res.json({
            success: true,
            visitas: visitasProximas,
            total: visitasProximas.length,
            fecha_consulta: fechaConsulta
        });
    }),

    /**
     * Obtener visitas vigentes (dentro del condominio ahora)
     */
    getActiveVisits: catchAsync(async (req, res) => {
        const visitasVigentes = await RegistroAcceso.find({
            estado: 'permitido',
            fecha_hora_salida: null // No han salido
        })
        .populate('autorizacion_id')
        .populate({
            path: 'autorizacion_id',
            populate: [
                {
                    path: 'tipo_visita_id',
                    select: 'nombre'
                },
                {
                    path: 'proveedor_id',
                    select: 'nombre servicio'
                }
            ]
        })
        .populate({
            path: 'residente_id',
            populate: [
                {
                    path: 'user_id',
                    select: 'nombre apellido'
                },
                {
                    path: 'domicilio_id',
                    populate: {
                        path: 'calle_torre_id',
                        select: 'nombre'
                    }
                }
            ]
        })
        .sort({ fecha_hora_ingreso: -1 });

        const visitasFormateadas = visitasVigentes.map(visita => ({
            registro_id: visita._id,
            nombre_visitante: visita.nombre_visitante,
            tipo_invitado: visita.tipo_acceso,
            calle_torre: visita.residente_id.domicilio_id.calle_torre_id.nombre,
            numero: visita.residente_id.domicilio_id.numero,
            fecha_hora_ingreso: visita.fecha_hora_ingreso,
            tiempo_dentro: Math.floor(
                (new Date() - new Date(visita.fecha_hora_ingreso)) / (1000 * 60)
            ) // minutos dentro
        }));

        res.json({
            success: true,
            visitas: visitasFormateadas,
            total: visitasFormateadas.length
        });
    }),

    /**
     * Obtener visitas pasadas (historial)
     */
    getPastVisits: catchAsync(async (req, res) => {
        const { fecha, page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;

        let query = {
            estado: 'finalizado',
            fecha_hora_salida: { $ne: null }
        };

        if (fecha) {
            const fechaConsulta = new Date(fecha);
            fechaConsulta.setHours(0, 0, 0, 0);
            const fechaFin = new Date(fechaConsulta);
            fechaFin.setDate(fechaConsulta.getDate() + 1);

            query.fecha_hora_ingreso = {
                $gte: fechaConsulta,
                $lt: fechaFin
            };
        }

        const [visitas, total] = await Promise.all([
            RegistroAcceso.find(query)
                .populate('autorizacion_id')
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'domicilio_id',
                        populate: {
                            path: 'calle_torre_id',
                            select: 'nombre'
                        }
                    }
                })
                .sort({ fecha_hora_ingreso: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            RegistroAcceso.countDocuments(query)
        ]);

        res.json({
            success: true,
            visitas,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener visitas rechazadas
     */
    getRejectedVisits: catchAsync(async (req, res) => {
        const { fecha, page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;

        let query = { estado: 'denegado' };

        if (fecha) {
            const fechaConsulta = new Date(fecha);
            fechaConsulta.setHours(0, 0, 0, 0);
            const fechaFin = new Date(fechaConsulta);
            fechaFin.setDate(fechaConsulta.getDate() + 1);

            query.fecha_hora_ingreso = {
                $gte: fechaConsulta,
                $lt: fechaFin
            };
        }

        const [visitas, total] = await Promise.all([
            RegistroAcceso.find(query)
                .populate('autorizacion_id')
                .populate({
                    path: 'residente_id',
                    populate: {
                        path: 'domicilio_id',
                        populate: {
                            path: 'calle_torre_id',
                            select: 'nombre'
                        }
                    }
                })
                .sort({ fecha_hora_ingreso: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            RegistroAcceso.countDocuments(query)
        ]);

        res.json({
            success: true,
            visitas,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Registrar ingreso manual (con código, no QR)
     */
    registerManualAccess: catchAsync(async (req, res) => {
        const { codigo_acceso, observaciones } = req.body;

        // Primero, buscar la autorización (igual que lookup)
        const autorizacion = await AutorizacionVisita.findOne({ 
            codigo_acceso,
            estado: 'activa',
            fecha_fin_vigencia: { $gte: new Date() }
        })
        .populate('tipo_visita_id')
        .populate({
            path: 'residente_id',
            populate: {
                path: 'user_id'
            }
        });

        if (!autorizacion) {
            return res.status(404).json({
                success: false,
                message: 'Código no válido o autorización expirada'
            });
        }

        // Verificar si ya ingresó hoy
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const mañana = new Date(hoy);
        mañana.setDate(hoy.getDate() + 1);

        const ingresoHoy = await RegistroAcceso.findOne({
            autorizacion_id: autorizacion._id,
            fecha_hora_ingreso: { $gte: hoy, $lt: mañana },
            estado: 'permitido'
        });

        if (ingresoHoy) {
            return res.status(400).json({
                success: false,
                message: 'Esta autorización ya fue usada hoy',
                ingreso_id: ingresoHoy._id
            });
        }

        // Verificar estado de recepción del residente
        const estadoRecepcion = await EstadoRecepcion.findOne({ 
            residente_id: autorizacion.residente_id._id 
        });

        const esProveedor = autorizacion.tipo_visita_id.nombre === 'proveedor';
        let accesoPermitido = true;
        let motivoDenegacion = null;

        if (esProveedor && estadoRecepcion && !estadoRecepcion.recibiendo_personal) {
            accesoPermitido = false;
            motivoDenegacion = 'El residente no está recibiendo personal';
        } else if (!esProveedor && estadoRecepcion && !estadoRecepcion.recibiendo_visitas) {
            accesoPermitido = false;
            motivoDenegacion = 'El residente no está recibiendo visitas';
        }

        // Registrar acceso (igual que el endpoint existente)
        const registroAcceso = await RegistroAcceso.create({
            autorizacion_id: autorizacion._id,
            nombre_visitante: autorizacion.nombre_visitante || 
                             autorizacion.proveedor_id?.nombre ||
                             'Invitado',
            tipo_acceso: autorizacion.tipo_visita_id.nombre,
            residente_id: autorizacion.residente_id._id,
            metodo_acceso: 'manual', // Diferente: manual en lugar de qr
            fecha_hora_ingreso: new Date(),
            usuario_caseta_id: req.userId,
            estado: accesoPermitido ? 'permitido' : 'denegado',
            motivo_denegacion: motivoDenegacion,
            observaciones
        });

        // Actualizar contadores si fue permitido
        if (accesoPermitido) {
            autorizacion.ingresos_realizados += 1;
            autorizacion.ingresos_disponibles -= 1;
            
            if (!autorizacion.fecha_primer_uso) {
                autorizacion.fecha_primer_uso = new Date();
            }
            autorizacion.fecha_ultimo_uso = new Date();

            if (autorizacion.ingresos_disponibles <= 0) {
                autorizacion.estado = 'usada';
            }
            
            await autorizacion.save();
        }

        res.json({
            success: true,
            message: accesoPermitido ? 
                'Ingreso registrado exitosamente' : 
                'Acceso denegado',
            registro: registroAcceso,
            autorizacion: {
                ingresos_restantes: autorizacion.ingresos_disponibles,
                estado: autorizacion.estado
            }
        });
    }),

    /**
     * Marcar salida de una visita
     */
    markVisitExit: catchAsync(async (req, res) => {
        const { registro_id } = req.body;

        const registro = await RegistroAcceso.findById(registro_id);
        if (!registro) {
            return res.status(404).json({
                success: false,
                message: 'Registro no encontrado'
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

        // Calcular tiempo dentro
        const tiempoIngreso = new Date(registro.fecha_hora_ingreso);
        const tiempoSalida = new Date(registro.fecha_hora_salida);
        const minutosDentro = Math.floor(
            (tiempoSalida - tiempoIngreso) / (1000 * 60)
        );

        res.json({
            success: true,
            message: 'Salida registrada exitosamente',
            registro: {
                id: registro._id,
                nombre_visitante: registro.nombre_visitante,
                fecha_hora_ingreso: registro.fecha_hora_ingreso,
                fecha_hora_salida: registro.fecha_hora_salida,
                minutos_dentro: minutosDentro
            }
        });
    })
};