import mongoose from 'mongoose';

const userRoleSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    role: {
        type: String,
        required: true,
        enum: ['residente', 'administrador', 'caseta', 'comite']
    }
}, {
    timestamps: true
});

// Índice único compuesto
userRoleSchema.index({ user_id: 1, role: 1 }, { unique: true });

export const UserRole = mongoose.model('UserRole', userRoleSchema);