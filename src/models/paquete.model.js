import mongoose from 'mongoose';

const paqueteSchema = new mongoose.Schema({
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true
    },
    usuario_caseta_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    numero_guia: {
        type: String,
        maxlength: 100
    },
    empresa_paqueteria: {
        type: String,
        maxlength: 100
    },
    descripcion: {
        type: String
    },
    fecha_recepcion: {
        type: Date,
        required: true,
        default: Date.now
    },
    fecha_notificacion: {
        type: Date
    },
    fecha_retiro: {
        type: Date
    },
    usuario_retiro_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    estado: {
        type: String,
        enum: ['por_retirar', 'notificado', 'retirado', 'eliminado'],
        default: 'por_retirar'
    },
    observaciones: {
        type: String
    },
    foto_paquete_url: {
        type: String,
        maxlength: 255
    }
}, {
    timestamps: true
});

// Índices para consultas frecuentes
paqueteSchema.index({ residente_id: 1, estado: 1 });
paqueteSchema.index({ estado: 1 });
paqueteSchema.index({ fecha_recepcion: -1 });

// Middleware para actualizar fechas según estado
paqueteSchema.pre('save', async function () {
    const now = new Date();

    if (this.estado === 'notificado' && !this.fecha_notificacion) {
        this.fecha_notificacion = now;
    }

    if (this.estado === 'retirado' && !this.fecha_retiro) {
        this.fecha_retiro = now;
    }
});


export const Paquete = mongoose.model('Paquete', paqueteSchema);