import mongoose from 'mongoose';

const destinatarioPublicacionSchema = new mongoose.Schema({
    publicacion_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Publicacion',
        required: true
    },
    tipo_destino: {
        type: String,
        required: true,
        enum: ['todos', 'calle', 'domicilio']
    },
    calle_torre_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CalleTorre'
    },
    domicilio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Domicilio'
    }
}, {
    timestamps: true
});

// Índices
destinatarioPublicacionSchema.index({ publicacion_id: 1 });
destinatarioPublicacionSchema.index({ tipo_destino: 1 });
destinatarioPublicacionSchema.index({ calle_torre_id: 1 });
destinatarioPublicacionSchema.index({ domicilio_id: 1 });

// Validación: Según tipo_destino, debe tener el campo correspondiente
destinatarioPublicacionSchema.pre('save', function (next) {
    if (this.tipo_destino === 'calle' && !this.calle_torre_id) {
        return next(new Error('Para destino tipo "calle" se requiere calle_torre_id'));
    }

    if (this.tipo_destino === 'domicilio' && !this.domicilio_id) {
        return next(new Error('Para destino tipo "domicilio" se requiere domicilio_id'));
    }

    if (this.tipo_destino === 'todos' && (this.calle_torre_id || this.domicilio_id)) {
        return next(new Error('Para destino "todos" no se deben especificar calle_torre_id ni domicilio_id'));
    }

    next();
});


export const DestinatarioPublicacion = mongoose.model('DestinatarioPublicacion', destinatarioPublicacionSchema);