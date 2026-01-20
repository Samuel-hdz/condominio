import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_for_development_only';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Genera un token JWT para un usuario
 * @param {Object} user - Objeto del usuario
 * @param {Array} roles - Roles del usuario
 * @returns {String} Token JWT
 */
export const generateToken = (user, roles = []) => {
    const payload = {
        id: user._id,
        email: user.email,
        username: user.username,
        nombre: user.nombre,
        apellido: user.apellido,
        roles: roles,
        iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Verifica y decodifica un token JWT
 * @param {String} token - Token JWT
 * @returns {Object} Payload decodificado
 * @throws {Error} Si el token es inválido
 */
export const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        throw new Error('Token inválido o expirado');
    }
};

/**
 * Extrae el token del header de autorización
 * @param {String} authHeader - Header de autorización
 * @returns {String|null} Token extraído o null
 */
export const extractTokenFromHeader = (authHeader) => {
    if (!authHeader) return null;
    
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
        return parts[1];
    }
    
    return null;
};

/**
 * Genera un token de refresco (para futura implementación)
 * @param {String} userId - ID del usuario
 * @returns {String} Token de refresco
 */
export const generateRefreshToken = (userId) => {
    return jwt.sign(
        { userId, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
};

/**
 * Verifica si un token está a punto de expirar (para futura implementación)
 * @param {String} token - Token JWT
 * @returns {Boolean} True si está por expirar
 */
export const isTokenAboutToExpire = (token) => {
    try {
        const decoded = jwt.decode(token);
        const now = Math.floor(Date.now() / 1000);
        const timeLeft = decoded.exp - now;
        
        // Considerar "por expirar" si le quedan menos de 2 horas
        return timeLeft < 7200;
    } catch (error) {
        return true;
    }
};