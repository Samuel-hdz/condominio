import mongoose from 'mongoose';
import Utils from '../libs/utils.js';

const comprobantePagoSchema = new mongoose.Schema({
    folio: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    maxlength: 50,
    default: () => Utils.generateFolio('CP')
    },
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true
    },
    cargo_domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CargoDomicilio',
        required: true  // ← OBLIGATORIO ahora
    },
    monto_total: {
        type: Number,
        required: true,
        min: 0
    },
    fecha_pago: {
        type: Date,
        required: true
    },
    metodo_pago: {
        type: String,
        required: true,
        enum: ['transferencia', 'deposito', 'efectivo', 'tarjeta', 'cheque']
    },
    institucion_bancaria: {
        type: String,
        maxlength: 100
    },
    numero_referencia: {
        type: String,
        maxlength: 100
    },
    cuenta_destino: {
        type: String,
        maxlength: 50
    },
    comprobante_url: {
        type: String,
        required: true,
        maxlength: 255
    },
    observaciones: {
        type: String
    },
    estatus: {
        type: String,
        enum: ['pendiente', 'aprobado', 'rechazado'],
        default: 'pendiente'
    },
    motivo_rechazo: {
        type: String
    },
    fecha_aprobacion: {
        type: Date
    },
    usuario_aprobador_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    comprobante_final_url: {
        type: String,
        maxlength: 255
    }
}, {
    timestamps: true
});

// Índices
comprobantePagoSchema.index({ folio: 1 }, { unique: true });
comprobantePagoSchema.index({ estatus: 1 });
comprobantePagoSchema.index({ residente_id: 1 });
comprobantePagoSchema.index({ 
    estatus: 1, 
    created_at: -1 
});



export const ComprobantePago = mongoose.model('ComprobantePago', comprobantePagoSchema);