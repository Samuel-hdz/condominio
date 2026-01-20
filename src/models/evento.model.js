import mongoose from 'mongoose';

const eventoSchema = new mongoose.Schema({
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true
    },
    nombre_evento: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150
    },
    descripcion: {
        type: String
    },
    ubicacion: {
        type: String,
        maxlength: 200
    },
    fecha_inicio: {
        type: Date,
        required: true
    },
    fecha_fin: {
        type: Date,
        required: true
    },
    max_invitados: {
        type: Number,
        default: 0 // 0 = ilimitado
    },
    invitados_registrados: {
        type: Number,
        default: 0
    },
    codigo_qr_evento: {
        type: String,
        unique: true,
        sparse: true
    }
}, {
    timestamps: true
});

// Índices
eventoSchema.index({ residente_id: 1 });
eventoSchema.index({ fecha_inicio: 1 });
eventoSchema.index({ fecha_fin: 1 });

// Validar que fecha_fin sea mayor que fecha_inicio
eventoSchema.pre('save', function (next) {
    if (this.fecha_fin <= this.fecha_inicio) {
        return next(new Error('La fecha de fin debe ser posterior a la fecha de inicio'));
    }
    next();
});


export const Evento = mongoose.model('Evento', eventoSchema);