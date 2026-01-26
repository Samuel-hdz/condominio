import QRCode from 'qrcode';
import crypto from 'crypto';

/**
 * Servicio para generación y validación de códigos QR
 */

class QRService {
    /**
     * Genera un código QR único para una autorización
     */
    static async generateQRForAuthorization(authorizationId, residentId, metadata = {}) {
        // Crear payload seguro
        const payload = {
            authId: authorizationId.toString(),
            residentId: residentId.toString(),
            timestamp: Date.now(),
            ...metadata
        };

        // Convertir a JSON y crear hash de seguridad
        const payloadString = JSON.stringify(payload);
        const hash = crypto
            .createHash('sha256')
            .update(payloadString + (process.env.QR_SECRET_KEY || 'qr_secret_key_default_123'))
            .digest('hex')
            .substring(0, 16);

        const securePayload = {
            ...payload,
            hash
        };

        const finalPayloadString = JSON.stringify(securePayload);
        
        // Generar código QR como data URL
        const qrDataURL = await QRCode.toDataURL(finalPayloadString, {
            errorCorrectionLevel: 'H',
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
            expirationDate: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000))
        };
    }

    /**
     * Genera un código QR para un evento (compartido)
     */
    static async generateQRForEvent(eventId, maxInvitados = 0) {
        const payload = {
            eventId: eventId.toString(),
            type: 'event_shared_qr',
            maxGuests: maxInvitados,
            timestamp: Date.now()
        };
        
        const jsonString = JSON.stringify(payload);
        
        const qrDataURL = await QRCode.toDataURL(jsonString, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 300,
            color: {
                dark: '#000000', // Azul para eventos
                light: '#FFFFFF'
            }
        });
        
        return {
            qrDataURL,
            payload: jsonString // Para debugging
        };
    }

    /**
     * Validar QR de evento compartido
     */
    static validateEventQRPayload(payload) {
        if (!payload.eventId || !payload.type) {
            return { valid: false, reason: 'Payload de evento incompleto' };
        }

        if (payload.type !== 'event_shared_qr') {
            return { valid: false, reason: 'Tipo de QR inválido para evento' };
        }

        // Verificar timestamp (no muy viejo)
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 días máximo
        if (payload.timestamp && (Date.now() - payload.timestamp > maxAge)) {
            return { valid: false, reason: 'QR de evento expirado' };
        }

        return {
            valid: true,
            eventId: payload.eventId,
            maxGuests: payload.maxGuests || 0,
            type: payload.type
        };
    }

    /**
     * Genera un código de texto legible
     */
    static generateTextCode(id) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';

        const safeId = String(id);
        const timestamp = Date.now()
            .toString(36)
            .toUpperCase()
            .substring(0, 4);

        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        return `${timestamp}-${code}-${safeId.substring(safeId.length - 4).toUpperCase()}`;
    }

    /**
     * Valida un payload QR escaneado
     */
    static validateQRPayload(payload) {
        try {
            // Verificar estructura básica
            if (!payload.authId && !payload.eventId) {
                return { valid: false, reason: 'Payload inválido: falta ID' };
            }

            // Verificar hash de seguridad (solo para autorizaciones normales)
            if (payload.authId && payload.hash) {
                const { hash, ...payloadWithoutHash } = payload;
                const payloadString = JSON.stringify(payloadWithoutHash);
                const expectedHash = crypto
                    .createHash('sha256')
                    .update(payloadString + (process.env.QR_SECRET_KEY || 'qr_secret_key_default_123'))
                    .digest('hex')
                    .substring(0, 16);

                if (hash !== expectedHash) {
                    return { valid: false, reason: 'Hash de seguridad inválido' };
                }
            }

            // Verificar expiración (30 días)
            const qrAge = Date.now() - payload.timestamp;
            const maxAge = 30 * 24 * 60 * 60 * 1000;
            
            if (qrAge > maxAge) {
                return { valid: false, reason: 'QR expirado', expired: true };
            }

            // Devolver datos según tipo
            if (payload.authId) {
                return {
                    valid: true,
                    authorizationId: payload.authId,
                    residentId: payload.residentId,
                    type: 'authorization',
                    metadata: payload
                };
            } else if (payload.eventId) {
                return {
                    valid: true,
                    eventId: payload.eventId,
                    type: 'event_shared',
                    metadata: payload
                };
            }

            return { valid: false, reason: 'Tipo de QR no reconocido' };
            
        } catch (error) {
            console.error('Error validando QR:', error);
            return { valid: false, reason: 'Error procesando payload' };
        }
    }

    /**
     * Decodifica un QR desde data URL (placeholder para jsQR)
     */
    static async decodeQRDataURL(qrDataURL) {
        // En producción, usar librería como jsQR
        // Por ahora retornamos un mock
        console.log('⚠️ QR decoding requires jsQR library');
        
        // Mock para desarrollo
        if (qrDataURL.includes('mock')) {
            return {
                authId: 'mock_auth_id',
                residentId: 'mock_resident_id',
                timestamp: Date.now(),
                hash: 'mockhash123'
            };
        }
        
        throw new Error('QR decoding not implemented. Install jsQR library.');
    }

    /**
     * Genera un código de acceso único
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