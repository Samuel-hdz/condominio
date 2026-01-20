import mongoose from 'mongoose';

const comiteCargoSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        unique: true,
        maxlength: 50
    },
    descripcion: {
        type: String,
        maxlength: 200
    },
    jerarquia: {
        type: Number,
        default: 0,
        min: 0
    }
}, {
    timestamps: true
});

export const ComiteCargo = mongoose.model('ComiteCargo', comiteCargoSchema);