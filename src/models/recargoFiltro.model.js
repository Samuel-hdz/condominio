import mongoose from 'mongoose';

const recargoFiltroSchema = new mongoose.Schema({
    recargo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Recargo',
        required: true
    },
    tipo_filtro: {
        type: String,
        required: true,
        enum: ['nombre_contiene', 'tipo_cargo']
    },
    valor_filtro: {
        type: String,
        required: true,
        maxlength: 100
    }
}, {
    timestamps: true
});

// Índices
recargoFiltroSchema.index({ recargo_id: 1 });
recargoFiltroSchema.index({ tipo_filtro: 1, valor_filtro: 1 });

export const RecargoFiltro = mongoose.model('RecargoFiltro', recargoFiltroSchema);