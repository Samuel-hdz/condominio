import mongoose from 'mongoose';

const residenteSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Domicilio',
        required: true
    },
    es_principal: {
        type: Boolean,
        default: false
    },
    creado_por_residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente'
    },
    estatus: {
        type: String,
        enum: ['activo', 'inactivo'],
        default: 'activo'
    }
}, {
    timestamps: true
});

// Índices
residenteSchema.index({ domicilio_id: 1 });
residenteSchema.index({ user_id: 1, domicilio_id: 1 }, { unique: true });
residenteSchema.index({ creado_por_residente_id: 1 });
residenteSchema.index({ estatus: 1 });

export const Residente = mongoose.model('Residente', residenteSchema);