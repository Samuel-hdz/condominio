import mongoose from 'mongoose';

const calleTorreSchema = new mongoose.Schema({
    unidad_geografica_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UnidadGeografica',
        required: true
    },
    nombre: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    tipo: {
        type: String,
        required: true,
        enum: ['calle', 'torre', 'manzana'],
        default: 'calle'
    },
    orden: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Índices
calleTorreSchema.index({ unidad_geografica_id: 1, nombre: 1 }, { unique: true });
calleTorreSchema.index({ tipo: 1 });

export const CalleTorre = mongoose.model('CalleTorre', calleTorreSchema);