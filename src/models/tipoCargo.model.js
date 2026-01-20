import mongoose from 'mongoose';

const tipoCargoSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        unique: true,
        maxlength: 100
    },
    descripcion: {
        type: String,
        maxlength: 200
    },
    tipo: {
        type: String,
        required: true,
        enum: ['mantenimiento', 'extraordinario', 'multa']
    },
    recurrente: {
        type: Boolean,
        default: false
    },
    periodicidad: {
        type: String,
        enum: ['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', null]
    },
    dias_vencimiento: {
        type: Number,
        default: 30,
        min: 1
    }
}, {
    timestamps: true
});

export const TipoCargo = mongoose.model('TipoCargo', tipoCargoSchema);