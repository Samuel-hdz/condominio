// models/residenteMorosidad.model.js
import mongoose from 'mongoose';

const residenteMorosidadSchema = new mongoose.Schema({
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true,
        unique: true
    },
    es_moroso: {
        type: Boolean,
        default: false
    },
    monto_adeudado: {
        type: Number,
        default: 0,
        min: 0
    },
    dias_morosidad: {
        type: Number,
        default: 0,
        min: 0
    },
    fecha_primer_morosidad: {
        type: Date
    },
    notificaciones_enviadas: {
        type: Number,
        default: 0
    },
    ultima_notificacion: {
        type: Date
    },
    suspendido_por_morosidad: {
        type: Boolean,
        default: false
    },
    fecha_suspension: {
        type: Date
    },
    motivo_suspension: {
        type: String,
        maxlength: 200
    }
}, {
    timestamps: { 
        createdAt: false,
        updatedAt: 'fecha_actualizacion'
    }
});

// Middleware para actualizar automáticamente
residenteMorosidadSchema.pre('save', async function () {
    const ahora = new Date();
    
    // Actualizar si es moroso
    this.es_moroso = this.monto_adeudado > 0;
    
    if (this.monto_adeudado > 0) {
        // Si es la primera vez que se vuelve moroso
        if (!this.fecha_primer_morosidad) {
            this.fecha_primer_morosidad = ahora;
            this.dias_morosidad = 1;
        } else {
            // Calcular días desde la primera morosidad
            const dias = Math.floor((ahora - this.fecha_primer_morosidad) / (1000 * 60 * 60 * 24));
            this.dias_morosidad = Math.max(1, dias);
        }
    } else {
        // Si ya no debe, resetear
        this.dias_morosidad = 0;
        this.fecha_primer_morosidad = null;
        this.suspendido_por_morosidad = false;
        this.fecha_suspension = null;
    }
});

export const ResidenteMorosidad = mongoose.model('ResidenteMorosidad', residenteMorosidadSchema);