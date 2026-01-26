import mongoose from 'mongoose';

const personalSchema = new mongoose.Schema({
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true
    },
    nombre: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150
    },
    telefono: {
        type: String,
        maxlength: 20
    },
    tipo_servicio: {
        type: String,
        required: true,
        maxlength: 100
    },
    frecuencia: {
        tipo: {
            type: String,
            enum: ['diario', 'semanal', 'quincenal', 'mensual', 'fecha_especifica'],
            default: 'semanal'
        },
        dias_semana: [{
            type: Number, // 0=Domingo, 1=Lunes, ..., 6=Sábado
            min: 0,
            max: 6
        }],
        fechas_especificas: [Date]
    },
    fecha_inicio: {
        type: Date,
        required: true
    },
    fecha_fin: {
        type: Date,
        required: true
    },
    estatus: {
        type: String,
        enum: ['activo', 'inactivo'],
        default: 'activo'
    },
    creado_por_usuario_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Índices
personalSchema.index({ residente_id: 1 });
personalSchema.index({ estatus: 1 });
personalSchema.index({ fecha_inicio: 1, fecha_fin: 1 });

// Validación: fecha_fin debe ser mayor que fecha_inicio
personalSchema.pre('save', function () {
    if (this.fecha_fin <= this.fecha_inicio) {
        throw new Error('La fecha de fin debe ser posterior a la fecha de inicio');
    }
});


export const Personal = mongoose.model('Personal', personalSchema);