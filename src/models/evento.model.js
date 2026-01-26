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
    },
    // NUEVO: Para controlar si el QR del evento ya se usó al máximo
    qr_agotado: {
        type: Boolean,
        default: false
    },
    // NUEVO: Para saber si es un evento con QR compartido
    es_qr_compartido: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Índices
eventoSchema.index({ residente_id: 1 });
eventoSchema.index({ fecha_inicio: 1 });
eventoSchema.index({ fecha_fin: 1 });

// Validar que fecha_fin sea mayor que fecha_inicio
eventoSchema.path('fecha_fin').validate(function (value) {
    return value > this.fecha_inicio;
}, 'La fecha de fin debe ser posterior a la fecha de inicio');


// Método para verificar si se puede aceptar más invitados
eventoSchema.methods.puedeAceptarInvitado = function() {
    if (this.max_invitados === 0) return true; // Ilimitado
    if (this.qr_agotado) return false;
    return this.invitados_registrados < this.max_invitados;
};

// Método para registrar nuevo invitado
eventoSchema.methods.registrarInvitado = function() {
    if (this.max_invitados > 0) {
        this.invitados_registrados += 1;
        if (this.invitados_registrados >= this.max_invitados) {
            this.qr_agotado = true;
        }
    }
    return this.save();
};

export const Evento = mongoose.model('Evento', eventoSchema);