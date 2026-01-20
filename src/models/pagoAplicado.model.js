import mongoose from 'mongoose';

const pagoAplicadoSchema = new mongoose.Schema({
    comprobante_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ComprobantePago',
        required: true
    },
    cargo_domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CargoDomicilio',
        required: true
    },
    monto_aplicado: {
        type: Number,
        required: true,
        min: 0
    },
    tipo_asignacion: {
        type: String,
        enum: ['automatica', 'manual'],
        default: 'automatica'
    },
    usuario_asignador_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Índices
pagoAplicadoSchema.index({ comprobante_id: 1 });
pagoAplicadoSchema.index({ cargo_domicilio_id: 1 });
pagoAplicadoSchema.index({ usuario_asignador_id: 1 });

export const PagoAplicado = mongoose.model('PagoAplicado', pagoAplicadoSchema);