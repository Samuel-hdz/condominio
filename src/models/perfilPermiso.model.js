import mongoose from 'mongoose';

const perfilPermisoSchema = new mongoose.Schema(
  {
    nombre_perfil: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 100
    },

    descripcion: {
      type: String,
      maxlength: 200
    },

    permisos_json: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    roles_asociados: [
      {
        type: String,
        enum: ['administrador', 'caseta', 'comite'],
        required: true
      }
    ]
  },
  {
    timestamps: true
  }
);

// Índice adicional (opcional pero recomendado)
perfilPermisoSchema.index({ nombre_perfil: 1 });

export const PerfilPermiso = mongoose.model(
  'PerfilPermiso',
  perfilPermisoSchema
);
