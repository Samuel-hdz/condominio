import mongoose from 'mongoose';

const cuentaBancariaSchema = new mongoose.Schema({
    titulo: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    numero_cuenta: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    institucion: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    clabe: {
        type: String,
        trim: true,
        maxlength: 18
    },
    swift_code: {
        type: String,
        trim: true,
        maxlength: 11
    },
    tipo_cuenta: {
        type: String,
        enum: ['cheques', 'ahorro', 'inversion'],
        default: 'cheques'
    },
    moneda: {
        type: String,
        default: 'MXN',
        maxlength: 3
    },
    activa: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Índice único para evitar cuentas duplicadas
cuentaBancariaSchema.index({ 
    institucion: 1, 
    numero_cuenta: 1 
}, { unique: true });

export const CuentaBancaria = mongoose.model('CuentaBancaria', cuentaBancariaSchema);