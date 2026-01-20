import { generateToken } from '../libs/jwt.js';
import { User } from '../models/user.model.js';
import { UserRole } from '../models/userRole.model.js';
import { Residente } from '../models/residente.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import PermissionService from '../libs/permissions.js';

export const authController = {
    /**
     * Login de usuario
     */
    login: catchAsync(async (req, res) => {
        const { username, password } = req.body;

        // Buscar usuario por username o email
        const user = await User.findOne({
            $or: [
                { username },
                { email: username }
            ]
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // Verificar contraseña
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // Verificar que el usuario esté activo
        if (user.estatus !== 'activo') {
            return res.status(403).json({
                success: false,
                message: 'Usuario inactivo. Contacte al administrador.'
            });
        }

        // Obtener roles del usuario
        const userRoles = await UserRole.find({ user_id: user._id });
        const roleNames = userRoles.map(r => r.role);

        // Si es residente, obtener información adicional
        let residentInfo = null;
        if (roleNames.includes('residente')) {
            residentInfo = await Residente.findOne({ 
                user_id: user._id 
            }).populate('domicilio_id');
        }

        // Generar token JWT
        const token = generateToken(user, roleNames);

        // Preparar respuesta según el tipo de usuario
        let userData = {
            id: user._id,
            email: user.email,
            username: user.username,
            nombre: user.nombre,
            apellido: user.apellido,
            telefono: user.telefono,
            roles: roleNames,
            estatus: user.estatus
        };

        // Agregar información específica de residente
        if (residentInfo) {
            userData.residente = {
                id: residentInfo._id,
                domicilio_id: residentInfo.domicilio_id,
                es_principal: residentInfo.es_principal,
                estatus: residentInfo.estatus
            };
        }

        // Si es admin/caseta/comite, obtener permisos
        if (roleNames.some(r => ['administrador', 'caseta', 'comite'].includes(r))) {
            const permissions = await PermissionService.getModuleTreeWithPermissions(user._id);
            userData.permissions = permissions;
        }

        res.json({
            success: true,
            message: 'Login exitoso',
            token,
            user: userData
        });
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