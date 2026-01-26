import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { 
    UnidadGeografica, 
    CalleTorre, 
    Domicilio,
    User,
    UserRole,
    Residente,
    EstadoRecepcion,
    ResidenteMorosidad,
    TipoVisita,
    Proveedor,
    ComiteCargo,
    ModuloSistema,
    PerfilPermiso,
    TipoCargo,
    CuentaBancaria
} from '../models/index.js';

class EnhancedSeeder {
    static async seedAll() {
        console.log('🌱 Iniciando seeder mejorado...');
        
        try {
            // 1. Unidades Geográficas (condominios/fraccionamientos)
            await this.seedGeographicUnits();
            
            // 2. Calles/Torres
            await this.seedStreetsTowers();
            
            // 3. Domicilios
            await this.seedDomiciles();
            
            // 4. Usuarios Administrativos
            await this.seedAdminUsers();
            
            // 5. Tipos de Visita
            await this.seedVisitTypes();
            
            // 6. Proveedores
            await this.seedProviders();
            
            // 7. Cargos del Comité
            await this.seedCommitteePositions();
            
            // 8. Tipos de Cargo
            await this.seedChargeTypes();
            
            // 9. Cuentas Bancarias
            await this.seedBankAccounts();
            
            // 10. Perfiles de Permisos
            await this.seedPermissionProfiles();
            
            // 11. Módulos del Sistema
            await this.seedSystemModules();
            
            console.log('✅ Seeder mejorado completado exitosamente');
        } catch (error) {
            console.error('❌ Error en seeder mejorado:', error);
            throw error;
        }
    }
    
    static async seedGeographicUnits() {
        const unidades = [
            {
                nombre: 'Residencial Las Lomas',
                tipo: 'fraccionamiento',
                direccion: 'Av. Las Lomas 123, Col. Las Lomas',
                telefono: '555-123-4567',
                email: 'admin@laslomas.com'
            }
        ];
        
        for (const unidad of unidades) {
            await UnidadGeografica.findOneAndUpdate(
                { nombre: unidad.nombre },
                unidad,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Unidades geográficas sembradas');
    }
    
    static async seedStreetsTowers() {
        // Obtener unidades geográficas
        const unidades = await UnidadGeografica.find();
        
        const callesTorres = [
            // Residencial Las Lomas
            { unidad: 'Residencial Las Lomas', nombre: 'Calle Bugambilias', tipo: 'calle', orden: 1 },
            { unidad: 'Residencial Las Lomas', nombre: 'Calle Jacarandas', tipo: 'calle', orden: 2 },
            { unidad: 'Residencial Las Lomas', nombre: 'Calle Gardenias', tipo: 'calle', orden: 3 }
        ];
        
        for (const ct of callesTorres) {
            const unidad = unidades.find(u => u.nombre === ct.unidad);
            if (unidad) {
                await CalleTorre.findOneAndUpdate(
                    { unidad_geografica_id: unidad._id, nombre: ct.nombre },
                    {
                        unidad_geografica_id: unidad._id,
                        nombre: ct.nombre,
                        tipo: ct.tipo,
                        orden: ct.orden
                    },
                    { upsert: true, new: true }
                );
            }
        }
        console.log('✅ Calles/Torres sembradas');
    }
    
    static async seedDomiciles() {
        // Obtener calles/torres
        const callesTorres = await CalleTorre.find().populate('unidad_geografica_id');
        
        const domicilios = [];
        
        // Generar domicilios para cada calle/torre
        for (const ct of callesTorres) {
            const esTorre = ct.tipo === 'torre';
            const cantidad = esTorre ? 12 : 8; // Torres tienen más departamentos
            
            for (let i = 1; i <= cantidad; i++) {
                const domicilio = {
                    calle_torre_id: ct._id,
                    numero: i.toString(),
                    letra: esTorre ? String.fromCharCode(64 + i) : null, // A, B, C para torres
                    referencia: `${ct.unidad_geografica_id.nombre} - ${ct.nombre}`
                };
                
                domicilios.push(domicilio);
            }
        }
        
        for (const dom of domicilios) {
            await Domicilio.findOneAndUpdate(
                { 
                    calle_torre_id: dom.calle_torre_id,
                    numero: dom.numero,
                    letra: dom.letra
                },
                dom,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Domicilios sembrados');
    }
    
    static async seedAdminUsers() {
        const adminUsers = [
            {
                email: 'admin@laslomas.com',
                username: 'admin_lomas',
                password: 'Admin123!',
                nombre: 'Juan',
                apellido: 'Pérez',
                telefono: '555-111-2233',
                roles: ['administrador']
            }
        ];
        
        for (const userData of adminUsers) {
            // Verificar si ya existe
            let user = await User.findOne({ 
                $or: [
                    { email: userData.email },
                    { username: userData.username }
                ]
            });
            
            if (!user) {
                // Crear usuario
                user = await User.create({
                    email: userData.email,
                    username: userData.username,
                    password_hash: userData.password, // Se encriptará automáticamente
                    nombre: userData.nombre,
                    apellido: userData.apellido,
                    telefono: userData.telefono,
                    estatus: 'activo'
                });
                
                console.log(`✅ Usuario creado: ${user.email}`);
            }
            
            // Asignar roles
            for (const role of userData.roles) {
                await UserRole.findOneAndUpdate(
                    { user_id: user._id, role },
                    { user_id: user._id, role },
                    { upsert: true }
                );
            }
        }
        
        console.log('✅ Usuarios administrativos sembrados');
    }
    
    static async seedVisitTypes() {
        const tipos = [
            { nombre: 'visitante_vip', descripcion: 'Visitante Preferente (VIP)' },
            { nombre: 'unica_vez', descripcion: 'Autorizado por única vez' },
            { nombre: 'proveedor', descripcion: 'Proveedor autorizado' },
            { nombre: 'personal', descripcion: 'Personal de servicio' },
            { nombre: 'evento', descripcion: 'Invitado a evento' },
            { nombre: 'personal', descripcion: 'Personal doméstico' }
        ];
        
        for (const tipo of tipos) {
            await TipoVisita.findOneAndUpdate(
                { nombre: tipo.nombre },
                tipo,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Tipos de visita sembrados');
    }
    
    static async seedProviders() {
        const proveedores = [
            { nombre: 'Agua Purificada El Manantial', servicio: 'Agua', empresa: 'El Manantial', telefono: '555-100-2000' },
            { nombre: 'Gas LP Express', servicio: 'Gas', empresa: 'Gas Express', telefono: '555-100-2001' },
            { nombre: 'Limpieza Total', servicio: 'Limpieza', empresa: 'Limpieza Total S.A.', telefono: '555-100-2002' },
            { nombre: 'Jardinería Verde', servicio: 'Jardinería', empresa: 'Verde Jardines', telefono: '555-100-2003' },
            { nombre: 'Plomería Rápida', servicio: 'Plomería', empresa: 'Rápida Plomería', telefono: '555-100-2004' },
            { nombre: 'Electricidad Segura', servicio: 'Electricidad', empresa: 'Segura Electric', telefono: '555-100-2005' },
            { nombre: 'Cerrajería 24hrs', servicio: 'Cerrajería', empresa: '24hrs Cerrajeros', telefono: '555-100-2006' },
            { nombre: 'Pintura Perfecta', servicio: 'Pintura', empresa: 'Perfecta Pinturas', telefono: '555-100-2007' }
        ];
        
        for (const prov of proveedores) {
            await Proveedor.findOneAndUpdate(
                { nombre: prov.nombre },
                prov,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Proveedores sembrados');
    }
    
    static async seedCommitteePositions() {
        const cargos = [
            { nombre: 'Presidente', descripcion: 'Presidente del comité', jerarquia: 1 },
            { nombre: 'Vicepresidente', descripcion: 'Vicepresidente del comité', jerarquia: 2 },
            { nombre: 'Secretario', descripcion: 'Secretario del comité', jerarquia: 3 },
            { nombre: 'Tesorero', descripcion: 'Tesorero del comité', jerarquia: 4 },
            { nombre: 'Vocal', descripcion: 'Vocal del comité', jerarquia: 5 },
            { nombre: 'Miembro general', descripcion: 'Miembro general del comité', jerarquia: 6 },
            { nombre: 'Otro', descripcion: 'Otro cargo en el comité', jerarquia: 7 }
        ];
        
        for (const cargo of cargos) {
            await ComiteCargo.findOneAndUpdate(
                { nombre: cargo.nombre },
                cargo,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Cargos del comité sembrados');
    }
    
    static async seedChargeTypes() {
        const tipos = [
            {
            codigo: 'MANT-MEN',
            nombre: 'Mantenimiento Ordinario',
            tipo: 'mantenimiento',
            descripcion: 'Cuota para mantenimiento mensual',
            dias_vencimiento_sugerido: 10,
            monto_base_sugerido: 2500.00,
            sugerir_recurrente: true,
            periodicidad_sugerida: 'mensual',
            categoria: 'ordinario'
        },
        {
            codigo: 'EXT-GEN',
            nombre: 'Cuota Extraordinaria',
            tipo: 'extraordinario',
            descripcion: 'Contribución extraordinaria',
            dias_vencimiento_sugerido: 30,
            monto_base_sugerido: 5000.00,
            sugerir_recurrente: false,
            categoria: 'extraordinario'
        },
        {
            codigo: 'MUL-ESTAC',
            nombre: 'Multa por Estacionamiento',
            tipo: 'multa',
            descripcion: 'Sanción por estacionamiento indebido',
            dias_vencimiento_sugerido: 15,
            monto_base_sugerido: 300.00,
            sugerir_recurrente: false,
            categoria: 'sancion'
        }
        ];
        
        for (const tipo of tipos) {
            await TipoCargo.findOneAndUpdate(
                { nombre: tipo.nombre },
                tipo,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Tipos de cargo sembrados');
    }
    
    static async seedBankAccounts() {
        const cuentas = [
            {
                titulo: 'Cuenta Principal Mantenimiento',
                numero_cuenta: '1234567890',
                institucion: 'Banco Comercial',
                clabe: '012180001234567890',
                tipo_cuenta: 'cheques',
                moneda: 'MXN'
            },
            {
                titulo: 'Cuenda Extraordinaria',
                numero_cuenta: '0987654321',
                institucion: 'Banco de Ahorro',
                clabe: '012180009876543210',
                tipo_cuenta: 'ahorro',
                moneda: 'MXN'
            }
        ];
        
        for (const cuenta of cuentas) {
            await CuentaBancaria.findOneAndUpdate(
                { 
                    institucion: cuenta.institucion,
                    numero_cuenta: cuenta.numero_cuenta
                },
                cuenta,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Cuentas bancarias sembradas');
    }
    
    static async seedPermissionProfiles() {
        const perfiles = [
            {
                nombre_perfil: 'Administrador',
                descripcion: 'Acceso completo a todos los módulos',
                roles_asociados: ['administrador'],
                permisos_json: {
                    'Administración': 'administrar',
                    'Caseta': 'administrar',
                    'Cobranza': 'administrar',
                    'Configuración': 'administrar',
                    'Residentes': 'administrar',
                    'Usuarios (Personal)': 'administrar',
                    'Comité': 'administrar',
                    'Publicaciones': 'administrar',
                    'Libro de Visitas': 'administrar',
                    'Bitácora': 'administrar',
                    'Paquetería': 'administrar',
                    'Cuotas': 'administrar',
                    'Recaudación': 'administrar',
                    'Comprobantes': 'administrar',
                    'Cuentas de Pago': 'administrar',
                    'Permisos': 'administrar'
                }
            },
            {
                nombre_perfil: 'Personal de Caseta',
                descripcion: 'Acceso a módulos de caseta y visitas',
                roles_asociados: ['caseta'],
                permisos_json: {
                    'Libro de Visitas': 'editar',
                    'Bitácora': 'editar',
                    'Paquetería': 'editar',
                    'Chat Caseta': 'editar',
                    'Residentes': 'ver',
                    'Caseta': 'ver'
                }
            },
            {
                nombre_perfil: 'Miembro de Comité',
                descripcion: 'Permisos de visualización para miembros del comité',
                roles_asociados: ['comite'],
                permisos_json: {
                    'Administración': 'ver',
                    'Caseta': 'ver',
                    'Cobranza': 'ver',
                    'Configuración': 'ver',
                    'Residentes': 'ver',
                    'Usuarios (Personal)': 'ver',
                    'Comité': 'ver',
                    'Publicaciones': 'ver',
                    'Libro de Visitas': 'ver',
                    'Bitácora': 'ver',
                    'Paquetería': 'ver',
                    'Cuotas': 'ver',
                    'Recaudación': 'ver',
                    'Comprobantes': 'ver',
                    'Cuentas de Pago': 'ver',
                    'Permisos': 'ver'
                }
            }
        ];
        
        for (const perfil of perfiles) {
            await PerfilPermiso.findOneAndUpdate(
                { nombre_perfil: perfil.nombre_perfil },
                perfil,
                { upsert: true, new: true }
            );
        }
        console.log('✅ Perfiles de permisos sembrados');
    }
    
    static async seedSystemModules() {
        const modulos = [
            // Módulo Administración (padre)
            { nombre: 'Administración', descripcion: 'Módulo principal de administración', icono: 'settings', ruta: '/admin', orden: 1 },
            
            // Submódulos de Administración
            { nombre: 'Residentes', descripcion: 'Gestión de residentes', icono: 'people', ruta: '/admin/residentes', orden: 1 },
            { nombre: 'Usuarios (Personal)', descripcion: 'Gestión de usuarios del sistema', icono: 'personnel', ruta: '/admin/usuarios', orden: 2 },
            { nombre: 'Comité', descripcion: 'Gestión del comité', icono: 'committee', ruta: '/admin/comite', orden: 3 },
            { nombre: 'Publicaciones', descripcion: 'Gestión de publicaciones', icono: 'news', ruta: '/admin/publicaciones', orden: 4 },
            
            // Módulo Caseta (padre)
            { nombre: 'Caseta', descripcion: 'Módulo de caseta de vigilancia', icono: 'security', ruta: '/caseta', orden: 2 },
            
            // Submódulos de Caseta
            { nombre: 'Libro de Visitas', descripcion: 'Registro de visitas', icono: 'visits', ruta: '/caseta/visitas', orden: 1 },
            { nombre: 'Bitácora', descripcion: 'Registro de incidencias', icono: 'log', ruta: '/caseta/bitacora', orden: 2 },
            { nombre: 'Paquetería', descripcion: 'Control de paquetes', icono: 'packages', ruta: '/caseta/paqueteria', orden: 3 },
            { nombre: 'Chat Caseta', descripcion: 'Chat con residentes', icono: 'chat', ruta: '/caseta/chat', orden: 4 },
            
            // Módulo Cobranza (padre)
            { nombre: 'Cobranza y recaudación', descripcion: 'Módulo de cobranza', icono: 'payments', ruta: '/cobranza', orden: 3 },
            
            // Submódulos de Cobranza
            { nombre: 'Cuotas', descripcion: 'Gestión de cuotas', icono: 'fees', ruta: '/cobranza/cuotas', orden: 1 },
            { nombre: 'Recaudación', descripcion: 'Estado de cuenta y pagos', icono: 'collection', ruta: '/cobranza/recaudacion', orden: 2 },
            { nombre: 'Comprobantes', descripcion: 'Validación de pagos', icono: 'receipts', ruta: '/cobranza/comprobantes', orden: 3 },
            
            // Módulo Configuración (padre)
            { nombre: 'Configuración', descripcion: 'Configuración del sistema', icono: 'config', ruta: '/config', orden: 4 },
            
            // Submódulos de Configuración
            { nombre: 'Cuentas de Pago', descripcion: 'Referencias bancarias', icono: 'bank', ruta: '/config/cuentas', orden: 1 },
            { nombre: 'Permisos', descripcion: 'Gestión de permisos del sistema', icono: 'shield', ruta: '/config/permisos', orden: 2 }
        ];
        
        // Insertar módulos padres primero
        const modulosPadre = [
            'Administración',
            'Caseta', 
            'Cobranza y recaudación',
            'Configuración'
        ];
        
        for (const nombrePadre of modulosPadre) {
            const moduloPadreData = modulos.find(m => m.nombre === nombrePadre);
            const moduloPadre = await ModuloSistema.findOneAndUpdate(
                { nombre: moduloPadreData.nombre },
                moduloPadreData,
                { upsert: true, new: true }
            );
            
            // Insertar submódulos asociados al padre
            const subModulos = modulos.filter(m => 
                m.nombre !== nombrePadre && 
                m.ruta.startsWith(moduloPadreData.ruta)
            );
            
            for (const subModulo of subModulos) {
                await ModuloSistema.findOneAndUpdate(
                    { nombre: subModulo.nombre },
                    { ...subModulo, parent_id: moduloPadre._id },
                    { upsert: true, new: true }
                );
            }
        }
        
        console.log('✅ Módulos del sistema sembrados');
    }
}

export default EnhancedSeeder;