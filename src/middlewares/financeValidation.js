import { body, param, query } from 'express-validator';
import { validateRequest } from './validation.js';
import { Domicilio } from '../models/domicilio.model.js';
import { CalleTorre } from '../models/calleTorre.model.js';
import { TipoCargo } from '../models/tipoCargo.model.js';

export const validateCreateCharge = [
    body('tipo_cargo_id')
        .notEmpty().withMessage('El tipo de cargo es requerido')
        .isMongoId().withMessage('ID de tipo de cargo inválido')
        .custom(async (value) => {
            const tipoCargo = await TipoCargo.findById(value);
            if (!tipoCargo) {
                throw new Error('Tipo de cargo no encontrado');
            }
            return true;
        }),
    
    body('nombre')
        .notEmpty().withMessage('El nombre del cargo es requerido')
        .trim()
        .isLength({ max: 150 }).withMessage('El nombre no puede exceder 150 caracteres'),
    
    body('monto_base')
        .notEmpty().withMessage('El monto base es requerido')
        .isFloat({ min: 0 }).withMessage('El monto debe ser mayor o igual a 0'),
    
    body('fecha_cargo')
        .notEmpty().withMessage('La fecha de cargo es requerida')
        .isISO8601().withMessage('Formato de fecha inválido'),
    
    body('fecha_vencimiento')
        .notEmpty().withMessage('La fecha de vencimiento es requerida')
        .isISO8601().withMessage('Formato de fecha inválido')
        .custom((value, { req }) => {
            const fechaCargo = new Date(req.body.fecha_cargo);
            const fechaVencimiento = new Date(value);
            if (fechaVencimiento <= fechaCargo) {
                throw new Error('La fecha de vencimiento debe ser posterior a la fecha de cargo');
            }
            return true;
        }),
    
    body('aplica_a')
        .isIn(['todos', 'domicilios', 'calles']).withMessage('Tipo de aplicación no válido'),
    
    body('domicilios_ids')
        .if(body('aplica_a').equals('domicilios'))
        .isArray().withMessage('Debe proporcionar un array de IDs de domicilios')
        .custom(async (value) => {
            if (!value || value.length === 0) {
                throw new Error('Debe especificar al menos un domicilio');
            }
            
            const domicilios = await Domicilio.find({ _id: { $in: value } });
            if (domicilios.length !== value.length) {
                throw new Error('Uno o más domicilios no existen');
            }
            return true;
        }),
    
    body('calles_ids')
        .if(body('aplica_a').equals('calles'))
        .isArray().withMessage('Debe proporcionar un array de IDs de calles/torres')
        .custom(async (value) => {
            if (!value || value.length === 0) {
                throw new Error('Debe especificar al menos una calle/torre');
            }
            
            const calles = await CalleTorre.find({ _id: { $in: value } });
            if (calles.length !== value.length) {
                throw new Error('Una o más calles/torres no existen');
            }
            return true;
        }),
    
    validateRequest
];

export const validateCreateSurcharge = [
    body('nombre')
        .notEmpty().withMessage('El nombre del recargo es requerido')
        .trim()
        .isLength({ max: 150 }).withMessage('El nombre no puede exceder 150 caracteres'),
    
    body('tipo_recargo')
        .notEmpty().withMessage('El tipo de recargo es requerido')
        .isIn(['monto_fijo', 'porcentaje_original', 'porcentaje_saldo', 'porcentaje_total_acumulado'])
        .withMessage('Tipo de recargo no válido'),
    
    body('valor')
        .notEmpty().withMessage('El valor del recargo es requerido')
        .isFloat({ min: 0 }).withMessage('El valor debe ser mayor o igual a 0'),
    
    body('considerar_adeudos_mayores_de')
        .optional()
        .isFloat({ min: 0 }).withMessage('Debe ser un número positivo'),
    
    body('aplicar_solo_a')
        .optional()
        .isArray().withMessage('Debe ser un array')
        .custom((value) => {
            const validos = ['mantenimiento', 'extraordinario', 'multa'];
            for (const tipo of value) {
                if (!validos.includes(tipo)) {
                    throw new Error(`Tipo de cargo no válido: ${tipo}`);
                }
            }
            return true;
        }),
    
    body('repetitivo')
        .optional()
        .isBoolean().withMessage('Debe ser verdadero o falso'),
    
    body('frecuencia_dias')
        .if(body('repetitivo').equals(true))
        .notEmpty().withMessage('La frecuencia es requerida para recargos repetitivos')
        .isInt({ min: 1 }).withMessage('La frecuencia debe ser al menos 1 día'),
    
    body('fecha_inicio_vigencia')
        .optional()
        .isISO8601().withMessage('Formato de fecha inválido'),
    
    body('fecha_fin_vigencia')
        .optional()
        .isISO8601().withMessage('Formato de fecha inválido')
        .custom((value, { req }) => {
            if (value && req.body.fecha_inicio_vigencia) {
                const inicio = new Date(req.body.fecha_inicio_vigencia);
                const fin = new Date(value);
                if (fin <= inicio) {
                    throw new Error('La fecha de fin debe ser posterior a la fecha de inicio');
                }
            }
            return true;
        }),
    
    validateRequest
];

// financeValidation.js - Agregar:


// En financeValidation.js
export const validateManualPayment = [
    body('residente_id')
        .notEmpty().withMessage('ID de residente requerido')
        .isMongoId().withMessage('ID inválido'),
    
    body('monto')
        .notEmpty().withMessage('Monto requerido')
        .isFloat({ min: 0.01 }).withMessage('Monto debe ser mayor a 0'),
    
    body('fecha_pago')
        .notEmpty().withMessage('Fecha de pago requerida')
        .isISO8601().withMessage('Formato de fecha inválido')
        .custom(value => {
            const fecha = new Date(value);
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            if (fecha > hoy) {
                throw new Error('La fecha de pago no puede ser futura');
            }
            return true;
        }),
    
    body('metodo_pago')
        .isIn(['transferencia', 'deposito', 'efectivo', 'tarjeta', 'cheque'])
        .withMessage('Método de pago no válido'),
    
    body('asignaciones')
        .optional()
        .isArray().withMessage('Debe ser un array')
        .custom((asignaciones, { req }) => {
            if (asignaciones && asignaciones.length > 0) {
                const montoTotal = parseFloat(req.body.monto);
                const sumaAsignaciones = asignaciones.reduce((sum, a) => sum + parseFloat(a.monto || 0), 0);
                
                if (Math.abs(sumaAsignaciones - montoTotal) > 0.01) {
                    throw new Error('La suma de asignaciones debe coincidir con el monto total');
                }
            }
            return true;
        }),
    
    validateRequest
];