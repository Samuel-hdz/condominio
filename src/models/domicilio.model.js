import mongoose from 'mongoose';

const domicilioSchema = new mongoose.Schema({
    calle_torre_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CalleTorre',
        required: true
    },
    numero: {
        type: String,
        required: true,
        trim: true,
        maxlength: 10
    },
    letra: {
        type: String,
        trim: true,
        maxlength: 5
    },
    referencia: {
        type: String,
        maxlength: 200
    },
    estatus: {
        type: String,
        enum: ['activo', 'inactivo', 'suspendido'],
        default: 'inactivo' // ← CAMBIO IMPORTANTE: 'inactivo' por default
    },
    // Agregar campos para tracking
    fecha_activacion: {
        type: Date
    },
    fecha_inactivacion: {
        type: Date
    },
    motivo_estatus: {
        type: String,
        maxlength: 200
    }
}, {
    timestamps: true
});

// Índice único compuesto
domicilioSchema.index({ calle_torre_id: 1, numero: 1, letra: 1 }, { 
    unique: true,
    partialFilterExpression: { letra: { $exists: true } }
});

export const Domicilio = mongoose.model('Domicilio', domicilioSchema);