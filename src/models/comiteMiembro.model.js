import mongoose from 'mongoose';

const comiteMiembroSchema = new mongoose.Schema({
    residente_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Residente',
        required: true,
        unique: true
    },
    cargo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ComiteCargo',
        required: true
    },
    cargo_personalizado: {
        type: String,
        maxlength: 100
    },
    fecha_inicio: {
        type: Date,
        required: true,
        default: Date.now
    },
    fecha_fin: {
        type: Date
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
comiteMiembroSchema.index({ residente_id: 1 }, { unique: true });
comiteMiembroSchema.index({ estatus: 1 });

// Middleware: Al agregar miembro al comité, asignar rol 'comite'
comiteMiembroSchema.post('save', async function(doc) {
    const UserRole = mongoose.model('UserRole');
    const Residente = mongoose.model('Residente');
    const PermisoUsuario = mongoose.model('PermisoUsuario');
    const ModuloSistema = mongoose.model('ModuloSistema');
    
    try {
        // Obtener el residente y su usuario
        const residente = await Residente.findById(doc.residente_id).populate('user_id');
        
        if (residente && residente.user_id) {
            // Verificar si ya tiene rol comite
            const existingRole = await UserRole.findOne({
                user_id: residente.user_id._id,
                role: 'comite'
            });
            
            if (!existingRole) {
                // Asignar rol comite
                await UserRole.create({
                    user_id: residente.user_id._id,
                    role: 'comite'
                });
                
                // Asignar permisos básicos de "ver" a módulos específicos
                const modulosBasicos = await ModuloSistema.find({
                    nombre: { $in: ['Residentes', 'Comité', 'Publicaciones'] }
                });
                
                for (const modulo of modulosBasicos) {
                    await PermisoUsuario.findOneAndUpdate(
                        { user_id: residente.user_id._id, modulo_id: modulo._id },
                        { 
                            user_id: residente.user_id._id,
                            modulo_id: modulo._id,
                            nivel_permiso: 'ver'
                        },
                        { upsert: true }
                    );
                }
                
                console.log(`Rol y permisos asignados al miembro del comité: ${residente.user_id.nombre}`);
            }
        }
    } catch (error) {
        console.error('Error al asignar rol y permisos al miembro del comité:', error);
    }
});

export const ComiteMiembro = mongoose.model('ComiteMiembro', comiteMiembroSchema);