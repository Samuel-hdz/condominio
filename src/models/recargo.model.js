import mongoose from 'mongoose';

const recargoSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        maxlength: 150
    },
    tipo_recargo: {
        type: String,
        required: true,
        enum: ['monto_fijo', 'porcentaje_original', 'porcentaje_saldo', 'porcentaje_total']
    },
    valor: {
        type: Number,
        required: true,
        min: 0
    },
    aplica_a: {
        type: String,
        enum: ['mantenimiento', 'extraordinario', 'multa', 'todos'],
        default: 'todos'
    },
    monto_minimo: {
        type: Number,
        default: 0,
        min: 0
    },
    repetitivo: {
        type: Boolean,
        default: false
    },
    frecuencia_dias: {
        type: Number,
        min: 1
    },
    activo: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

export const Recargo = mongoose.model('Recargo', recargoSchema);