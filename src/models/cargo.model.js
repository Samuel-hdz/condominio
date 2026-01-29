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
        maxlength: 150,
        trim: true
    },
    descripcion: {
        type: String,
        trim: true
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
        enum: ['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', null],
        default: null
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
    },
    
    configuracion_admin: {
        decidio_recurrente: {
            type: Boolean,
            default: false
        },
        decidio_periodicidad: {
            type: String,
            enum: ['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', null],
            default: null
        },
        notas: {
            type: String,
            maxlength: 500
        },
        fecha_configuracion: {
            type: Date,
            default: Date.now
        }
    },
    
    metadata: {
        version: {
            type: Number,
            default: 1
        },
        origen: {
            type: String,
            enum: ['manual', 'recurrente', 'duplicado'],
            default: 'manual'
        }
    }
}, {
    timestamps: true
});

// Índices
cargoSchema.index({ fecha_vencimiento: 1 });
cargoSchema.index({ estatus: 1 });
cargoSchema.index({ periodicidad: 1 });
cargoSchema.index({ siguiente_generacion: 1 });
cargoSchema.index({ 'configuracion_admin.decidio_recurrente': 1 });

// Middleware para calcular monto_total si no existe
cargoSchema.pre('save', async function() {
    if (!this.monto_total && this.monto_base) {
        this.monto_total = this.monto_base;
    }
    
    // Auto-completar metadata si no existe
    if (!this.metadata) {
        this.metadata = {
            version: 1,
            origen: 'manual'
        };
    }
    
    // Si es recurrente, asegurar configuracion_admin
    if (this.periodicidad && !this.configuracion_admin.decidio_recurrente) {
        this.configuracion_admin.decidio_recurrente = true;
        this.configuracion_admin.decidio_periodicidad = this.periodicidad;
        this.configuracion_admin.fecha_configuracion = new Date();
    }
});

export const Cargo = mongoose.model('Cargo', cargoSchema);