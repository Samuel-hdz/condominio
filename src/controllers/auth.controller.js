import { generateToken } from '../libs/jwt.js';
import { User } from '../models/user.model.js';
import { UserRole } from '../models/userRole.model.js';
import { Residente } from '../models/residente.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import PermissionService from '../libs/permissions.js';
import jwt from 'jsonwebtoken';

export const authController = {
    /**
     * Login de usuario
     */
    loginMobile: catchAsync(async (req, res) => {
        const { username, password } = req.body;

        console.log(`📱 Intento de login móvil para: ${username}`);

        // Buscar usuario
        const user = await User.findOne({
            $or: [{ username }, { email: username }]
        });

        // Validaciones básicas
        if (!user) {
            console.log(`Usuario no encontrado: ${username}`);
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        if (user.estatus !== 'activo') {
            console.log(`Usuario inactivo: ${user._id}`);
            return res.status(403).json({
                success: false,
                message: 'Usuario inactivo. Contacte al administrador.'
            });
        }

        // Verificar contraseña
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            console.log(`Contraseña incorrecta para: ${user._id}`);
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // Obtener roles
        const userRoles = await UserRole.find({ user_id: user._id });
        const roleNames = userRoles.map(r => r.role);

        // ✅ VERIFICACIÓN CRÍTICA: Solo residentes pueden usar login móvil
        if (!roleNames.includes('residente')) {
            console.log(`Usuario no residente intentando login móvil: ${user._id}, roles: ${roleNames}`);
            return res.status(403).json({
                success: false,
                message: 'Esta aplicación es solo para residentes. Los administradores deben usar el panel web.',
                code: 'MOBILE_LOGIN_RESIDENTS_ONLY',
                userRoles: roleNames
            });
        }

        // Verificar que el residente esté activo
        const residentInfo = await Residente.findOne({ 
            user_id: user._id,
            estatus: 'activo'
        }).populate('domicilio_id');

        if (!residentInfo) {
            console.log(`Residente no encontrado o inactivo: ${user._id}`);
            return res.status(403).json({
                success: false,
                message: 'Residente no encontrado o inactivo'
            });
        }

        // Generar token (marcar como 'mobile' en los datos)
        const tokenPayload = {
            id: user._id,
            email: user.email,
            username: user.username,
            nombre: user.nombre,
            apellido: user.apellido,
            roles: roleNames,
            platform: 'mobile',
            residenteId: residentInfo._id,
            domicilioId: residentInfo.domicilio_id._id
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { 
            expiresIn: process.env.JWT_EXPIRES_IN || '7d' 
        });

        console.log(`Login móvil exitoso: ${user.email}, residente: ${residentInfo._id}`);

        // Respuesta
        res.json({
            success: true,
            message: 'Login exitoso en app móvil',
            token,
            user: {
                id: user._id,
                email: user.email,
                nombre: user.nombre,
                apellido: user.apellido,
                telefono: user.telefono,
                roles: roleNames,
                estatus: user.estatus,
                residente: {
                    id: residentInfo._id,
                    domicilio: residentInfo.domicilio_id,
                    es_principal: residentInfo.es_principal
                }
            }
        });
    }),

    /**
     * LOGIN PARA PANEL WEB (EXCLUSIVO para admin/caseta/comite)
     */
    loginWeb: catchAsync(async (req, res) => {
        const { username, password } = req.body;

        console.log(`Intento de login web para: ${username}`);

        // Buscar usuario
        const user = await User.findOne({
            $or: [{ username }, { email: username }]
        });

        // Validaciones básicas
        if (!user) {
            console.log(`Usuario no encontrado: ${username}`);
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        if (user.estatus !== 'activo') {
            console.log(`Usuario inactivo: ${user._id}`);
            return res.status(403).json({
                success: false,
                message: 'Usuario inactivo. Contacte al administrador.'
            });
        }

        // Verificar contraseña
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            console.log(`Contraseña incorrecta para: ${user._id}`);
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // Obtener roles
        const userRoles = await UserRole.find({ user_id: user._id });
        const roleNames = userRoles.map(r => r.role);

        console.log(roleNames)

        // Solo estos roles pueden usar login web
        const allowedWebRoles = ['administrador', 'caseta', 'comite'];
        const hasWebRole = roleNames.some(role => allowedWebRoles.includes(role));
        
        if (!hasWebRole) {
            console.log(`Usuario no autorizado para web: ${user._id}, roles: ${roleNames}`);
            return res.status(403).json({
                success: false,
                message: 'Este panel es solo para administradores y personal autorizado. Los residentes deben usar la aplicación móvil.',
                code: 'WEB_LOGIN_ADMINS_ONLY',
                userRoles: roleNames,
                allowedRoles: allowedWebRoles
            });
        }

        // Si es miembro del comité, también obtener info de residente
        let residentInfo = null;
        if (roleNames.includes('comite') && roleNames.includes('residente')) {
            residentInfo = await Residente.findOne({ 
                user_id: user._id,
                estatus: 'activo'
            }).populate('domicilio_id');
        }

        // Obtener permisos para el panel (si es admin/caseta/comite)
        let permissions = {};
        if (roleNames.some(r => ['administrador', 'caseta', 'comite'].includes(r))) {
            permissions = await PermissionService.getModuleTreeWithPermissions(user._id);
        }

        // Generar token (marcar como 'web' en los datos)
        const tokenPayload = {
            id: user._id,
            email: user.email,
            username: user.username,
            nombre: user.nombre,
            apellido: user.apellido,
            roles: roleNames,
            platform: 'web', // ← MARCADOR IMPORTANTE
            iat: Math.floor(Date.now() / 1000)
        };

        // Si es residente (comité), agregar info
        if (residentInfo) {
            tokenPayload.residenteId = residentInfo._id;
            tokenPayload.domicilioId = residentInfo.domicilio_id._id;
        }

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { 
            expiresIn: process.env.JWT_EXPIRES_IN || '7d' 
        });

        console.log(`Login web exitoso: ${user.email}, roles: ${roleNames}`);

        // Preparar respuesta
        const response = {
            success: true,
            message: 'Login exitoso en panel web',
            token,
            user: {
                id: user._id,
                email: user.email,
                nombre: user.nombre,
                apellido: user.apellido,
                telefono: user.telefono,
                roles: roleNames,
                estatus: user.estatus,
                permissions: permissions
            }
        };

        // Agregar info de residente si es miembro del comité
        if (residentInfo) {
            response.user.residente = {
                id: residentInfo._id,
                domicilio: residentInfo.domicilio_id,
                es_principal: residentInfo.es_principal
            };
        }

        res.json(response);
    }),

    /**
     * Obtener perfil del usuario autenticado
     */
    getProfile: catchAsync(async (req, res) => {
        const user = req.user;
        const roles = req.userRoles;

        // Obtener información adicional según el rol
        let additionalInfo = {};

        if (roles.includes('residente')) {
            const residente = await Residente.findOne({ 
                user_id: user._id 
            }).populate({
                path: 'domicilio_id',
                populate: {
                    path: 'calle_torre_id',
                    populate: {
                        path: 'unidad_geografica_id'
                    }
                }
            });

            if (residente) {
                additionalInfo.residente = {
                    id: residente._id,
                    domicilio: residente.domicilio_id,
                    es_principal: residente.es_principal,
                    estatus: residente.estatus
                };
            }
        }

        // Si es admin/caseta/comite, obtener permisos
        if (roles.some(r => ['administrador', 'caseta', 'comite'].includes(r))) {
            const permissions = await PermissionService.getModuleTreeWithPermissions(user._id);
            additionalInfo.permissions = permissions;
        }

        res.json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                nombre: user.nombre,
                apellido: user.apellido,
                telefono: user.telefono,
                roles: roles,
                estatus: user.estatus,
                ...additionalInfo
            }
        });
    }),

    /**
     * Cambiar contraseña
     */
    changePassword: catchAsync(async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        const userId = req.userId;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Verificar contraseña actual
        const isValidPassword = await user.comparePassword(currentPassword);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Contraseña actual incorrecta'
            });
        }

        // Actualizar contraseña
        user.password_hash = newPassword;
        await user.save();

        res.json({
            success: true,
            message: 'Contraseña actualizada exitosamente'
        });
    }),

    /**
     * Logout (en el cliente se debe eliminar el token)
     */
    logout: catchAsync(async (req, res) => {
        // En JWT stateless, el logout se maneja en el cliente
        // Pero podríamos agregar el token a una blacklist si fuera necesario
        
        res.json({
            success: true,
            message: 'Logout exitoso'
        });
    }),

    /**
     * Validar token (para verificar si sigue siendo válido)
     */
    validateToken: catchAsync(async (req, res) => {
        // Si llegamos aquí, el middleware de autenticación ya validó el token
        const user = req.user;
        const roles = req.userRoles;

        // Obtener información actualizada
        const updatedUser = await User.findById(user._id).select('-password_hash');
        
        if (!updatedUser || updatedUser.estatus !== 'activo') {
            return res.status(401).json({
                success: false,
                message: 'Token inválido - usuario inactivo'
            });
        }

        res.json({
            success: true,
            message: 'Token válido',
            user: {
                id: updatedUser._id,
                email: updatedUser.email,
                username: updatedUser.username,
                nombre: updatedUser.nombre,
                apellido: updatedUser.apellido,
                telefono: updatedUser.telefono,
                roles: roles,
                estatus: updatedUser.estatus
            }
        });
    })
};