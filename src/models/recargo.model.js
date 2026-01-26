import mongoose from 'mongoose';

const recargoSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        maxlength: 150
    },
    descripcion: {
        type: String,
        maxlength: 500
    },
    tipo_recargo: {
        type: String,
        required: true,
        enum: ['monto_fijo', 'porcentaje_original', 'porcentaje_saldo', 'porcentaje_total_acumulado']
    },
    valor: {
        type: Number,
        required: true,
        min: 0
    },
    considerar_adeudos_mayores_de: {
        type: Number,
        default: 0,
        min: 0
    },
    aplicar_solo_a: [{
        type: String,
        enum: ['mantenimiento', 'extraordinario', 'multa']
    }],
    repetitivo: {
        type: Boolean,
        default: false
    },
    frecuencia_dias: {
        type: Number,
        min: 1,
        default: 30
    },
    fecha_inicio_vigencia: {
        type: Date,
        default: Date.now
    },
    fecha_fin_vigencia: {
        type: Date
    },
    activo: {
        type: Boolean,
        default: true
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
recargoSchema.index({ activo: 1 });
recargoSchema.index({ repetitivo: 1 });
recargoSchema.index({ fecha_inicio_vigencia: 1 });
recargoSchema.index({ fecha_fin_vigencia: 1 });

export const Recargo = mongoose.model('Recargo', recargoSchema);