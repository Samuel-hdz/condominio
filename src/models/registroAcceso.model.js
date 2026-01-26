import mongoose from 'mongoose';

const registroAccesoSchema = new mongoose.Schema({
    autorizacion_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AutorizacionVisita'
    },
    nombre_visitante: {
        type: String,
        required: true,
        maxlength: 150
    },
    tipo_acceso: {
        type: String,
        required: true,
        enum: ['visitante_vip', 'unica_vez', 'proveedor', 'evento', 'residente', 'personal']
    },
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true
    },
    metodo_acceso: {
        type: String,
        enum: [
            'qr',                    // QR individual
            'texto',                 // Código de texto
            'manual',                // Ingreso manual
            'qr_compartido',         // QR compartido (eventos, etc.)
            'qr_evento_compartido',  // QR compartido específico para eventos
            'qr_evento'              // QR individual de evento
        ],
        default: 'qr'
    },
    fecha_hora_ingreso: {
        type: Date,
        required: true,
        default: Date.now
    },
    fecha_hora_salida: {
        type: Date
    },
    usuario_caseta_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    estado: {
        type: String,
        enum: ['permitido', 'denegado', 'en_progreso', 'finalizado'],
        default: 'permitido'
    },
    motivo_denegacion: {
        type: String,
        maxlength: 200
    },
    foto_ingreso_url: {
        type: String,
        maxlength: 255
    },
    foto_salida_url: {
        type: String,
        maxlength: 255
    },
    observaciones: {
        type: String
    }
}, {
    timestamps: { 
        createdAt: 'created_at',
        updatedAt: false 
    }
});

// Índices para consultas frecuentes
registroAccesoSchema.index({ fecha_hora_ingreso: -1 });
registroAccesoSchema.index({ estado: 1 });
registroAccesoSchema.index({ residente_id: 1 });
registroAccesoSchema.index({ 
    residente_id: 1, 
    fecha_hora_ingreso: -1 
});
registroAccesoSchema.index({ autorizacion_id: 1 });

export const RegistroAcceso = mongoose.model('RegistroAcceso', registroAccesoSchema);