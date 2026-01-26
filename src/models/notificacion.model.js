import mongoose from 'mongoose';

const notificacionSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    tipo: {
        type: String,
        required: true,
        enum: ['push', 'in_app'] // Solo estos tipos, sin email ni sms
    },
    titulo: {
        type: String,
        required: true,
        maxlength: 200
    },
    mensaje: {
        type: String,
        required: true
    },
    data_json: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    leida: {
        type: Boolean,
        default: false
    },
    fecha_leida: {
        type: Date
    },
    enviada: {
        type: Boolean,
        default: false
    },
    fecha_envio: {
        type: Date
    },
    error_envio: {
        type: String,
        maxlength: 255
    },
    accion_requerida: {
        type: Boolean,
        default: false
    },
    accion_tipo: {
        type: String,
        enum: [
            'ver_comprobante',      // ← Ya existe
            'descargar_comprobante', // ← AGREGAR ESTE
            'ver_estado_cuenta',    // ← Ya existe
            'responder_mensaje',    // ← Ya existe
            'ver_cargo',           // ← Agregar si no existe
            'pagar_cargo',         // ← Agregar si no existe
            'ver_visita',          // ← Agregar si no existe
            'ver_evento',          // ← Agregar si no existe
            'ver_paquete',         // ← Agregar si no existe
            'ver_bitacora',        // ← Agregar si no existe
            null                   // ← Para notificaciones sin acción
        ]
    },
    accion_data: {
        type: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: true
});

// Índices para consultas frecuentes
notificacionSchema.index({ user_id: 1, leida: 1 });
notificacionSchema.index({ user_id: 1, enviada: 1 });
notificacionSchema.index({ created_at: -1 });
notificacionSchema.index({ tipo: 1 });

export const Notificacion = mongoose.model('Notificacion', notificacionSchema);