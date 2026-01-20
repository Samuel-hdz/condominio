import mongoose from 'mongoose';

const descuentoSchema = new mongoose.Schema({
    cargo_domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CargoDomicilio',
        required: true
    },
    tipo_descuento: {
        type: String,
        required: true,
        enum: ['monto_fijo', 'porcentaje']
    },
    nombre_descuento: {
        type: String,
        required: true,
        maxlength: 100
    },
    valor: {
        type: Number,
        required: true,
        min: 0
    },
    motivo: {
        type: String
    },
    fecha_aplicacion: {
        type: Date,
        default: Date.now
    },
    usuario_aplicador_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
});

// Índices
descuentoSchema.index({ cargo_domicilio_id: 1 });
descuentoSchema.index({ fecha_aplicacion: -1 });

export const Descuento = mongoose.model('Descuento', descuentoSchema);