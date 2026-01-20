import mongoose from 'mongoose';

const saldoDomicilioSchema = new mongoose.Schema({
    domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Domicilio',
        required: true,
        unique: true
    },
    saldo_favor: {
        type: Number,
        default: 0
    },
    notas: {
        type: String
    }
}, {
    timestamps: { 
        createdAt: false,
        updatedAt: true 
    }
});

// Índice para búsqueda rápida por saldo
saldoDomicilioSchema.index({ saldo_favor: -1 });

export const SaldoDomicilio = mongoose.model('SaldoDomicilio', saldoDomicilioSchema);