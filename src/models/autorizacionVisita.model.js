import mongoose from 'mongoose';

const autorizacionVisitaSchema = new mongoose.Schema({
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true
    },
    tipo_visita_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TipoVisita',
        required: true
    },
    proveedor_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Proveedor'
    },
    evento_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Evento'
    },
    nombre_visitante: {
        type: String,
        maxlength: 150
    },
    telefono_visitante: {
        type: String,
        maxlength: 20
    },
    fecha_inicio_vigencia: {
        type: Date,
        required: true
    },
    fecha_fin_vigencia: {
        type: Date,
        required: true
    },
    es_visita_unica: {
        type: Boolean,
        default: false
    },
    fecha_visita_unica: {
        type: Date
    },
    codigo_acceso: {
        type: String,
        unique: true,
        sparse: true
    },
    qr_code: {
        type: String,
        unique: true,
        sparse: true
    },
    limite_ingresos: {
        type: Number,
        default: 1
    },
    ingresos_realizados: {
        type: Number,
        default: 0
    },
    ingresos_disponibles: {
        type: Number,
        default: 1
    },
    estado: {
        type: String,
        enum: ['pendiente', 'activa', 'usada', 'expirada', 'cancelada'],
        default: 'activa'
    },
    motivo_cancelacion: {
        type: String,
        maxlength: 200
    },
    fecha_primer_uso: {
        type: Date
    },
    fecha_ultimo_uso: {
        type: Date
    },
    usuario_creador_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Índices compuestos para optimización
autorizacionVisitaSchema.index({ residente_id: 1 });
autorizacionVisitaSchema.index({ tipo_visita_id: 1 });
autorizacionVisitaSchema.index({ estado: 1 });
autorizacionVisitaSchema.index({ fecha_fin_vigencia: 1 });
autorizacionVisitaSchema.index({ evento_id: 1 });
autorizacionVisitaSchema.index({ proveedor_id: 1 });
autorizacionVisitaSchema.index({ 
    residente_id: 1, 
    estado: 1, 
    fecha_fin_vigencia: 1 
});

// Middleware para actualizar ingresos_disponibles
autorizacionVisitaSchema.pre('save', async function() {
    this.ingresos_disponibles = this.limite_ingresos - this.ingresos_realizados;
});

export const AutorizacionVisita = mongoose.model('AutorizacionVisita', autorizacionVisitaSchema);