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
    personal_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Personal'
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
    },
    // NUEVO: Para eventos con QR compartido
    es_acceso_evento: {
        type: Boolean,
        default: false
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
autorizacionVisitaSchema.index({ personal_id: 1 }); // 👈 NUEVO ÍNDICE
autorizacionVisitaSchema.index({ 
    residente_id: 1, 
    estado: 1, 
    fecha_fin_vigencia: 1 
});

// Middleware para actualizar ingresos_disponibles
autorizacionVisitaSchema.pre('save', async function() {
    this.ingresos_disponibles = this.limite_ingresos - this.ingresos_realizados;
});

// Método para verificar si está vigente
autorizacionVisitaSchema.methods.estaVigente = function() {
    const ahora = new Date();
    return this.estado === 'activa' && 
           ahora >= this.fecha_inicio_vigencia && 
           ahora <= this.fecha_fin_vigencia;
};

// Método para verificar si puede ingresar
autorizacionVisitaSchema.methods.puedeIngresar = function() {
    if (this.estado !== 'activa') return false;
    if (!this.estaVigente()) return false;
    if (this.ingresos_disponibles <= 0) return false;
    return true;
};

export const AutorizacionVisita = mongoose.model('AutorizacionVisita', autorizacionVisitaSchema);