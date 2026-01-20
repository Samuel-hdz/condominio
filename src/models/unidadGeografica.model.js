import mongoose from 'mongoose';

const unidadGeograficaSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    tipo: {
        type: String,
        required: true,
        enum: ['condominio', 'fraccionamiento'],
        default: 'condominio'
    },
    direccion: {
        type: String,
        maxlength: 200
    },
    telefono: {
        type: String,
        maxlength: 20
    },
    email: {
        type: String,
        maxlength: 100,
        lowercase: true,
        trim: true
    }
}, {
    timestamps: true
});

// Índices
unidadGeograficaSchema.index({ tipo: 1 });
unidadGeograficaSchema.index({ nombre: 1 }, { unique: true });

export const UnidadGeografica = mongoose.model('UnidadGeografica', unidadGeograficaSchema);