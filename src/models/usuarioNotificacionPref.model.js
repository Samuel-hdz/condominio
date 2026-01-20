import mongoose from 'mongoose';

const usuarioNotificacionPrefSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    tipo_notificacion: {
        type: String,
        required: true,
        enum: ['visitas', 'pagos', 'boletines', 'paqueteria', 'chat', 'accesos']
    },
    recibir_push: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Índice único compuesto
usuarioNotificacionPrefSchema.index({ user_id: 1, tipo_notificacion: 1 }, { unique: true });

export const UsuarioNotificacionPref = mongoose.model('UsuarioNotificacionPref', usuarioNotificacionPrefSchema);