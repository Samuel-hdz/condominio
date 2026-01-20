import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';
import { UsuarioNotificacionPref } from '../models/usuarioNotificacionPref.model.js';
import { CuentaBancaria } from '../models/cuentaBancaria.model.js';
import { BitacoraIncidencia } from '../models/bitacoraIncidencia.model.js';

export const systemController = {
    /**
     * Obtener notificaciones del usuario
     */
    getUserNotifications: catchAsync(async (req, res) => {
        const userId = req.userId;
        const { 
            page = 1, 
            limit = 20,
            leida = false,
            tipo 
        } = req.query;

        const result = await NotificationService.getUserNotifications(
            userId,
            { page: parseInt(page), limit: parseInt(limit), leida, tipo }
        );

        res.json({
            success: true,
            ...result
        });
    }),

    /**
     * Marcar notificación como leída
     */
    markNotificationAsRead: catchAsync(async (req, res) => {
        const { id } = req.params;

        const notification = await NotificationService.markAsRead(id, req.userId);

        res.json({
            success: true,
            message: 'Notificación marcada como leída',
            notification
        });
    }),

    /**
     * Marcar todas las notificaciones como leídas
     */
    markAllNotificationsAsRead: catchAsync(async (req, res) => {
        const { Notificacion } = await import('../models/notificacion.model.js');

        const result = await Notificacion.updateMany(
            {
                user_id: req.userId,
                leida: false
            },
            {
                leida: true,
                fecha_leida: new Date()
            }
        );

        res.json({
            success: true,
            message: `${result.modifiedCount} notificaciones marcadas como leídas`
        });
    }),

    /**
     * Obtener preferencias de notificaciones del usuario
     */
    getNotificationPreferences: catchAsync(async (req, res) => {
        const userId = req.userId;

        const preferencias = await UsuarioNotificacionPref.find({ user_id: userId });

        // Si no tiene preferencias, crear las predeterminadas
        if (preferencias.length === 0) {
            const tiposDefault = ['visitas', 'pagos', 'boletines', 'paqueteria', 'chat', 'accesos'];
            
            for (const tipo of tiposDefault) {
                await UsuarioNotificacionPref.create({
                    user_id: userId,
                    tipo_notificacion: tipo,
                    recibir_push: true
                });
            }

            // Obtener nuevamente
            const nuevasPreferencias = await UsuarioNotificacionPref.find({ user_id: userId });
            return res.json({
                success: true,
                preferencias: nuevasPreferencias
            });
        }

        res.json({
            success: true,
            preferencias
        });
    }),

    /**
     * Actualizar preferencias de notificaciones
     */
    updateNotificationPreferences: catchAsync(async (req, res) => {
        const userId = req.userId;
        const { preferencias } = req.body;

        const resultados = [];

        for (const pref of preferencias) {
            const { tipo_notificacion, recibir_push } = pref;

            const preferencia = await UsuarioNotificacionPref.findOneAndUpdate(
                { user_id: userId, tipo_notificacion },
                { recibir_push },
                { upsert: true, new: true }
            );

            resultados.push(preferencia);
        }

        res.json({
            success: true,
            message: 'Preferencias actualizadas exitosamente',
            preferencias: resultados
        });
    }),

    /**
     * Obtener cuentas bancarias para pagos
     */
    getPaymentAccounts: catchAsync(async (req, res) => {
        const cuentas = await CuentaBancaria.find({ activa: true })
            .sort({ institucion: 1, numero_cuenta: 1 });

        res.json({
            success: true,
            cuentas
        });
    }),

    /**
     * Crear cuenta bancaria (solo administradores)
     */
    createPaymentAccount: catchAsync(async (req, res) => {
        const { 
            titulo, 
            numero_cuenta, 
            institucion, 
            clabe, 
            swift_code,
            tipo_cuenta,
            moneda 
        } = req.body;

        // Verificar si ya existe la cuenta
        const existingAccount = await CuentaBancaria.findOne({
            institucion,
            numero_cuenta
        });
        if (existingAccount) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe una cuenta con esos datos'
            });
        }

        // Crear cuenta
        const cuenta = await CuentaBancaria.create({
            titulo,
            numero_cuenta,
            institucion,
            clabe,
            swift_code,
            tipo_cuenta: tipo_cuenta || 'cheques',
            moneda: moneda || 'MXN',
            activa: true
        });

        res.status(201).json({
            success: true,
            message: 'Cuenta bancaria creada exitosamente',
            cuenta
        });
    }),

    /**
     * Actualizar cuenta bancaria
     */
    updatePaymentAccount: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { titulo, numero_cuenta, institucion, clabe, swift_code, tipo_cuenta, moneda, activa } = req.body;

        const cuenta = await CuentaBancaria.findById(id);
        if (!cuenta) {
            return res.status(404).json({
                success: false,
                message: 'Cuenta bancaria no encontrada'
            });
        }

        // Verificar unicidad si se cambian datos
        if ((institucion && institucion !== cuenta.institucion) || 
            (numero_cuenta && numero_cuenta !== cuenta.numero_cuenta)) {
            
            const existingAccount = await CuentaBancaria.findOne({
                institucion: institucion || cuenta.institucion,
                numero_cuenta: numero_cuenta || cuenta.numero_cuenta,
                _id: { $ne: id }
            });
            
            if (existingAccount) {
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe otra cuenta con esos datos'
                });
            }
        }

        // Actualizar campos
        if (titulo !== undefined) cuenta.titulo = titulo;
        if (numero_cuenta !== undefined) cuenta.numero_cuenta = numero_cuenta;
        if (institucion !== undefined) cuenta.institucion = institucion;
        if (clabe !== undefined) cuenta.clabe = clabe;
        if (swift_code !== undefined) cuenta.swift_code = swift_code;
        if (tipo_cuenta !== undefined) cuenta.tipo_cuenta = tipo_cuenta;
        if (moneda !== undefined) cuenta.moneda = moneda;
        if (activa !== undefined) cuenta.activa = activa;

        await cuenta.save();

        res.json({
            success: true,
            message: 'Cuenta bancaria actualizada exitosamente',
            cuenta
        });
    }),

    /**
     * Eliminar cuenta bancaria (marcar como inactiva)
     */
    deletePaymentAccount: catchAsync(async (req, res) => {
        const { id } = req.params;

        const cuenta = await CuentaBancaria.findById(id);
        if (!cuenta) {
            return res.status(404).json({
                success: false,
                message: 'Cuenta bancaria no encontrada'
            });
        }

        // Marcar como inactiva en lugar de eliminar
        cuenta.activa = false;
        await cuenta.save();

        res.json({
            success: true,
            message: 'Cuenta bancaria marcada como inactiva'
        });
    }),

    /**
     * Registrar incidencia en bitácora (desde caseta)
     */
    logIncidence: catchAsync(async (req, res) => {
        const { 
            tipo_incidencia,
            fecha_incidencia,
            domicilio_id,
            descripcion,
            acciones_tomadas,
            necesita_seguimiento,
            notificar_residente 
        } = req.body;

        // Crear registro
        const incidencia = await BitacoraIncidencia.create({
            usuario_id: req.userId,
            tipo_incidencia,
            fecha_incidencia: fecha_incidencia ? new Date(fecha_incidencia) : new Date(),
            domicilio_id,
            descripcion,
            acciones_tomadas,
            necesita_seguimiento: necesita_seguimiento || false,
            seguimiento_completado: false,
            notificar_residente: notificar_residente || false
        });

        // Notificar al residente si se solicitó
        if (notificar_residente && domicilio_id) {
            const { Residente } = await import('../models/residente.model.js');
            const residentes = await Residente.find({
                domicilio_id,
                estatus: 'activo'
            }).populate('user_id');

            for (const residente of residentes) {
                await NotificationService.sendNotification({
                    userId: residente.user_id._id,
                    tipo: 'push',
                    titulo: '⚠️ Incidencia registrada',
                    mensaje: `Se ha registrado una incidencia de ${tipo_incidencia} en tu domicilio.`,
                    data: { 
                        tipo: 'incidence', 
                        action: 'registered',
                        incidencia_id: incidencia._id,
                        tipo_incidencia 
                    }
                });
            }

            // Marcar fecha de notificación
            incidencia.fecha_notificacion = new Date();
            incidencia.residente_notificado_id = residentes[0]?._id;
            await incidencia.save();
        }

        res.status(201).json({
            success: true,
            message: 'Incidencia registrada exitosamente',
            incidencia
        });
    }),

    /**
     * Obtener bitácora de incidencias
     */
    getIncidenceLog: catchAsync(async (req, res) => {
        const { 
            page = 1, 
            limit = 20,
            tipo_incidencia,
            domicilio_id,
            necesita_seguimiento,
            desde,
            hasta 
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        let query = {};

        if (tipo_incidencia) query.tipo_incidencia = tipo_incidencia;
        if (domicilio_id) query.domicilio_id = domicilio_id;
        if (necesita_seguimiento !== undefined) query.necesita_seguimiento = necesita_seguimiento === 'true';

        if (desde || hasta) {
            query.fecha_incidencia = {};
            if (desde) query.fecha_incidencia.$gte = new Date(desde);
            if (hasta) {
                const fechaHasta = new Date(hasta);
                fechaHasta.setHours(23, 59, 59, 999);
                query.fecha_incidencia.$lte = fechaHasta;
            }
        }

        // Obtener incidencias
        const [incidencias, total] = await Promise.all([
            BitacoraIncidencia.find(query)
                .populate('usuario_id', 'nombre apellido')
                .populate('domicilio_id')
                .populate('residente_notificado_id', 'user_id')
                .populate({
                    path: 'residente_notificado_id',
                    populate: {
                        path: 'user_id',
                        select: 'nombre apellido'
                    }
                })
                .sort({ fecha_incidencia: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            BitacoraIncidencia.countDocuments(query)
        ]);

        res.json({
            success: true,
            incidencias,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Actualizar incidencia (seguimiento)
     */
    updateIncidence: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { acciones_tomadas, seguimiento_completado } = req.body;

        const incidencia = await BitacoraIncidencia.findById(id);
        if (!incidencia) {
            return res.status(404).json({
                success: false,
                message: 'Incidencia no encontrada'
            });
        }

        // Actualizar campos
        if (acciones_tomadas !== undefined) {
            incidencia.acciones_tomadas = acciones_tomadas;
        }

        if (seguimiento_completado !== undefined) {
            incidencia.seguimiento_completado = seguimiento_completado;
        }

        await incidencia.save();

        // Notificar al residente si la incidencia tenía notificación habilitada
        if (incidencia.notificar_residente && incidencia.domicilio_id) {
            const { Residente } = await import('../models/residente.model.js');
            const residentes = await Residente.find({
                domicilio_id: incidencia.domicilio_id,
                estatus: 'activo'
            }).populate('user_id');

            for (const residente of residentes) {
                await NotificationService.sendNotification({
                    userId: residente.user_id._id,
                    tipo: 'push',
                    titulo: '✅ Seguimiento de incidencia',
                    mensaje: `Se ha actualizado el seguimiento de la incidencia registrada.`,
                    data: { 
                        tipo: 'incidence', 
                        action: 'updated',
                        incidencia_id: incidencia._id,
                        seguimiento_completado 
                    }
                });
            }
        }

        res.json({
            success: true,
            message: 'Incidencia actualizada exitosamente',
            incidencia
        });
    }),

    /**
     * Obtener dashboard con información resumida
     */
    getDashboard: catchAsync(async (req, res) => {
        const userId = req.userId;
        const roles = req.userRoles;

        let dashboardData = {
            user_info: {
                id: userId,
                roles: roles
            },
            modules: {},
            statistics: {},
            recent_activity: []
        };

        // Obtener información según el rol
        if (roles.includes('residente')) {
            const { Residente } = await import('../models/residente.model.js');
            const residente = await Residente.findOne({ user_id: userId })
                .populate('domicilio_id');

            if (residente) {
                // Visitas pendientes
                const { AutorizacionVisita } = await import('../models/autorizacionVisita.model.js');
                const visitasActivas = await AutorizacionVisita.countDocuments({
                    residente_id: residente._id,
                    estado: 'activa',
                    fecha_fin_vigencia: { $gte: new Date() }
                });

                // Paquetes por retirar
                const { Paquete } = await import('../models/paquete.model.js');
                const paquetesPendientes = await Paquete.countDocuments({
                    residente_id: residente._id,
                    estado: { $in: ['por_retirar', 'notificado'] }
                });

                // Pagos pendientes
                const { CargoDomicilio } = await import('../models/cargoDomicilio.model.js');
                const pagosPendientes = await CargoDomicilio.countDocuments({
                    domicilio_id: residente.domicilio_id._id,
                    estatus: { $in: ['pendiente', 'vencido'] },
                    saldo_pendiente: { $gt: 0 }
                });

                dashboardData.modules = {
                    visits: { count: visitasActivas, label: 'Visitas activas' },
                    packages: { count: paquetesPendientes, label: 'Paquetes pendientes' },
                    payments: { count: pagosPendientes, label: 'Pagos pendientes' }
                };
            }
        }

        if (roles.some(r => ['administrador', 'caseta', 'comite'].includes(r))) {
            // Para personal del sistema
            const { User } = await import('../models/user.model.js');
            const user = await User.findById(userId);

            dashboardData.user_info.nombre = user.nombre;
            dashboardData.user_info.apellido = user.apellido;
            dashboardData.user_info.email = user.email;

            // Obtener estadísticas según permisos
            if (roles.includes('administrador') || roles.includes('comite')) {
                const { Residente } = await import('../models/residente.model.js');
                const totalResidentes = await Residente.countDocuments({ estatus: 'activo' });
                
                const { ComprobantePago } = await import('../models/comprobantePago.model.js');
                const comprobantesPendientes = await ComprobantePago.countDocuments({ estatus: 'pendiente' });

                dashboardData.statistics.residents = totalResidentes;
                dashboardData.statistics.pending_receipts = comprobantesPendientes;
            }

            if (roles.includes('caseta')) {
                const { Paquete } = await import('../models/paquete.model.js');
                const paquetesPorRetirar = await Paquete.countDocuments({ estado: 'por_retirar' });

                const { RegistroAcceso } = await import('../models/registroAcceso.model.js');
                const visitasHoy = await RegistroAcceso.countDocuments({
                    fecha_hora_ingreso: {
                        $gte: new Date().setHours(0, 0, 0, 0)
                    }
                });

                dashboardData.statistics.packages_to_deliver = paquetesPorRetirar;
                dashboardData.statistics.today_visits = visitasHoy;
            }
        }

        // Obtener notificaciones recientes
        const { Notificacion } = await import('../models/notificacion.model.js');
        const notificacionesRecientes = await Notificacion.find({
            user_id: userId,
            leida: false
        })
        .sort({ created_at: -1 })
        .limit(5);

        dashboardData.recent_activity = notificacionesRecientes;

        res.json({
            success: true,
            dashboard: dashboardData
        });
    }),

    /**
     * Buscar en el sistema (búsqueda global)
     */
    globalSearch: catchAsync(async (req, res) => {
        const { q, limit = 10 } = req.query;

        if (!q || q.trim().length < 2) {
            return res.json({
                success: true,
                results: []
            });
        }

        const searchTerm = q.trim();
        const results = {
            residents: [],
            users: [],
            visits: [],
            packages: []
        };

        // Búsqueda en residentes
        const { Residente } = await import('../models/residente.model.js');
        const { User } = await import('../models/user.model.js');
        
        // Buscar usuarios que coincidan
        const matchingUsers = await User.find({
            $or: [
                { nombre: { $regex: searchTerm, $options: 'i' } },
                { apellido: { $regex: searchTerm, $options: 'i' } },
                { email: { $regex: searchTerm, $options: 'i' } }
            ]
        }).limit(parseInt(limit));

        if (matchingUsers.length > 0) {
            // Obtener residentes de estos usuarios
            const residentes = await Residente.find({
                user_id: { $in: matchingUsers.map(u => u._id) }
            }).populate('user_id').populate('domicilio_id');

            results.residents = residentes.map(r => ({
                type: 'resident',
                id: r._id,
                name: `${r.user_id.nombre} ${r.user_id.apellido}`,
                email: r.user_id.email,
                details: r.domicilio_id ? `Domicilio: ${r.domicilio_id.numero}` : ''
            }));
        }

        // Búsqueda en visitas
        const { AutorizacionVisita } = await import('../models/autorizacionVisita.model.js');
        const matchingVisits = await AutorizacionVisita.find({
            nombre_visitante: { $regex: searchTerm, $options: 'i' }
        })
        .populate('residente_id')
        .populate({
            path: 'residente_id',
            populate: {
                path: 'user_id',
                select: 'nombre apellido'
            }
        })
        .limit(parseInt(limit));

        results.visits = matchingVisits.map(v => ({
            type: 'visit',
            id: v._id,
            name: v.nombre_visitante,
            resident: v.residente_id?.user_id ? 
                `${v.residente_id.user_id.nombre} ${v.residente_id.user_id.apellido}` : 'N/A',
            status: v.estado
        }));

        // Búsqueda en paquetes
        const { Paquete } = await import('../models/paquete.model.js');
        const matchingPackages = await Paquete.find({
            $or: [
                { descripcion: { $regex: searchTerm, $options: 'i' } },
                { empresa_paqueteria: { $regex: searchTerm, $options: 'i' } },
                { numero_guia: { $regex: searchTerm, $options: 'i' } }
            ]
        })
        .populate('residente_id')
        .populate({
            path: 'residente_id',
            populate: {
                path: 'user_id',
                select: 'nombre apellido'
            }
        })
        .limit(parseInt(limit));

        results.packages = matchingPackages.map(p => ({
            type: 'package',
            id: p._id,
            description: p.descripcion,
            company: p.empresa_paqueteria,
            resident: p.residente_id?.user_id ? 
                `${p.residente_id.user_id.nombre} ${p.residente_id.user_id.apellido}` : 'N/A',
            status: p.estado
        }));

        // Combinar todos los resultados
        const allResults = [
            ...results.residents,
            ...results.visits,
            ...results.packages
        ].slice(0, parseInt(limit));

        res.json({
            success: true,
            query: searchTerm,
            total_results: allResults.length,
            results: allResults
        });
    }),

    /**
     * Obtener configuración del sistema
     */
    getSystemConfig: catchAsync(async (req, res) => {
        // Configuración básica del sistema
        const config = {
            app_name: 'Sistema de Gestión Residencial',
            version: '1.0.0',
            features: {
                qr_enabled: true,
                push_notifications: true,
                file_uploads: true,
                chat_enabled: true,
                payment_tracking: true
            },
            limits: {
                max_file_size_mb: 10,
                max_visits_per_resident: 100,
                max_packages_per_resident: 50
            },
            contact: {
                support_email: process.env.SUPPORT_EMAIL || 'soporte@sistema.com',
                admin_phone: process.env.ADMIN_PHONE || ''
            }
        };

        res.json({
            success: true,
            config
        });
    })
};