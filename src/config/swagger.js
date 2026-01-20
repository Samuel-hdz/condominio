import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Sistema de Gestión Residencial API',
      version: '1.0.0',
      description: `
API REST para el Sistema de Gestión Residencial (Condominio).

## Descripción General
Este sistema permite la gestión integral de condominios y fraccionamientos, incluyendo:
- Gestión de usuarios y residentes
- Control de visitas y accesos
- Administración de paquetería
- Comunicaciones y notificaciones
- Finanzas y pagos
- Gestión del comité de vigilancia

## Autenticación
La API utiliza JWT (JSON Web Tokens) para la autenticación. Incluye el token en el header:
\`\`\`
Authorization: Bearer <tu_token>
\`\`\`

## Roles de Usuario
- **administrador**: Acceso completo al sistema
- **comite**: Miembros del comité de vigilancia
- **caseta**: Personal de caseta/seguridad
- **residente**: Residentes del condominio
      `,
      contact: {
        name: 'Soporte Técnico',
        email: 'soporte@condominio.com'
      },
      license: {
        name: 'ISC',
        url: 'https://opensource.org/licenses/ISC'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000/api',
        description: 'Servidor de Desarrollo'
      },
      {
        url: 'https://api.condominio.com/api',
        description: 'Servidor de Producción'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT obtenido del endpoint /auth/login'
        }
      },
      schemas: {
        // Schemas comunes
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Error message' },
            errors: { 
              type: 'array', 
              items: { type: 'string' },
              example: ['Field validation error']
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { type: 'object' }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 10 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 10 }
          }
        },
        // Auth schemas
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'admin@condominio.com' },
            password: { type: 'string', format: 'password', example: 'password123' }
          }
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Login exitoso' },
            user: { $ref: '#/components/schemas/User' },
            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }
          }
        },
        ChangePasswordRequest: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', format: 'password' },
            newPassword: { type: 'string', format: 'password', minLength: 6 }
          }
        },
        // User schemas
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
            email: { type: 'string', format: 'email', example: 'usuario@email.com' },
            nombre: { type: 'string', example: 'Juan' },
            apellidoPaterno: { type: 'string', example: 'Pérez' },
            apellidoMaterno: { type: 'string', example: 'García' },
            telefono: { type: 'string', example: '5512345678' },
            activo: { type: 'boolean', example: true },
            roles: { 
              type: 'array', 
              items: { type: 'string' },
              example: ['residente']
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateUserRequest: {
          type: 'object',
          required: ['email', 'password', 'nombre', 'apellidoPaterno'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', format: 'password', minLength: 6 },
            nombre: { type: 'string' },
            apellidoPaterno: { type: 'string' },
            apellidoMaterno: { type: 'string' },
            telefono: { type: 'string' },
            roles: { 
              type: 'array', 
              items: { type: 'string', enum: ['administrador', 'comite', 'caseta', 'residente'] }
            }
          }
        },
        // Resident schemas
        Resident: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            usuario: { $ref: '#/components/schemas/User' },
            domicilio: { $ref: '#/components/schemas/Domicile' },
            esPrincipal: { type: 'boolean' },
            activo: { type: 'boolean' },
            estadoRecepcion: { $ref: '#/components/schemas/ReceptionStatus' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateResidentRequest: {
          type: 'object',
          required: ['usuarioId', 'domicilioId'],
          properties: {
            usuarioId: { type: 'string' },
            domicilioId: { type: 'string' },
            esPrincipal: { type: 'boolean', default: false }
          }
        },
        ReceptionStatus: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            residente: { type: 'string' },
            recibirPaquetes: { type: 'boolean' },
            recibirVisitas: { type: 'boolean' },
            mensajeAusencia: { type: 'string' },
            fechaInicioAusencia: { type: 'string', format: 'date-time' },
            fechaFinAusencia: { type: 'string', format: 'date-time' }
          }
        },
        // Visit schemas
        VisitAuthorization: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            residente: { type: 'string' },
            nombreVisitante: { type: 'string' },
            tipoVisita: { $ref: '#/components/schemas/VisitType' },
            fechaAutorizacion: { type: 'string', format: 'date-time' },
            fechaExpiracion: { type: 'string', format: 'date-time' },
            codigoQR: { type: 'string' },
            estatus: { 
              type: 'string', 
              enum: ['pendiente', 'activa', 'utilizada', 'expirada', 'cancelada'] 
            },
            usosPermitidos: { type: 'integer' },
            usosRealizados: { type: 'integer' }
          }
        },
        CreateVisitAuthorizationRequest: {
          type: 'object',
          required: ['nombreVisitante', 'tipoVisita'],
          properties: {
            nombreVisitante: { type: 'string' },
            tipoVisita: { type: 'string' },
            fechaExpiracion: { type: 'string', format: 'date-time' },
            usosPermitidos: { type: 'integer', default: 1 },
            notas: { type: 'string' }
          }
        },
        VisitType: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            nombre: { type: 'string', example: 'Familiar' },
            descripcion: { type: 'string' },
            requiereAutorizacion: { type: 'boolean' },
            activo: { type: 'boolean' }
          }
        },
        AccessRecord: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            autorizacion: { type: 'string' },
            fechaIngreso: { type: 'string', format: 'date-time' },
            fechaSalida: { type: 'string', format: 'date-time' },
            registradoPor: { type: 'string' },
            notas: { type: 'string' }
          }
        },
        // Package schemas
        Package: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            domicilio: { $ref: '#/components/schemas/Domicile' },
            descripcion: { type: 'string' },
            remitente: { type: 'string' },
            fechaRecepcion: { type: 'string', format: 'date-time' },
            fechaEntrega: { type: 'string', format: 'date-time' },
            estatus: { 
              type: 'string', 
              enum: ['pendiente', 'notificado', 'entregado', 'devuelto'] 
            },
            registradoPor: { type: 'string' },
            entregadoA: { type: 'string' }
          }
        },
        CreatePackageRequest: {
          type: 'object',
          required: ['domicilioId', 'descripcion'],
          properties: {
            domicilioId: { type: 'string' },
            descripcion: { type: 'string' },
            remitente: { type: 'string' },
            notas: { type: 'string' }
          }
        },
        // Communication schemas
        Publication: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            titulo: { type: 'string' },
            contenido: { type: 'string' },
            tipo: { 
              type: 'string', 
              enum: ['aviso', 'boletin', 'emergencia', 'mantenimiento'] 
            },
            autor: { type: 'string' },
            fechaPublicacion: { type: 'string', format: 'date-time' },
            fechaExpiracion: { type: 'string', format: 'date-time' },
            activo: { type: 'boolean' }
          }
        },
        CreatePublicationRequest: {
          type: 'object',
          required: ['titulo', 'contenido', 'tipo'],
          properties: {
            titulo: { type: 'string' },
            contenido: { type: 'string' },
            tipo: { 
              type: 'string', 
              enum: ['aviso', 'boletin', 'emergencia', 'mantenimiento'] 
            },
            destinatarios: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'IDs de domicilios o "todos"'
            },
            fechaExpiracion: { type: 'string', format: 'date-time' }
          }
        },
        Conversation: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            participantes: { 
              type: 'array', 
              items: { type: 'string' } 
            },
            asunto: { type: 'string' },
            estatus: { 
              type: 'string', 
              enum: ['abierta', 'cerrada'] 
            },
            ultimoMensaje: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Message: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            conversacion: { type: 'string' },
            remitente: { type: 'string' },
            contenido: { type: 'string' },
            leido: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        // Finance schemas
        AccountStatus: {
          type: 'object',
          properties: {
            saldoActual: { type: 'number', example: 1500.00 },
            cargos: { 
              type: 'array', 
              items: { $ref: '#/components/schemas/Charge' } 
            },
            ultimoPago: { type: 'string', format: 'date-time' },
            morosidad: { type: 'boolean' }
          }
        },
        Charge: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            domicilio: { type: 'string' },
            concepto: { type: 'string' },
            monto: { type: 'number' },
            fechaEmision: { type: 'string', format: 'date-time' },
            fechaVencimiento: { type: 'string', format: 'date-time' },
            estatus: { 
              type: 'string', 
              enum: ['pendiente', 'pagado', 'vencido', 'cancelado'] 
            }
          }
        },
        PaymentReceipt: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            domicilio: { type: 'string' },
            monto: { type: 'number' },
            fechaPago: { type: 'string', format: 'date-time' },
            metodoPago: { type: 'string' },
            referencia: { type: 'string' },
            comprobante: { type: 'string' },
            estatus: { 
              type: 'string', 
              enum: ['pendiente', 'validado', 'rechazado'] 
            }
          }
        },
        BankAccount: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            banco: { type: 'string' },
            titular: { type: 'string' },
            numeroCuenta: { type: 'string' },
            clabe: { type: 'string' },
            activo: { type: 'boolean' }
          }
        },
        // Admin schemas
        GeographicUnit: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            nombre: { type: 'string', example: 'Fraccionamiento Las Palmas' },
            tipo: { type: 'string', example: 'fraccionamiento' },
            activo: { type: 'boolean' }
          }
        },
        StreetTower: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            unidadGeografica: { type: 'string' },
            nombre: { type: 'string', example: 'Calle Principal' },
            tipo: { type: 'string', enum: ['calle', 'torre', 'edificio'] },
            activo: { type: 'boolean' }
          }
        },
        Domicile: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            calleTorre: { type: 'string' },
            numero: { type: 'string', example: '123' },
            interior: { type: 'string', example: 'A' },
            activo: { type: 'boolean' }
          }
        },
        PermissionProfile: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            nombre: { type: 'string' },
            descripcion: { type: 'string' },
            permisos: { 
              type: 'array', 
              items: { 
                type: 'object',
                properties: {
                  modulo: { type: 'string' },
                  ver: { type: 'boolean' },
                  crear: { type: 'boolean' },
                  editar: { type: 'boolean' },
                  eliminar: { type: 'boolean' }
                }
              } 
            }
          }
        },
        SystemStatistics: {
          type: 'object',
          properties: {
            totalUsuarios: { type: 'integer' },
            totalResidentes: { type: 'integer' },
            totalDomicilios: { type: 'integer' },
            visitasHoy: { type: 'integer' },
            paquetesPendientes: { type: 'integer' },
            morosidad: { type: 'number' }
          }
        },
        // Committee schemas
        CommitteeMember: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            residente: { $ref: '#/components/schemas/Resident' },
            cargo: { $ref: '#/components/schemas/CommitteePosition' },
            fechaInicio: { type: 'string', format: 'date-time' },
            fechaFin: { type: 'string', format: 'date-time' },
            activo: { type: 'boolean' }
          }
        },
        CommitteePosition: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            nombre: { type: 'string', example: 'Presidente' },
            descripcion: { type: 'string' },
            orden: { type: 'integer' },
            activo: { type: 'boolean' }
          }
        },
        // System schemas
        Notification: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            usuario: { type: 'string' },
            titulo: { type: 'string' },
            mensaje: { type: 'string' },
            tipo: { 
              type: 'string', 
              enum: ['info', 'warning', 'error', 'success'] 
            },
            leida: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        NotificationPreferences: {
          type: 'object',
          properties: {
            email: { type: 'boolean' },
            push: { type: 'boolean' },
            sms: { type: 'boolean' },
            tiposNotificacion: {
              type: 'object',
              properties: {
                visitas: { type: 'boolean' },
                paquetes: { type: 'boolean' },
                pagos: { type: 'boolean' },
                comunicados: { type: 'boolean' }
              }
            }
          }
        },
        IncidenceLog: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            tipo: { type: 'string' },
            descripcion: { type: 'string' },
            ubicacion: { type: 'string' },
            reportadoPor: { type: 'string' },
            estatus: { 
              type: 'string', 
              enum: ['reportada', 'en_proceso', 'resuelta', 'cancelada'] 
            },
            seguimiento: { 
              type: 'array', 
              items: { type: 'string' } 
            },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Dashboard: {
          type: 'object',
          properties: {
            resumen: { type: 'object' },
            actividadReciente: { type: 'array', items: { type: 'object' } },
            notificacionesPendientes: { type: 'integer' },
            accesosHoy: { type: 'integer' }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Token de acceso faltante o inválido',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'No autorizado. Token no proporcionado.'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'No tiene permisos para esta acción',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'No tiene permisos para realizar esta acción.'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Recurso no encontrado',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'Recurso no encontrado.'
              }
            }
          }
        },
        ValidationError: {
          description: 'Error de validación',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'Errores de validación',
                errors: ['El campo email es requerido']
              }
            }
          }
        }
      },
      parameters: {
        PageParam: {
          name: 'page',
          in: 'query',
          description: 'Número de página',
          schema: { type: 'integer', default: 1, minimum: 1 }
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          description: 'Número de resultados por página',
          schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 }
        },
        IdParam: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'ID del recurso (MongoDB ObjectId)',
          schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Autenticación y gestión de sesiones' },
      { name: 'Users', description: 'Gestión de usuarios del sistema' },
      { name: 'Residents', description: 'Gestión de residentes' },
      { name: 'Visits', description: 'Control de visitas y accesos' },
      { name: 'Packages', description: 'Gestión de paquetería' },
      { name: 'Communications', description: 'Comunicaciones y publicaciones' },
      { name: 'Finances', description: 'Finanzas y pagos' },
      { name: 'Admin', description: 'Administración del sistema' },
      { name: 'Committee', description: 'Gestión del comité de vigilancia' },
      { name: 'System', description: 'Funcionalidades del sistema' }
    ]
  },
  apis: ['./src/routes/*.js']
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
