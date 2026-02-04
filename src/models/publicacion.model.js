import mongoose from 'mongoose';

const publicacionSchema = new mongoose.Schema({
    usuario_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    titulo: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    contenido: {
        type: String,
        required: true
    },
    tipo: {
        type: String,
        enum: ['boletin', 'anuncio', 'emergencia', 'evento_comunidad'],
        default: 'boletin'
    },
    adjunto_url: {
        type: String,
        maxlength: 255
    },
    fecha_publicacion: {
        type: Date,
        default: Date.now
    },
    programado: {
        type: Boolean,
        default: false
    },
    fecha_programada: {
        type: Date
    },
    prioridad: {
        type: String,
        enum: ['baja', 'normal', 'alta', 'urgente'],
        default: 'normal'
    },
    notificaciones_enviadas: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Índices
publicacionSchema.index({ fecha_publicacion: -1 });
publicacionSchema.index({ programado: 1 });
publicacionSchema.index({ tipo: 1 });
publicacionSchema.index({ prioridad: 1 });

// Validar fechas de programación
publicacionSchema.pre('save', function () {
    if (this.programado && !this.fecha_programada) {
        throw new Error('Las publicaciones programadas requieren fecha_programada');
    }
});



export const Publicacion = mongoose.model('Publicacion', publicacionSchema);