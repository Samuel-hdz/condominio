import mongoose from 'mongoose';

/**
 * Validadores personalizados para el sistema
 */

class Validators {
    /**
     * Valida si un email es válido
     * @param {String} email - Email a validar
     * @returns {Boolean} True si es válido
     */
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Valida si un número de teléfono mexicano es válido
     * @param {String} phone - Teléfono a validar
     * @returns {Boolean} True si es válido
     */
    static isValidMexicanPhone(phone) {
        if (!phone) return false;
        
        // Eliminar espacios y caracteres no numéricos
        const cleaned = phone.replace(/\D/g, '');
        
        // Celular: 10 dígitos, fijo: 7-8 dígitos
        return cleaned.length >= 7 && cleaned.length <= 10;
    }

    /**
     * Valida si una fecha es válida y no es futura (para fechas de nacimiento)
     * @param {Date} date - Fecha a validar
     * @returns {Boolean} True si es válida
     */
    static isValidBirthDate(date) {
        if (!date) return false;
        
        const birthDate = new Date(date);
        const today = new Date();
        
        // No puede ser futura y debe ser mayor de 18 años
        const minAgeDate = new Date();
        minAgeDate.setFullYear(today.getFullYear() - 18);
        
        return birthDate <= today && birthDate <= minAgeDate;
    }

    /**
     * Valida si un CURP es válido
     * @param {String} curp - CURP a validar
     * @returns {Boolean} True si es válido
     */
    static isValidCURP(curp) {
        if (!curp || curp.length !== 18) return false;
        
        const curpRegex = /^[A-Z]{4}\d{6}[HM]{1}[A-Z]{5}[A-Z0-9]{2}$/;
        return curpRegex.test(curp.toUpperCase());
    }

    /**
     * Valida si un RFC es válido
     * @param {String} rfc - RFC a validar
     * @returns {Boolean} True si es válido
     */
    static isValidRFC(rfc) {
        if (!rfc) return false;
        
        const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
        return rfcRegex.test(rfc.toUpperCase());
    }

    /**
     * Valida si una contraseña es segura
     * @param {String} password - Contraseña a validar
     * @returns {Object} Resultado de validación
     */
    static validatePasswordStrength(password) {
        const validations = {
            minLength: password.length >= 8,
            hasUpperCase: /[A-Z]/.test(password),
            hasLowerCase: /[a-z]/.test(password),
            hasNumbers: /\d/.test(password),
            hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
            noSpaces: !/\s/.test(password)
        };

        const isValid = Object.values(validations).every(v => v);
        const strength = Object.values(validations).filter(v => v).length;

        return {
            isValid,
            strength,
            validations,
            score: Math.round((strength / Object.keys(validations).length) * 100)
        };
    }

    /**
     * Valida si un código QR es válido (estructura básica)
     * @param {String} qrCode - Código QR a validar
     * @returns {Boolean} True si es válido
     */
    static isValidQRCode(qrCode) {
        if (!qrCode || qrCode.length < 10) return false;
        
        try {
            const parsed = JSON.parse(qrCode);
            return !!(parsed.authId && parsed.residentId && parsed.timestamp);
        } catch {
            // No es JSON, podría ser otro formato
            return qrCode.length >= 10 && qrCode.length <= 500;
        }
    }

    /**
     * Valida si un monto monetario es válido
     * @param {Number|String} amount - Monto a validar
     * @returns {Boolean} True si es válido
     */
    static isValidAmount(amount) {
        if (amount === null || amount === undefined) return false;
        
        const num = parseFloat(amount);
        return !isNaN(num) && num >= 0 && num <= 1000000000; // Hasta mil millones
    }

    /**
     * Valida si una fecha de vencimiento es válida
     * @param {Date} dueDate - Fecha de vencimiento
     * @param {Date} issueDate - Fecha de emisión (opcional)
     * @returns {Boolean} True si es válida
     */
    static isValidDueDate(dueDate, issueDate = new Date()) {
        if (!dueDate) return false;
        
        const due = new Date(dueDate);
        const issue = new Date(issueDate);
        const today = new Date();
        
        // No puede ser anterior a la fecha de emisión
        // Ni anterior a hoy (para nuevos cargos)
        return due >= issue && due >= today;
    }

    /**
     * Valida si un archivo es de un tipo permitido
     * @param {String} filename - Nombre del archivo
     * @param {Array} allowedTypes - Tipos MIME permitidos
     * @returns {Boolean} True si es válido
     */
    static isValidFileType(filename, allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']) {
        if (!filename) return false;
        
        const extension = filename.toLowerCase().split('.').pop();
        const extensionMap = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        
        const mimeType = extensionMap[extension];
        return allowedTypes.includes(mimeType);
    }

    /**
     * Valida si un archivo está dentro del tamaño permitido
     * @param {Number} fileSize - Tamaño del archivo en bytes
     * @param {Number} maxSizeMB - Tamaño máximo en MB
     * @returns {Boolean} True si es válido
     */
    static isValidFileSize(fileSize, maxSizeMB = 10) {
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        return fileSize <= maxSizeBytes;
    }

    /**
     * Valida si un string contiene solo caracteres alfabéticos y espacios
     * @param {String} str - String a validar
     * @returns {Boolean} True si es válido
     */
    static isAlphaWithSpaces(str) {
        return /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/.test(str);
    }

    /**
     * Valida si un string es una dirección válida
     * @param {String} address - Dirección a validar
     * @returns {Boolean} True si es válida
     */
    static isValidAddress(address) {
        if (!address || address.length < 5) return false;
        
        // Debe contener al menos un número y algunas letras
        const hasNumbers = /\d/.test(address);
        const hasLetters = /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(address);
        
        return hasNumbers && hasLetters && address.length >= 10;
    }
}

export default Validators;