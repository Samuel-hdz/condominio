import mongoose from 'mongoose';

const mensajeSchema = new mongoose.Schema({
    conversacion_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversacion',
        required: true
    },
    remitente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    mensaje: {
        type: String,
        required: true
    },
    tipo: {
        type: String,
        enum: ['texto', 'imagen', 'documento', 'audio'],
        default: 'texto'
    },
    archivo_url: {
        type: String,
        maxlength: 255
    },
    leido: {
        type: Boolean,
        default: false
    },
    fecha_leido: {
        type: Date
    }
}, {
    timestamps: true
});

// Índices
mensajeSchema.index({ conversacion_id: 1 });
mensajeSchema.index({ conversacion_id: 1, leido: 1 });
mensajeSchema.index({ created_at: -1 });

// Middleware para actualizar ultimo_mensaje_at en la conversación
mensajeSchema.post('save', async function(doc) {
    const Conversacion = mongoose.model('Conversacion');
    
    await Conversacion.findByIdAndUpdate(doc.conversacion_id, {
        ultimo_mensaje_at: doc.created_at
    });
});

export const Mensaje = mongoose.model('Mensaje', mensajeSchema);