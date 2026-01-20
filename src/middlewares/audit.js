import { AuditoriaGeneral } from '../models/auditoriaGeneral.model.js';

/**
 * Middleware para registrar auditoría de acciones
 */

/**
 * Registra acciones importantes en el sistema
 * @param {Object} options - Opciones de auditoría
 */
export const auditAction = (options = {}) => {
    const {
        action,
        description,
        resource,
        logBody = false,
        logParams = false,
        logQuery = false
    } = options;

    return async (req, res, next) => {
        // Guardar referencia a la función original de res.json
        const originalJson = res.json;

        // Sobrescribir res.json para interceptar la respuesta
        res.json = function(data) {
            // Llamar a la función original
            originalJson.call(this, data);

            // Registrar auditoría de manera asíncrona (no bloquear respuesta)
            setTimeout(async () => {
                try {
                    if (!req.userId) return;

                    const auditData = {
                        tabla: resource || req.baseUrl + req.path,
                        registro_id: req.params.id || 'multiple',
                        accion: action || req.method,
                        usuario_id: req.userId,
                        datos_nuevos: {},
                        ip_address: req.ip,
                        user_agent: req.get('user-agent')
                    };

                    // Incluir datos según configuración
                    if (logBody && req.body) {
                        // Excluir datos sensibles
                        const safeBody = { ...req.body };
                        if (safeBody.password) delete safeBody.password;
                        if (safeBody.password_hash) delete safeBody.password_hash;
                        if (safeBody.token) delete safeBody.token;
                        
                        auditData.datos_nuevos.body = safeBody;
                    }

                    if (logParams && req.params) {
                        auditData.datos_nuevos.params = req.params;
                    }

                    if (logQuery && req.query) {
                        auditData.datos_nuevos.query = req.query;
                    }

                    // Incluir resultado de la acción
                    if (data.success !== undefined) {
                        auditData.datos_nuevos.result = {
                            success: data.success,
                            message: data.message
                        };
                    }

                    // Guardar en auditoría
                    await AuditoriaGeneral.create(auditData);
                } catch (error) {
                    console.error('Error registrando auditoría:', error);
                }
            }, 0);
        };

        next();
    };
};

/**
 * Middleware para registrar acceso a rutas sensibles
 */
export const auditSensitiveAccess = () => {
    return auditAction({
        description: 'Acceso a ruta sensible',
        logBody: false,
        logParams: true,
        logQuery: true
    });
};

/**
 * Middleware específico para acciones administrativas
 */
export const auditAdminActions = () => {
    return auditAction({
        action: 'ADMIN_ACTION',
        description: 'Acción administrativa',
        logBody: true,
        logParams: true
    });
};

/**
 * Middleware específico para acciones financieras
 */
export const auditFinancialActions = () => {
    return auditAction({
        action: 'FINANCIAL_ACTION',
        description: 'Acción financiera',
        logBody: true,
        logParams: true,
        resource: 'financial'
    });
};

/**
 * Middleware específico para acciones de seguridad
 */
export const auditSecurityActions = () => {
    return auditAction({
        action: 'SECURITY_ACTION',
        description: 'Acción de seguridad',
        logBody: true,
        logParams: true,
        resource: 'security'
    });
};