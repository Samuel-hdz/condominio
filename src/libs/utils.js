import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * Utilidades generales para el sistema
 */

class Utils {
    /**
     * Formatea una fecha a formato local mexicano
     * @param {Date} date - Fecha a formatear
     * @param {Boolean} includeTime - Incluir hora
     * @returns {String} Fecha formateada
     */
    static formatDate(date, includeTime = true) {
        if (!date) return 'N/A';
        
        const d = new Date(date);
        const options = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'America/Mexico_City'
        };

        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }

        return d.toLocaleDateString('es-MX', options);
    }

    /**
     * Genera un slug único para URLs
     * @param {String} text - Texto a convertir
     * @returns {String} Slug generado
     */
    static generateSlug(text) {
        return text
            .toString()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Elimina acentos
            .replace(/[^\w\s-]/g, '') // Elimina caracteres especiales
            .replace(/\s+/g, '-') // Reemplaza espacios con guiones
            .replace(/--+/g, '-') // Reemplaza múltiples guiones
            .trim();
    }

    /**
     * Valida si un string es un ObjectId válido de MongoDB
     * @param {String} id - ID a validar
     * @returns {Boolean} True si es válido
     */
    static isValidObjectId(id) {
        return mongoose.Types.ObjectId.isValid(id);
    }

    /**
     * Genera un número de folio único
     * @param {String} prefix - Prefijo del folio
     * @returns {String} Folio generado
     */
    static generateFolio(prefix = 'FOL') {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const random = Math.floor(1000 + Math.random() * 9000);
        
        return `${prefix}-${year}${month}${day}-${random}`;
    }

    /**
     * Calcula días entre dos fechas
     * @param {Date} startDate - Fecha inicial
     * @param {Date} endDate - Fecha final
     * @returns {Number} Días de diferencia
     */
    static daysBetween(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Formatea un número como moneda mexicana
     * @param {Number} amount - Cantidad a formatear
     * @returns {String} Cantidad formateada
     */
    static formatCurrency(amount) {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
            minimumFractionDigits: 2
        }).format(amount || 0);
    }

    /**
     * Sanitiza un string para prevenir inyecciones
     * @param {String} str - String a sanitizar
     * @returns {String} String sanitizado
     */
    static sanitizeString(str) {
        if (typeof str !== 'string') return str;
        
        return str
            .replace(/[<>]/g, '') // Elimina < y >
            .replace(/javascript:/gi, '') // Elimina javascript:
            .replace(/on\w+=/gi, ''); // Elimina eventos como onclick=
    }

    /**
     * Genera un nombre de archivo único
     * @param {String} originalName - Nombre original del archivo
     * @param {String} prefix - Prefijo opcional
     * @returns {String} Nombre único generado
     */
    static generateUniqueFilename(originalName, prefix = '') {
        const extension = originalName.split('.').pop();
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        
        const safeName = originalName
            .replace(`.${extension}`, '')
            .replace(/[^a-z0-9]/gi, '-')
            .toLowerCase();
            
        return `${prefix}${safeName}-${timestamp}-${random}.${extension}`;
    }

    /**
     * Parsea un string de búsqueda para MongoDB
     * @param {String} searchString - String de búsqueda
     * @returns {Object} Filtro de MongoDB
     */
    static parseSearchString(searchString) {
        if (!searchString || searchString.trim() === '') return {};
        
        const search = searchString.trim();
        
        // Si es un ObjectId válido
        if (this.isValidObjectId(search)) {
            return { _id: new mongoose.Types.ObjectId(search) };
        }
        
        // Si es un número
        if (!isNaN(search)) {
            return { 
                $or: [
                    { numero: search },
                    { telefono: { $regex: search, $options: 'i' } }
                ]
            };
        }
        
        // Si es texto, buscar en múltiples campos
        return {
            $or: [
                { nombre: { $regex: search, $options: 'i' } },
                { apellido: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } }
            ]
        };
    }

    /**
     * Crea un filtro de paginación para MongoDB
     * @param {Number} page - Página actual
     * @param {Number} limit - Límite por página
     * @returns {Object} Objeto con skip y limit
     */
    static getPaginationOptions(page = 1, limit = 20) {
        const safePage = Math.max(1, parseInt(page) || 1);
        const safeLimit = Math.max(1, Math.min(100, parseInt(limit) || 20));
        
        return {
            skip: (safePage - 1) * safeLimit,
            limit: safeLimit,
            page: safePage
        };
    }

    /**
     * Calcula metadatos de paginación
     * @param {Number} total - Total de documentos
     * @param {Number} page - Página actual
     * @param {Number} limit - Límite por página
     * @returns {Object} Metadatos de paginación
     */
    static getPaginationMetadata(total, page, limit) {
        const totalPages = Math.ceil(total / limit);
        
        return {
            total,
            page,
            limit,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            nextPage: page < totalPages ? page + 1 : null,
            prevPage: page > 1 ? page - 1 : null
        };
    }

    /**
     * Enmascara información sensible
     * @param {String} text - Texto a enmascarar
     * @param {String} type - Tipo de dato (email, phone, etc.)
     * @returns {String} Texto enmascarado
     */
    static maskSensitiveInfo(text, type = 'email') {
        if (!text) return '';
        
        switch (type) {
            case 'email':
                const [local, domain] = text.split('@');
                if (local.length <= 2) return text;
                return `${local.substring(0, 2)}***@${domain}`;
                
            case 'phone':
                if (text.length <= 4) return text;
                return `******${text.substring(text.length - 4)}`;
                
            case 'creditCard':
                if (text.length <= 4) return text;
                return `**** **** **** ${text.substring(text.length - 4)}`;
                
            default:
                return text;
        }
    }

    /**
     * Valida y formatea un número de teléfono mexicano
     * @param {String} phone - Número de teléfono
     * @returns {String|null} Teléfono formateado o null si es inválido
     */
    static formatMexicanPhone(phone) {
        if (!phone) return null;
        
        // Eliminar espacios y caracteres no numéricos
        const cleaned = phone.replace(/\D/g, '');
        
        // Validar longitud (10 dígitos para celular, 7-8 para fijo)
        if (cleaned.length === 10) {
            // Celular: 55 1234 5678 -> +52 55 1234 5678
            return `+52 ${cleaned.substring(0, 2)} ${cleaned.substring(2, 6)} ${cleaned.substring(6)}`;
        } else if (cleaned.length >= 7 && cleaned.length <= 8) {
            // Teléfono fijo
            return `+52 ${cleaned}`;
        }
        
        return null;
    }

    /**
     * Convierte un objeto a query string para URLs
     * @param {Object} params - Parámetros a convertir
     * @returns {String} Query string
     */
    static objectToQueryString(params) {
        const query = new URLSearchParams();
        
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                if (Array.isArray(value)) {
                    value.forEach(v => query.append(`${key}[]`, v));
                } else {
                    query.append(key, value);
                }
            }
        });
        
        return query.toString();
    }
}

export default Utils;