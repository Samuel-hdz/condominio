import Validators from '../libs/validators.js';
import Utils from '../libs/utils.js';
import mongoose from 'mongoose';
import { validationResult } from 'express-validator';

/**
 * Middleware para validar datos de entrada
 */

/**
 * Valida datos de creación de usuario
 */
export const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors: errors.array().map(err => ({
                field: err.path,
                message: err.msg,
                value: err.value
            }))
        });
    }
    next();
};

export const validateCreateUser = (req, res, next) => {
    const { email, password, nombre, apellido, telefono } = req.body;
    const errors = [];

    // Validar email
    if (!email || !Validators.isValidEmail(email)) {
        errors.push('Email inválido');
    }

    // Validar contraseña
    if (password) {
        const passwordValidation = Validators.validatePasswordStrength(password);
        if (!passwordValidation.isValid) {
            errors.push('La contraseña no cumple con los requisitos de seguridad');
        }
    }

    // Validar nombre y apellido
    if (!nombre || !Validators.isAlphaWithSpaces(nombre)) {
        errors.push('Nombre inválido. Solo se permiten letras y espacios.');
    }

    if (!apellido || !Validators.isAlphaWithSpaces(apellido)) {
        errors.push('Apellido inválido. Solo se permiten letras y espacios.');
    }

    // Validar teléfono (opcional)
    if (telefono && !Validators.isValidMexicanPhone(telefono)) {
        errors.push('Teléfono mexicano inválido');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    // Sanitizar datos
    req.body.email = email.toLowerCase().trim();
    req.body.nombre = Utils.sanitizeString(nombre.trim());
    req.body.apellido = Utils.sanitizeString(apellido.trim());
    
    if (telefono) {
        req.body.telefono = Utils.formatMexicanPhone(telefono);
    }

    next();
};

export const validateCreatePersonal = (req, res, next) => {
    const {
        nombre,
        tipo_servicio,
        frecuencia,
        fecha_inicio,
        fecha_fin
    } = req.body;

    const errors = [];

    if (!nombre || nombre.trim().length < 2) {
        errors.push('Nombre del personal requerido (mínimo 2 caracteres)');
    }

    if (!tipo_servicio || tipo_servicio.trim().length < 2) {
        errors.push('Tipo de servicio requerido');
    }

    // Validar frecuencia
    if (frecuencia) {
        const tiposFrecuencia = ['diario', 'semanal', 'quincenal', 'mensual', 'fecha_especifica'];
        if (!tiposFrecuencia.includes(frecuencia.tipo)) {
            errors.push(`Tipo de frecuencia inválido. Permitidos: ${tiposFrecuencia.join(', ')}`);
        }

        if (frecuencia.tipo === 'semanal' && frecuencia.dias_semana) {
            for (const dia of frecuencia.dias_semana) {
                if (dia < 0 || dia > 6) {
                    errors.push('Días de la semana deben estar entre 0 (Domingo) y 6 (Sábado)');
                    break;
                }
            }
        }
    }

    if (!fecha_inicio) {
        errors.push('Fecha de inicio requerida');
    }

    if (!fecha_fin) {
        errors.push('Fecha de fin requerida');
    }

    if (fecha_inicio && fecha_fin && new Date(fecha_inicio) >= new Date(fecha_fin)) {
        errors.push('La fecha de fin debe ser posterior a la fecha de inicio');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    next();
};

/**
 * Valida datos de creación de evento
 */
export const validateCreateEvent = (req, res, next) => {
    const {
        nombre_evento,
        fecha_inicio,
        fecha_fin,
        max_invitados
    } = req.body;

    const errors = [];

    if (!nombre_evento || nombre_evento.trim().length < 3) {
        errors.push('Nombre del evento requerido (mínimo 3 caracteres)');
    }

    if (!fecha_inicio) {
        errors.push('Fecha de inicio requerida');
    }

    if (!fecha_fin) {
        errors.push('Fecha de fin requerida');
    }

    if (fecha_inicio && fecha_fin && new Date(fecha_inicio) >= new Date(fecha_fin)) {
        errors.push('La fecha de fin debe ser posterior a la fecha de inicio');
    }

    if (max_invitados !== undefined && (isNaN(max_invitados) || max_invitados < 0)) {
        errors.push('Máximo de invitados debe ser un número mayor o igual a 0');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    next();
};

/**
 * Valida datos de creación de residente
 */
// export const validateCreateResident = (req, res, next) => {
//     const { calle_torre_id, numero, letra } = req.body;
//     const errors = [];

//     // Validar calle/torre
//     if (!calle_torre_id || !Utils.isValidObjectId(calle_torre_id)) {
//         errors.push('ID de calle/torre inválido');
//     }

//     // Validar número
//     if (!numero || numero.trim() === '') {
//         errors.push('Número de domicilio requerido');
//     }

//     if (letra && letra.length > 5) {
//         errors.push('La letra no puede exceder 5 caracteres');
//     }

//     if (errors.length > 0) {
//         return res.status(400).json({
//             success: false,
//             message: 'Errores de validación',
//             errors
//         });
//     }

//     next();
// };

export const validateCreateResident = (req, res, next) => {
    const { user_id, domicilio_id, es_principal } = req.body;
    const errors = [];

    if (!user_id || !Utils.isValidObjectId(user_id)) {
        errors.push('ID de usuario inválido');
    }

    if (!domicilio_id || !Utils.isValidObjectId(domicilio_id)) {
        errors.push('ID de domicilio inválido');
    }

    if (typeof es_principal !== 'undefined' && typeof es_principal !== 'boolean') {
        errors.push('es_principal debe ser booleano');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    next();
};

function getTodayLocal() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Valida datos de autorización de visita
 */
export const validateVisitAuthorization = (req, res, next) => {
    const {
        tipo_visita_id,
        nombre_visitante,
        fecha_inicio_vigencia,
        fecha_fin_vigencia,
        limite_ingresos
    } = req.body;

    const errors = [];

    // Validar tipo de visita
    if (!tipo_visita_id || !Utils.isValidObjectId(tipo_visita_id)) {
        errors.push('Tipo de visita inválido');
    }

    // Validar nombre
    if (!nombre_visitante || nombre_visitante.trim().length < 2) {
        errors.push('Nombre del visitante es requerido (mínimo 2 caracteres)');
    }

    // Validar formato de fechas
    if (!fecha_inicio_vigencia) {
        errors.push('Fecha de inicio de vigencia requerida');
    }

    if (!fecha_fin_vigencia) {
        errors.push('Fecha de fin de vigencia requerida');
    }

    // Comparaciones seguras (YYYY-MM-DD)
    if (fecha_inicio_vigencia && fecha_fin_vigencia) {
        const today = getTodayLocal();

        if (fecha_inicio_vigencia < today) {
            errors.push('La fecha de inicio no puede ser en el pasado');
        }

        if (fecha_inicio_vigencia >= fecha_fin_vigencia) {
            errors.push('La fecha de inicio debe ser anterior a la fecha de fin');
        }
    }

    if (limite_ingresos !== undefined) {
    const limite = Number(limite_ingresos);

    if (
        Number.isNaN(limite) ||
        limite < 1 ||
        limite > 1000
    ) {
        errors.push('El límite de ingresos debe estar entre 1 y 1000');
    }
}


    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    req.body.nombre_visitante = Utils.sanitizeString(nombre_visitante.trim());

    next();
};



/**
 * Valida datos de comprobante de pago
 */
export const validatePaymentReceipt = (req, res, next) => {
    const {
        tipo_cargo,
        monto_total,
        fecha_pago,
        metodo_pago,
        institucion_bancaria
    } = req.body;

    console.log(
        tipo_cargo
    )

    const errors = [];

    // Validar tipo de cargo
    // Validar monto
    if (!Validators.isValidAmount(monto_total)) {
        errors.push('Monto total inválido');
    }

    // Validar fecha de pago
    const fechaPago = new Date(fecha_pago);
    if (isNaN(fechaPago.getTime()) || fechaPago > new Date()) {
        errors.push('Fecha de pago inválida. No puede ser futura.');
    }

    // Validar método de pago
    const metodosPermitidos = ['transferencia', 'deposito', 'efectivo', 'tarjeta', 'cheque'];
    if (!metodo_pago || !metodosPermitidos.includes(metodo_pago)) {
        errors.push(`Método de pago inválido. Permitidos: ${metodosPermitidos.join(', ')}`);
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    next();
};

/**
 * Valida datos de publicación/boletín
 */
export const validatePublication = (req, res, next) => {
    const { titulo, contenido, tipo, prioridad } = req.body;
    const errors = [];

    // Validar título
    if (!titulo || titulo.trim().length < 5) {
        errors.push('Título es requerido (mínimo 5 caracteres)');
    }

    if (titulo && titulo.trim().length > 200) {
        errors.push('Título no puede exceder 200 caracteres');
    }

    // Validar contenido
    if (!contenido || contenido.trim().length < 10) {
        errors.push('Contenido es requerido (mínimo 10 caracteres)');
    }

    // Validar tipo
    const tiposPermitidos = ['boletin', 'anuncio', 'emergencia', 'evento_comunidad'];
    if (tipo && !tiposPermitidos.includes(tipo)) {
        errors.push(`Tipo inválido. Permitidos: ${tiposPermitidos.join(', ')}`);
    }

    // Validar prioridad
    const prioridadesPermitidas = ['baja', 'normal', 'alta', 'urgente'];
    if (prioridad && !prioridadesPermitidas.includes(prioridad)) {
        errors.push(`Prioridad inválida. Permitidos: ${prioridadesPermitidas.join(', ')}`);
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    // Sanitizar datos
    req.body.titulo = Utils.sanitizeString(titulo.trim());
    req.body.contenido = Utils.sanitizeString(contenido.trim());

    next();
};

/**
 * Valida archivos subidos
 */
export const validateFileUpload = (fieldName = 'file', maxSizeMB = 10) => {
    return (req, res, next) => {
        if (!req.file) {
            return next(); // El archivo es opcional en algunos casos
        }

        const file = req.file;
        const errors = [];

        // Validar tipo de archivo
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
        if (!Validators.isValidFileType(file.originalname, allowedTypes)) {
            errors.push(`Tipo de archivo no permitido. Solo se aceptan: ${allowedTypes.join(', ')}`);
        }

        // Validar tamaño
        if (!Validators.isValidFileSize(file.size, maxSizeMB)) {
            errors.push(`El archivo excede el tamaño máximo de ${maxSizeMB}MB`);
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Error en el archivo',
                errors
            });
        }

        next();
    };
};

// Validación para creación de cargos
export const validateCreateCharge = (req, res, next) => {
    const {
        tipo_cargo_id,
        nombre,
        monto_base,
        fecha_cargo,
        fecha_vencimiento,
        aplica_a
    } = req.body;

    const errors = [];

    if (!tipo_cargo_id || !mongoose.Types.ObjectId.isValid(tipo_cargo_id)) {
        errors.push('tipo_cargo_id es requerido y debe ser un ObjectId válido');
    }

    if (!nombre || nombre.trim().length < 3 || nombre.trim().length > 150) {
        errors.push('nombre es requerido (3-150 caracteres)');
    }

    if (!monto_base || isNaN(monto_base) || parseFloat(monto_base) <= 0) {
        errors.push('monto_base es requerido y debe ser un número mayor a 0');
    }

    if (!fecha_cargo || isNaN(Date.parse(fecha_cargo))) {
        errors.push('fecha_cargo es requerida y debe ser una fecha válida');
    }

    if (!fecha_vencimiento || isNaN(Date.parse(fecha_vencimiento))) {
        errors.push('fecha_vencimiento es requerida y debe ser una fecha válida');
    }

    if (fecha_cargo && fecha_vencimiento) {
        const fechaCargo = new Date(fecha_cargo);
        const fechaVencimiento = new Date(fecha_vencimiento);
        
        if (fechaVencimiento <= fechaCargo) {
            errors.push('fecha_vencimiento debe ser posterior a fecha_cargo');
        }
    }

    const aplicaValidos = ['todos', 'domicilios', 'calles'];
    if (!aplica_a || !aplicaValidos.includes(aplica_a)) {
        errors.push(`aplica_a es requerido y debe ser uno de: ${aplicaValidos.join(', ')}`);
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    next();
};

// Validación para creación de recargos
export const validateCreateSurcharge = (req, res, next) => {
    const {
        nombre,
        tipo_recargo,
        valor,
        considerar_adeudos_mayores_de,
        aplicar_solo_a,
        repetitivo,
        frecuencia_dias
    } = req.body;

    const errors = [];

    if (!nombre || nombre.trim().length < 3 || nombre.trim().length > 100) {
        errors.push('nombre es requerido (3-100 caracteres)');
    }

    const tiposValidos = ['monto_fijo', 'porcentaje_adeudo', 'porcentaje_saldo', 'porcentaje_mas_recargos'];
    if (!tipo_recargo || !tiposValidos.includes(tipo_recargo)) {
        errors.push(`tipo_recargo es requerido y debe ser uno de: ${tiposValidos.join(', ')}`);
    }

    if (!valor || isNaN(valor) || parseFloat(valor) <= 0) {
        errors.push('valor es requerido y debe ser un número mayor a 0');
    }

    if (considerar_adeudos_mayores_de && (isNaN(considerar_adeudos_mayores_de) || parseFloat(considerar_adeudos_mayores_de) < 0)) {
        errors.push('considerar_adeudos_mayores_de debe ser un número mayor o igual a 0');
    }

    if (aplicar_solo_a && Array.isArray(aplicar_solo_a)) {
        const tiposCargoValidos = ['mantenimiento', 'extraordinario', 'multa'];
        for (const tipo of aplicar_solo_a) {
            if (!tiposCargoValidos.includes(tipo)) {
                errors.push(`tipo de cargo inválido: ${tipo}. Debe ser: ${tiposCargoValidos.join(', ')}`);
            }
        }
    }

    if (repetitivo === true && (!frecuencia_dias || isNaN(frecuencia_dias) || parseInt(frecuencia_dias) < 1)) {
        errors.push('frecuencia_dias es requerida para recargos repetitivos y debe ser mayor a 0');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors
        });
    }

    next();
};