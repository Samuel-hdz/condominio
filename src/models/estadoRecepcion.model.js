import mongoose from 'mongoose';

const estadoRecepcionSchema = new mongoose.Schema({
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true,
        unique: true
    },
    recibiendo_visitas: {
        type: Boolean,
        default: true
    },
    recibiendo_personal: {
        type: Boolean,
        default: true
    },
    ultima_modificacion_por: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Índice para búsqueda rápida
estadoRecepcionSchema.index({ recibiendo_visitas: 1, recibiendo_personal: 1 });

export const EstadoRecepcion = mongoose.model('EstadoRecepcion', estadoRecepcionSchema);