import { User } from '../models/user.model.js';
import { UserRole } from '../models/userRole.model.js';
import { PerfilUsuario } from '../models/perfilUsuario.model.js';
import { PermisoUsuario } from '../models/permisoUsuario.model.js';
import { ModuloSistema } from '../models/moduloSistema.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import PermissionService from '../libs/permissions.js';
import NotificationService from '../libs/notifications.js';
import { PerfilPermiso } from '../models/perfilPermiso.model.js';

export const usersController = {
    /**
     * Crear nuevo usuario (para administradores)
     */
    createUser: catchAsync(async (req, res) => {
        const { 
            email, 
            username, 
            password, 
            nombre, 
            apellido, 
            telefono, 
            roles,
            asignarPerfil 
        } = req.body;

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

        // Asignar roles
        if (roles && Array.isArray(roles)) {
            for (const role of roles) {
                await UserRole.create({
                    user_id: user._id,
                    role
                });

                // Si se especificó un perfil para asignar, asignar permisos predeterminados
                if (asignarPerfil) {
                    const perfil = await PerfilPermiso.findById(asignarPerfil);
                    if (perfil && perfil.permisos_json) {
                        // Asignar permisos del perfil
                        for (const [moduloNombre, nivel] of Object.entries(perfil.permisos_json)) {
                            const modulo = await ModuloSistema.findOne({ nombre: moduloNombre });
                            if (modulo) {
                                await PermisoUsuario.create({
                                    user_id: user._id,
                                    modulo_id: modulo._id,
                                    nivel_permiso: nivel
                                });
                            }
                        }
                    }
                } else {
                    // Asignar permisos predeterminados según rol
                    await PermissionService.assignDefaultPermissions(user._id, role);
                }
            }
        }

        // Enviar notificación al usuario creado
        await NotificationService.sendNotification({
            userId: user._id,
            tipo: 'in_app',
            titulo: '👋 ¡Bienvenido al sistema!',
            mensaje: `Hola ${nombre}, tu cuenta ha sido creada exitosamente.`,
            data: { tipo: 'system', action: 'welcome' }
        });

        res.status(201).json({
            success: true,
            message: 'Usuario creado exitosamente',
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                nombre: user.nombre,
                apellido: user.apellido,
                telefono: user.telefono,
                estatus: user.estatus
            }
        });
    }),

    /**
     * Obtener todos los usuarios (con paginación y filtros)
     */
    getAllUsers: catchAsync(async (req, res) => {
        const { 
            page = 1, 
            limit = 20, 
            search, 
            role,
            estatus 
        } = req.query;

        const skip = (page - 1) * limit;

        // Construir query
        let query = {};

        // Filtro por búsqueda
        if (search) {
            query.$or = [
                { nombre: { $regex: search, $options: 'i' } },
                { apellido: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } }
            ];
        }

        // Filtro por estatus
        if (estatus) {
            query.estatus = estatus;
        }

        // Filtro por rol (necesita join con UserRole)
        let roleFilter = {};
        if (role) {
            const usersWithRole = await UserRole.find({ role }).distinct('user_id');
            query._id = { $in: usersWithRole };
        }

        // Obtener usuarios
        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password_hash')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(query)
        ]);

        // Obtener roles para cada usuario
        const usersWithRoles = await Promise.all(
            users.map(async (user) => {
                const roles = await UserRole.find({ user_id: user._id });
                const permisosSummary = await PermissionService.getPermissionsSummary(user._id);
                
                return {
                    ...user.toObject(),
                    roles: roles.map(r => r.role),
                    permisos_summary: permisosSummary
                };
            })
        );

        res.json({
            success: true,
            users: usersWithRoles,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    }),

    /**
     * Obtener usuario por ID
     */
    getUserById: catchAsync(async (req, res) => {
        const { id } = req.params;

        const user = await User.findById(id).select('-password_hash');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Obtener roles
        const roles = await UserRole.find({ user_id: user._id });
        
        // Obtener perfil de usuario
        const perfil = await PerfilUsuario.findOne({ user_id: user._id });
        
        // Obtener permisos
        const permissions = await PermissionService.getUserPermissions(user._id);
        const permisosSummary = await PermissionService.getPermissionsSummary(user._id);

        // Obtener notificaciones no leídas
        const { Notificacion } = await import('../models/notificacion.model.js');
        const unreadNotifications = await Notificacion.countDocuments({
            user_id: user._id,
            leida: false
        });

        res.json({
            success: true,
            user: {
                ...user.toObject(),
                roles: roles.map(r => r.role),
                perfil: perfil || null,
                permissions,
                permisos_summary: permisosSummary,
                unread_notifications: unreadNotifications
            }
        });
    }),

    /**
     * Actualizar usuario
     */
    updateUser: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { nombre, apellido, telefono, estatus } = req.body;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Actualizar campos
        if (nombre) user.nombre = nombre;
        if (apellido) user.apellido = apellido;
        if (telefono) user.telefono = telefono;
        if (estatus) user.estatus = estatus;

        await user.save();

        // Si se desactivó al usuario, enviar notificación
        if (estatus === 'inactivo' || estatus === 'suspendido') {
            await NotificationService.sendNotification({
                userId: user._id,
                tipo: 'in_app',
                titulo: '⚠️ Cuenta actualizada',
                mensaje: `Tu cuenta ha sido ${estatus === 'inactivo' ? 'desactivada' : 'suspendida'}.`,
                data: { tipo: 'system', action: 'account_updated' }
            });
        }

        res.json({
            success: true,
            message: 'Usuario actualizado exitosamente',
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                nombre: user.nombre,
                apellido: user.apellido,
                telefono: user.telefono,
                estatus: user.estatus
            }
        });
    }),

    /**
     * Asignar/actualizar roles de usuario
     */
    updateUserRoles: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { roles } = req.body;

        // Verificar que el usuario exista
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Eliminar roles actuales
        await UserRole.deleteMany({ user_id: user._id });

        // Asignar nuevos roles
        const newRoles = [];
        for (const role of roles) {
            const userRole = await UserRole.create({
                user_id: user._id,
                role
            });
            newRoles.push(userRole);

            // Asignar permisos predeterminados para el rol
            await PermissionService.assignDefaultPermissions(user._id, role);
        }

        // Enviar notificación al usuario
        await NotificationService.sendNotification({
            userId: user._id,
            tipo: 'in_app',
            titulo: '👑 Roles actualizados',
            mensaje: 'Tus roles en el sistema han sido actualizados.',
            data: { 
                tipo: 'system', 
                action: 'roles_updated',
                roles: roles 
            }
        });

        res.json({
            success: true,
            message: 'Roles actualizados exitosamente',
            roles: newRoles.map(r => r.role)
        });
    }),

    /**
     * Actualizar permisos de usuario
     */
    updateUserPermissions: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { permissions } = req.body;

        // Verificar que el usuario exista
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Actualizar permisos usando el servicio
        const updatedPermissions = await PermissionService.updateUserPermissions(
            user._id,
            permissions
        );

        res.json({
            success: true,
            message: 'Permisos actualizados exitosamente',
            permissions: updatedPermissions
        });
    }),

    /**
     * Asignar perfil predefinido a usuario
     */
    assignProfileToUser: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { perfilId } = req.body;

        // Verificar que el usuario exista
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Obtener perfil
        const perfil = await PerfilPermiso.findById(perfilId);
        if (!perfil) {
            return res.status(404).json({
                success: false,
                message: 'Perfil no encontrado'
            });
        }

        // Eliminar permisos actuales del usuario
        await PermisoUsuario.deleteMany({ user_id: user._id });

        // Asignar permisos del perfil
        if (perfil.permisos_json) {
            for (const [moduloNombre, nivel] of Object.entries(perfil.permisos_json)) {
                const modulo = await ModuloSistema.findOne({ nombre: moduloNombre });
                if (modulo) {
                    await PermisoUsuario.create({
                        user_id: user._id,
                        modulo_id: modulo._id,
                        nivel_permiso: nivel
                    });
                }
            }
        }

        res.json({
            success: true,
            message: 'Perfil asignado exitosamente',
            perfil: perfil.nombre_perfil
        });
    }),

    /**
     * Obtener módulos del sistema con permisos del usuario
     */
    getUserModulesWithPermissions: catchAsync(async (req, res) => {
        const { id } = req.params;

        const modules = await PermissionService.getModuleTreeWithPermissions(id);

        res.json({
            success: true,
            modules
        });
    }),

    /**
     * Obtener historial de actividad del usuario
     */
    getUserActivity: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        const { AuditoriaGeneral } = await import('../models/auditoriaGeneral.model.js');

        const [activities, total] = await Promise.all([
            AuditoriaGeneral.find({ usuario_id: id })
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            AuditoriaGeneral.countDocuments({ usuario_id: id })
        ]);

        res.json({
            success: true,
            activities,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    })
};