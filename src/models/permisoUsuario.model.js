import mongoose from 'mongoose';

const permisoUsuarioSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    modulo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ModuloSistema',
        required: true
    },
    nivel_permiso: {
        type: String,
        enum: ['ninguno', 'ver', 'editar', 'administrar'],
        default: 'ninguno'
    }
}, {
    timestamps: true
});

// Índice único compuesto
permisoUsuarioSchema.index({ user_id: 1, modulo_id: 1 }, { unique: true });

export const PermisoUsuario = mongoose.model('PermisoUsuario', permisoUsuarioSchema);