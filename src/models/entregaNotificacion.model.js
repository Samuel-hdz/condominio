// models/entregaNotificacion.model.js
import mongoose from 'mongoose';

const entregaNotificacionSchema = new mongoose.Schema({
    notificacion_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Notificacion',
        required: true
    },
    dispositivo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DispositivoUsuario',
        required: true
    },
    estado: {
        type: String,
        required: true,
        enum: ['pendiente', 'enviando', 'entregada', 'fallo', 'dispositivo_inactivo'],
        default: 'pendiente'
    },
    fecha_envio: {
        type: Date
    },
    fecha_entrega: {
        type: Date
    },
    intentos: {
        type: Number,
        default: 0
    },
    ultimo_error: {
        tipo: String,
        mensaje: String,
        codigo: String
    },
    metadata_fcm: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

// Índices
entregaNotificacionSchema.index({ notificacion_id: 1 });
entregaNotificacionSchema.index({ dispositivo_id: 1 });
entregaNotificacionSchema.index({ estado: 1, created_at: 1 });

export const EntregaNotificacion = mongoose.model('EntregaNotificacion', entregaNotificacionSchema);