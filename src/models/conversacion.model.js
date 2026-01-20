import mongoose from 'mongoose';

const conversacionSchema = new mongoose.Schema({
    tipo: {
        type: String,
        required: true,
        enum: ['caseta', 'administrador']
    },
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true
    },
    usuario_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    asunto: {
        type: String,
        maxlength: 200
    },
    estatus: {
        type: String,
        enum: ['abierta', 'cerrada', 'archivada'],
        default: 'abierta'
    },
    ultimo_mensaje_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Índice único compuesto
conversacionSchema.index({ residente_id: 1, usuario_id: 1, tipo: 1 }, { unique: true });
conversacionSchema.index({ ultimo_mensaje_at: -1 });

export const Conversacion = mongoose.model('Conversacion', conversacionSchema);