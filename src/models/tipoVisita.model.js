import mongoose from 'mongoose';

const tipoVisitaSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        unique: true,
        maxlength: 50
    },
    descripcion: {
        type: String,
        maxlength: 200
    }
}, {
    timestamps: true
});

export const TipoVisita = mongoose.model('TipoVisita', tipoVisitaSchema);