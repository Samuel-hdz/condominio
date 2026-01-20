import mongoose from 'mongoose';

const auditoriaGeneralSchema = new mongoose.Schema({
    tabla: {
        type: String,
        required: true,
        maxlength: 50
    },
    registro_id: {
        type: String,
        required: true
    },
    accion: {
        type: String,
        required: true,
        enum: ['INSERT', 'UPDATE', 'DELETE']
    },
    usuario_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    datos_anteriores: {
        type: mongoose.Schema.Types.Mixed
    },
    datos_nuevos: {
        type: mongoose.Schema.Types.Mixed
    },
    ip_address: {
        type: String,
        maxlength: 45
    },
    user_agent: {
        type: String,
        maxlength: 255
    }
}, {
    timestamps: true
});

// Índices para consultas frecuentes
auditoriaGeneralSchema.index({ tabla: 1, registro_id: 1 });
auditoriaGeneralSchema.index({ usuario_id: 1 });
auditoriaGeneralSchema.index({ created_at: -1 });
auditoriaGeneralSchema.index({ accion: 1 });

// Middleware para registrar automáticamente auditorías de modelos importantes
export const setupAuditoria = (modelo, nombreTabla) => {
    modelo.schema.post('save', async function(doc) {
        try {
            const accion = doc.isNew ? 'INSERT' : 'UPDATE';
            
            await AuditoriaGeneral.create({
                tabla: nombreTabla,
                registro_id: doc._id.toString(),
                accion,
                usuario_id: doc.usuario_creador_id || doc.usuario_id || doc.user_id || null,
                datos_nuevos: doc.toObject()
            });
        } catch (error) {
            console.error('Error al registrar auditoría:', error);
        }
    });
    
    modelo.schema.post('remove', async function(doc) {
        try {
            await AuditoriaGeneral.create({
                tabla: nombreTabla,
                registro_id: doc._id.toString(),
                accion: 'DELETE',
                usuario_id: doc.usuario_creador_id || doc.usuario_id || doc.user_id || null,
                datos_anteriores: doc.toObject()
            });
        } catch (error) {
            console.error('Error al registrar auditoría:', error);
        }
    });
};

export const AuditoriaGeneral = mongoose.model('AuditoriaGeneral', auditoriaGeneralSchema);