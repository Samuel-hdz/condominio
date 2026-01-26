import mongoose from 'mongoose';

const proveedorSchema = new mongoose.Schema({
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
    servicio: {
        type: String,
        required: true,
        maxlength: 100
    },
    empresa: {
        type: String,
        maxlength: 100
    },
    creado_por_residente_id: {  // 👈 NUEVO
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente'
    },
    es_global: {  // 👈 NUEVO
        type: Boolean,
        default: false  // true = todos pueden ver, false = solo el creador
    },
    estatus: {
        type: String,
        enum: ['activo', 'inactivo'],
        default: 'activo'
    }
}, {
    timestamps: true
});

// Índices
proveedorSchema.index({ servicio: 1 });
proveedorSchema.index({ estatus: 1 });
proveedorSchema.index({ es_global: 1 });  // 👈 NUEVO
proveedorSchema.index({ creado_por_residente_id: 1 });  // 👈 NUEVO

export const Proveedor = mongoose.model('Proveedor', proveedorSchema);