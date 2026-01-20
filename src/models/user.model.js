import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 100,
        match: [/^\S+@\S+\.\S+$/, 'Por favor ingresa un email válido']
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        maxlength: 50
    },
    password_hash: {
        type: String,
        required: true
    },
    nombre: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    apellido: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    telefono: {
        type: String,
        trim: true,
        maxlength: 20
    },
    estatus: {
        type: String,
        enum: ['activo', 'inactivo', 'suspendido'],
        default: 'activo'
    }
}, {
    timestamps: true
});

// Índices
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ estatus: 1 });

// Middleware para encriptar contraseña antes de guardar
userSchema.pre('save', async function () {
    if (!this.isModified('password_hash')) return;

    const salt = await bcrypt.genSalt(10);
    this.password_hash = await bcrypt.hash(this.password_hash, salt);
});

// Método para comparar contraseñas
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password_hash);
};

export const User = mongoose.model('User', userSchema);