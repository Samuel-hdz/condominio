// models/dispositivoUsuario.model.js
import mongoose from 'mongoose';

const dispositivoUsuarioSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    dispositivo_id: {
        type: String,
        required: true
    },
    plataforma: {
        type: String,
        required: true,
        enum: ['android', 'ios', 'web']
    },
    token_fcm: {
        type: String,
        required: true
    },
    activo: {
        type: Boolean,
        default: true
    },
    ultima_actividad: {
        type: Date,
        default: Date.now
    },
    version_app: {
        type: String
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    token_fcm: {
        type: String,
        required: true,
        index: true,
        expires: 60 * 24 * 60 * 60 // 60 días de expiración
    },
}, {
    timestamps: true
});

// Índices para consultas frecuentes
dispositivoUsuarioSchema.index({ user_id: 1, activo: 1 });
dispositivoUsuarioSchema.index({ token_fcm: 1 }, { unique: true });

export const DispositivoUsuario = mongoose.model('DispositivoUsuario', dispositivoUsuarioSchema);