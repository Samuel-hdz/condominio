import PermissionService from '../libs/permissions.js';

/**
 * Middleware para verificar permisos de módulo
 * @param {String} moduleRoute - Ruta del módulo
 * @param {String} requiredLevel - Nivel requerido ('ver', 'editar', 'administrar')
 */
export const requirePermission = (moduleRoute, requiredLevel = 'ver') => {
    return async (req, res, next) => {
        try {
            if (!req.userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Usuario no autenticado.'
                });
            }

            const hasPermission = await PermissionService.hasPermission(
                req.userId,
                moduleRoute,
                requiredLevel
            );

            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    message: `No tienes permisos de ${requiredLevel} para este módulo.`
                });
            }

            next();
        } catch (error) {
            console.error('Error verificando permisos:', error);
            return res.status(500).json({
                success: false,
                message: 'Error verificando permisos.'
            });
        }
    };
};

/**
 * Middleware para verificar acceso al panel de administrador
 */
export const requireAdminPanelAccess = async (req, res, next) => {
    try {
        if (!req.userRoles) {
            return res.status(401).json({
                success: false,
                message: 'Usuario no autenticado.'
            });
        }

        // Roles que tienen acceso al panel de administrador
        const adminPanelRoles = ['administrador', 'caseta', 'comite'];
        
        const hasAccess = req.userRoles.some(role => 
            adminPanelRoles.includes(role)
        );

        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'No tienes acceso al panel de administrador.'
            });
        }

        next();
    } catch (error) {
        console.error('Error verificando acceso al panel:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verificando acceso al panel.'
        });
    }
};

/**
 * Middleware para verificar acceso específico de caseta
 */
export const requireCasetaAccess = async (req, res, next) => {
    try {
        if (!req.userRoles || !req.userRoles.includes('caseta')) {
            return res.status(403).json({
                success: false,
                message: 'Solo personal de caseta puede acceder a este recurso.'
            });
        }

        // Verificar permisos específicos de caseta
        const hasPermission = await PermissionService.hasPermission(
            req.userId,
            '/caseta',
            'ver'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permisos para acceder a los módulos de caseta.'
            });
        }

        next();
    } catch (error) {
        console.error('Error verificando acceso de caseta:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verificando permisos de caseta.'
        });
    }
};

/**
 * Middleware para verificar acceso de administrador completo
 */
export const requireFullAdmin = async (req, res, next) => {
    try {
        if (!req.userRoles || !req.userRoles.includes('administrador')) {
            return res.status(403).json({
                success: false,
                message: 'Solo administradores pueden acceder a este recurso.'
            });
        }

        // Verificar permisos de administrador en módulos clave
        const modulesToCheck = ['/admin', '/cobranza', '/config'];
        
        for (const moduleRoute of modulesToCheck) {
            const hasPermission = await PermissionService.hasPermission(
                req.userId,
                moduleRoute,
                'administrar'
            );

            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permisos de administrador completos.'
                });
            }
        }

        next();
    } catch (error) {
        console.error('Error verificando permisos de admin:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verificando permisos de administrador.'
        });
    }
};

/**
 * Middleware para verificar permisos de residente en su app móvil
 */
export const requireResidentMobileAccess = async (req, res, next) => {
    try {
        if (!req.userRoles || !req.userRoles.includes('residente')) {
            return res.status(403).json({
                success: false,
                message: 'Solo residentes pueden acceder a la aplicación móvil.'
            });
        }

        // Verificar que el residente esté activo
        const { Residente } = await import('../models/residente.model.js');
        const residente = await Residente.findOne({
            user_id: req.userId,
            estatus: 'activo'
        });

        if (!residente) {
            return res.status(403).json({
                success: false,
                message: 'Residente no encontrado o inactivo.'
            });
        }

        req.residenteId = residente._id;
        req.domicilioId = residente.domicilio_id;
        next();
    } catch (error) {
        console.error('Error verificando acceso de residente:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verificando acceso de residente.'
        });
    }
};