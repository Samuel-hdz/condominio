/**
 * Middleware para manejo centralizado de errores
 */

/**
 * Clase personalizada para errores de la aplicación
 */
export class AppError extends Error {
    constructor(message, statusCode = 500, errors = null) {
        super(message);
        this.statusCode = statusCode;
        this.errors = errors;
        this.isOperational = true;
        
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Middleware para capturar errores 404
 */
export const notFound = (req, res, next) => {
    const error = new AppError(`Ruta no encontrada: ${req.originalUrl}`, 404);
    next(error);
};

/**
 * Middleware de manejo de errores global
 */
export const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.message = err.message || 'Error interno del servidor';

    // Log del error
    console.error('❌ Error:', {
        message: err.message,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // Errores de Mongoose
    if (err.name === 'CastError') {
        err = new AppError(`ID inválido: ${err.value}`, 400);
    }

    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(el => el.message);
        err = new AppError('Error de validación', 400, errors);
    }

    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        err = new AppError(`El valor del campo '${field}' ya existe`, 400);
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        err = new AppError('Token inválido', 401);
    }

    if (err.name === 'TokenExpiredError') {
        err = new AppError('Token expirado', 401);
    }

    // Response al cliente
    res.status(err.statusCode).json({
        success: false,
        message: err.message,
        errors: err.errors || undefined,
        ...(process.env.NODE_ENV === 'development' && { 
            stack: err.stack,
            path: req.path,
            method: req.method
        })
    });
};

/**
 * Wrapper para manejar errores en funciones async/await
 */
export const catchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};

/**
 * Middleware para validar ObjectId
 */
export const validateObjectId = (paramName = 'id') => {
    return (req, res, next) => {
        const id = req.params[paramName];
        
        if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: `ID inválido: ${id}`
            });
        }
        
        next();
    };
};