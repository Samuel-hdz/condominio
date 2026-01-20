import mongoose from 'mongoose';

const bitacoraIncidenciaSchema = new mongoose.Schema({
    usuario_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    tipo_incidencia: {
        type: String,
        required: true,
        enum: ['seguridad', 'mantenimiento', 'convivencia', 'otro']
    },
    fecha_incidencia: {
        type: Date,
        required: true,
        default: Date.now
    },
    domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Domicilio'
    },
    descripcion: {
        type: String,
        required: true
    },
    acciones_tomadas: {
        type: String
    },
    necesita_seguimiento: {
        type: Boolean,
        default: false
    },
    seguimiento_completado: {
        type: Boolean,
        default: false
    },
    notificar_residente: {
        type: Boolean,
        default: false
    },
    fecha_notificacion: {
        type: Date
    },
    residente_notificado_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente'
    }
}, {
    timestamps: true
});

// Índices
bitacoraIncidenciaSchema.index({ fecha_incidencia: -1 });
bitacoraIncidenciaSchema.index({ tipo_incidencia: 1 });
bitacoraIncidenciaSchema.index({ domicilio_id: 1 });
bitacoraIncidenciaSchema.index({ necesita_seguimiento: 1, seguimiento_completado: 1 });

export const BitacoraIncidencia = mongoose.model('BitacoraIncidencia', bitacoraIncidenciaSchema);