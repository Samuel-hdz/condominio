import mongoose from 'mongoose';

const moduloSistemaSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        unique: true,
        maxlength: 100
    },
    descripcion: {
        type: String,
        maxlength: 200
    },
    icono: {
        type: String,
        maxlength: 50
    },
    ruta: {
        type: String,
        required: true,
        maxlength: 100
    },
    orden: {
        type: Number,
        default: 0
    },
    parent_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ModuloSistema'
    },
    activo: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Índice para jerarquía
moduloSistemaSchema.index({ parent_id: 1 });
moduloSistemaSchema.index({ orden: 1 });
moduloSistemaSchema.index({ ruta: 1 }, { unique: true });

export const ModuloSistema = mongoose.model('ModuloSistema', moduloSistemaSchema);