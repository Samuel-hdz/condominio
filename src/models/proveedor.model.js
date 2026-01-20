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

export const Proveedor = mongoose.model('Proveedor', proveedorSchema);