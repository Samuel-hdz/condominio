import { extractTokenFromHeader, verifyToken } from '../libs/jwt.js';
import { User } from '../models/user.model.js';
import { UserRole } from '../models/userRole.model.js';

/**
 * Middleware para verificar autenticación JWT
 */
export const authenticate = async (req, res, next) => {
    try {
        // Obtener token del header
        const authHeader = req.headers.authorization;
        const token = extractTokenFromHeader(authHeader);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Acceso no autorizado. Token requerido.'
            });
        }

        // Verificar token
        const decoded = verifyToken(token);

        // Buscar usuario
        const user = await User.findById(decoded.id).select('-password_hash');
        if (!user || user.estatus !== 'activo') {
            return res.status(401).json({
                success: false,
                message: 'Usuario no encontrado o inactivo.'
            });
        }

        // Obtener roles del usuario
        const roles = await UserRole.find({ user_id: user._id });
        const roleNames = roles.map(r => r.role);

        // Agregar información al request
        req.user = user;
        req.userRoles = roleNames;
        req.userId = user._id;

        next();
    } catch (error) {
        console.error('Error en autenticación:', error.message);
        
        if (error.message.includes('Token inválido') || error.message.includes('expirado')) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado.'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error en la autenticación.'
        });
    }
};

/**
 * Middleware para verificar roles específicos
 * @param {...String} allowedRoles - Roles permitidos
 */
export const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Usuario no autenticado.'
                });
            }

            if (!Array.isArray(req.userRoles)) {
                return res.status(403).json({
                    success: false,
                    message: 'Roles de usuario no disponibles.'
                });
            }

            const hasRequiredRole = req.userRoles.some(role =>
                allowedRoles.includes(role)
            );

            if (!hasRequiredRole) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permisos para acceder a este recurso.'
                });
            }

            next();
        } catch (error) {
            next(error); // 👈 MUY IMPORTANTE
        }
    };
};


/**
 * Middleware para verificar si el usuario es residente principal
 */
export const requirePrincipalResident = async (req, res, next) => {
    try {
        const { Residente } = await import('../models/residente.model.js');
        
        // Verificar si el usuario es residente principal
        const residente = await Residente.findOne({
            user_id: req.userId,
            es_principal: true
        });

        if (!residente) {
            return res.status(403).json({
                success: false,
                message: 'Solo residentes principales pueden realizar esta acción.'
            });
        }

        req.residenteId = residente._id;
        req.esPrincipal = true;
        next();
    } catch (error) {
        console.error('Error verificando residente principal:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verificando permisos de residente.'
        });
    }
};

/**
 * Middleware para verificar acceso a recursos del propio usuario
 */
export const requireSelfOrAdmin = (paramName = 'id') => {
    return async (req, res, next) => {
        try {
            const resourceId = req.params[paramName] || req.body.userId;
            
            // Si es administrador, permitir acceso
            if (req.userRoles.includes('administrador')) {
                return next();
            }

            // Si el usuario intenta acceder a sus propios recursos
            if (resourceId === req.userId.toString()) {
                return next();
            }

            // Si el usuario es residente principal y el recurso pertenece a su domicilio
            if (req.userRoles.includes('residente')) {
                const { Residente } = await import('../models/residente.model.js');
                
                const residente = await Residente.findOne({ 
                    user_id: req.userId,
                    es_principal: true 
                }).populate('domicilio_id');

                if (residente) {
                    // Verificar si el recurso solicitado pertenece al mismo domicilio
                    const otherResidente = await Residente.findOne({
                        user_id: resourceId,
                        domicilio_id: residente.domicilio_id._id
                    });

                    if (otherResidente) {
                        return next();
                    }
                }
            }

            return res.status(403).json({
                success: false,
                message: 'No tienes permisos para acceder a este recurso.'
            });
        } catch (error) {
            console.error('Error en middleware requireSelfOrAdmin:', error);
            return res.status(500).json({
                success: false,
                message: 'Error verificando permisos.'
            });
        }
    };
};

// middlewares/auth.js, agregar al final:

/**
 * Middleware para bloquear residentes suspendidos/inactivos
 */
export const blockSuspendedResidents = async (req, res, next) => {
    try {
        // Solo aplica a rutas de residentes
        if (req.userRoles && req.userRoles.includes('residente')) {
            // Verificar si el usuario está activo
            const user = await User.findById(req.userId);
            
            if (user && (user.estatus === 'suspendido' || user.estatus === 'inactivo')) {
                return res.status(403).json({
                    success: false,
                    message: `Tu cuenta está ${user.estatus}. Contacta al administrador.`,
                    estatus: user.estatus,
                    bloqueado: true
                });
            }
        }
        
        next();
    } catch (error) {
        console.error('Error en blockSuspendedResidents:', error);
        next();
    }
};