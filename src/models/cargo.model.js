import mongoose from 'mongoose';

const cargoSchema = new mongoose.Schema({
    tipo_cargo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TipoCargo',
        required: true
    },
    nombre: {
        type: String,
        required: true,
        maxlength: 150
    },
    descripcion: {
        type: String
    },
    monto_base: {
        type: Number,
        required: true,
        min: 0
    },
    monto_total: {
        type: Number,
        required: true,
        min: 0
    },
    fecha_cargo: {
        type: Date,
        required: true
    },
    fecha_vencimiento: {
        type: Date,
        required: true
    },
    periodicidad: {
        type: String,
        enum: ['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', null]
    },
    siguiente_generacion: {
        type: Date
    },
    aplica_a: {
        type: String,
        enum: ['todos', 'domicilios', 'calles'],
        default: 'todos'
    },
    estatus: {
        type: String,
        enum: ['activo', 'pendiente', 'cancelado'],
        default: 'activo'
    },
    usuario_creador_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Índices
cargoSchema.index({ fecha_vencimiento: 1 });
cargoSchema.index({ estatus: 1 });
cargoSchema.index({ periodicidad: 1 });
cargoSchema.index({ siguiente_generacion: 1 });

// Middleware para calcular monto_total
cargoSchema.pre('save', function(next) {
    if (!this.monto_total && this.monto_base) {
        this.monto_total = this.monto_base;
    }
    next();
});

export const Cargo = mongoose.model('Cargo', cargoSchema);