// src/middlewares/platform.js
import { verifyToken } from '../libs/jwt.js';

/**
 * Verifica que el token sea del tipo correcto (mobile/web)
 */
export const validatePlatform = (requiredPlatform) => {
    return (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({
                    success: false,
                    message: 'Token requerido'
                });
            }

            const token = authHeader.replace('Bearer ', '');
            const decoded = verifyToken(token);

            // Verificar plataforma del token
            if (decoded.platform !== requiredPlatform) {
                const platformNames = {
                    mobile: 'app móvil',
                    web: 'panel web'
                };
                
                return res.status(403).json({
                    success: false,
                    message: `Este endpoint es exclusivo para ${platformNames[requiredPlatform]}`,
                    code: 'PLATFORM_MISMATCH'
                });
            }

            req.tokenPlatform = decoded.platform;
            next();
            
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido'
            });
        }
    };
};

export const requireMobileToken = validatePlatform('mobile');
export const requireWebToken = validatePlatform('web');