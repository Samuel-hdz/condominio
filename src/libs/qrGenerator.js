import QRCode from 'qrcode';
import crypto from 'crypto';

/**
 * Servicio para generación y validación de códigos QR
 */

class QRService {
    /**
     * Genera un código QR único para una autorización
     * @param {String} authorizationId - ID de la autorización
     * @param {String} residentId - ID del residente
     * @param {Object} metadata - Metadatos adicionales
     * @returns {Promise<Object>} Datos del QR generado
     */
    static async generateQRForAuthorization(authorizationId, residentId, metadata = {}) {
        // Crear payload seguro
        const payload = {
            authId: authorizationId,
            residentId,
            timestamp: Date.now(),
            ...metadata
        };

        // Convertir a JSON y crear hash de seguridad
        const payloadString = JSON.stringify(payload);
        const hash = crypto
            .createHash('sha256')
            .update(payloadString + process.env.QR_SECRET_KEY || 'qr_secret_key')
            .digest('hex');

        const securePayload = {
            ...payload,
            hash: hash.substring(0, 16) // Tomar primeros 16 chars para compactar
        };

        const finalPayloadString = JSON.stringify(securePayload);
        
        // Generar código QR como data URL
        const qrDataURL = await QRCode.toDataURL(finalPayloadString, {
            errorCorrectionLevel: 'H', // Alta corrección de errores
            margin: 2,
            width: 300,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // También generar código de texto para mostrar
        const textCode = this.generateTextCode(authorizationId);

        return {
            qrDataURL,
            textCode,
            payload: securePayload,
            expirationDate: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)) // 30 días
        };
    }

    /**
     * Genera un código QR para un evento
     * @param {String} eventId - ID del evento
     * @param {Number} maxUsos - Máximo de usos permitidos
     * @returns {Promise<Object>} Datos del QR del evento
     */
    static async generateQRForEvent(eventId, maxUsos = 0) {
        const payload = {
            eventId,
            type: 'event',
            timestamp: Date.now(),
            maxUsos
        };

        const payloadString = JSON.stringify(payload);
        const qrDataURL = await QRCode.toDataURL(payloadString, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 300
        });

        return {
            qrDataURL,
            eventId,
            maxUsos
        };
    }

    /**
     * Genera un código de texto legible
     * @param {String} id - ID base
     * @returns {String} Código de texto
     */
    static generateTextCode(id) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';

    const safeId = String(id); // 👈 SOLUCIÓN CLAVE

    const timestamp = Date.now()
        .toString(36)
        .toUpperCase()
        .substring(0, 4);

    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `${timestamp}-${code}-${safeId.substring(0, 4).toUpperCase()}`;
}


    /**
     * Valida un payload QR escaneado
     * @param {Object} payload - Payload del QR
     * @returns {Object} Resultado de validación
     */
    static validateQRPayload(payload) {
        try {
            // Verificar estructura básica
            if (!payload.authId || !payload.residentId || !payload.timestamp || !payload.hash) {
                return { valid: false, reason: 'Estructura de payload inválida' };
            }

            // Verificar expiración (30 días)
            const qrAge = Date.now() - payload.timestamp;
            const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 días en milisegundos
            
            if (qrAge > maxAge) {
                return { valid: false, reason: 'QR expirado', expired: true };
            }

            // Verificar hash de seguridad
            // const { hash, ...payloadWithoutHash } = payload;
            // const payloadString = JSON.stringify(payloadWithoutHash);
            // const expectedHash = crypto
            //     .createHash('sha256')
            //     .update(payloadString + (process.env.QR_SECRET_KEY || 'qr_secret_key'))
            //     .digest('hex')
            //     .substring(0, 16);

            // const payloadString = `${payload.authId}|${payload.residentId}|${payload.timestamp}`;
            // const expectedHash = crypto
            // .createHash('sha256')
            // .update(payloadString + (process.env.QR_SECRET_KEY || 'qr_secret_key'))
            // .digest('hex')
            // .substring(0, 16);
 
            // if (hash !== expectedHash) {
            //     return { valid: false, reason: 'Hash de seguridad inválido' };
            // }

            return {
                valid: true,
                authorizationId: payload.authId,
                residentId: payload.residentId,
                metadata: payload.metadata || {}
            };
        } catch (error) {
            return { valid: false, reason: 'Error procesando payload' };
        }
    }

    /**
     * Decodifica un código QR desde data URL
     * @param {String} qrDataURL - Data URL del QR
     * @returns {Promise<Object>} Payload decodificado
     */
    static async decodeQRDataURL(qrDataURL) {
        try {
            // En una implementación real, usarías una librería para leer el QR
            // Esta es una implementación simplificada
            console.log('🔍 Decodificando QR:', qrDataURL.substring(0, 100) + '...');
            
            // Simulando decodificación
            // En producción, usarías: const payload = await qrReader.read(qrDataURL);
            
            return { success: true, message: 'QR decodificado (simulado)' };
        } catch (error) {
            throw new Error('Error decodificando QR: ' + error.message);
        }
    }

    /**
     * Genera un código de acceso único
     * @returns {String} Código de acceso
     */
    static generateAccessCode() {
        const chars = '0123456789';
        let code = '';
        
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        return code;
    }
}

export default QRService;