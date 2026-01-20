import mongoose from 'mongoose';

const perfilUsuarioSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    fecha_nacimiento: {
        type: Date
    },
    genero: {
        type: String,
        enum: ['masculino', 'femenino', 'otro']
    },
    preferencias_json: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

export const PerfilUsuario = mongoose.model('PerfilUsuario', perfilUsuarioSchema);