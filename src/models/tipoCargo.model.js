import mongoose from 'mongoose';

const tipoCargoSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        unique: true,
        maxlength: 100,
        trim: true
    },
    codigo: {
        type: String,
        unique: true,
        maxlength: 20,
        uppercase: true,
        trim: true,
        required: true
    },
    descripcion: {
        type: String,
        maxlength: 500
    },
    tipo: {
        type: String,
        required: true,
        enum: ['mantenimiento', 'extraordinario', 'multa']
    },
    dias_vencimiento_sugerido: {
        type: Number,
        default: 30,
        min: 1,
        max: 365
    },
    monto_base_sugerido: {
        type: Number,
        min: 0,
        default: 0
    },    
    categoria: {
        type: String,
        enum: ['ordinario', 'extraordinario', 'sancion', 'servicio', 'ajuste'],
        default: 'ordinario'
    },    
    sugerir_recurrente: {
        type: Boolean,
        default: false
    },
    periodicidad_sugerida: {
        type: String,
        enum: ['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', null],
        default: null
    },
    
    activo: {
        type: Boolean,
        default: true
    },
    orden_prioridad: {
        type: Number,
        default: 1,
        min: 1,
        max: 10
    }
}, {
    timestamps: true
});

export const TipoCargo = mongoose.model('TipoCargo', tipoCargoSchema);