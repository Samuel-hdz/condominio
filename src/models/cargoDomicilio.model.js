import mongoose from 'mongoose';

const cargoDomicilioSchema = new mongoose.Schema({
    cargo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Cargo',
        required: true
    },
    domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Domicilio',
        required: true
    },
    monto: {
        type: Number,
        required: true,
        min: 0
    },
    monto_descuento: {
        type: Number,
        default: 0,
        min: 0
    },
    porcentaje_descuento: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    monto_final: {
        type: Number,
        required: true,
        min: 0
    },
    saldo_pendiente: {
        type: Number,
        required: true,
        min: 0
    },
    fecha_pago: {
        type: Date
    },
    estatus: {
        type: String,
        enum: ['pendiente', 'pagado', 'vencido', 'cancelado'],
        default: 'pendiente'
    }
}, {
    timestamps: true
});

// Índices
cargoDomicilioSchema.index({ estatus: 1 });
cargoDomicilioSchema.index({ cargo_id: 1, domicilio_id: 1 }, { unique: true });
cargoDomicilioSchema.index({ domicilio_id: 1, estatus: 1 });

// Middleware para calcular monto_final y saldo_pendiente
cargoDomicilioSchema.pre('save', function(next) {
    // Calcular monto_final restando descuentos
    let montoFinal = this.monto;
    
    if (this.porcentaje_descuento > 0) {
        montoFinal -= (this.monto * this.porcentaje_descuento / 100);
    }
    
    if (this.monto_descuento > 0) {
        montoFinal -= this.monto_descuento;
    }
    
    this.monto_final = Math.max(0, montoFinal);
    
    // Si hay fecha_pago, saldo_pendiente = 0
    if (this.fecha_pago) {
        this.saldo_pendiente = 0;
        if (this.estatus === 'pendiente') {
            this.estatus = 'pagado';
        }
    } else {
        this.saldo_pendiente = this.monto_final;
    }
    
    next();
});

export const CargoDomicilio = mongoose.model('CargoDomicilio', cargoDomicilioSchema);