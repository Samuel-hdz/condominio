import mongoose from 'mongoose';

const aplicacionRecargoSchema = new mongoose.Schema({
    recargo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Recargo',
        required: true
    },
    cargo_domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CargoDomicilio',
        required: true
    },
    monto_recargo: {
        type: Number,
        required: true,
        min: 0
    },
    fecha_aplicacion: {
        type: Date,
        default: Date.now
    },
    motivo: {
        type: String,
        maxlength: 200
    },
    usuario_aplicador_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
});

// Índices
aplicacionRecargoSchema.index({ cargo_domicilio_id: 1 });
aplicacionRecargoSchema.index({ recargo_id: 1 });
aplicacionRecargoSchema.index({ fecha_aplicacion: -1 });

export const AplicacionRecargo = mongoose.model('AplicacionRecargo', aplicacionRecargoSchema);