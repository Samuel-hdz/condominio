import { PermisoUsuario } from '../models/permisoUsuario.model.js';
import { ModuloSistema } from '../models/moduloSistema.model.js';
import { PerfilPermiso } from '../models/perfilPermiso.model.js';
import { UserRole } from '../models/userRole.model.js';

/**
 * Servicio para gestión de permisos del sistema
 */

class PermissionService {
    /**
     * Obtiene todos los permisos de un usuario
     * @param {String} userId - ID del usuario
     * @returns {Promise<Array>} Permisos del usuario
     */
    static async getUserPermissions(userId) {
        return await PermisoUsuario.find({ user_id: userId })
            .populate('modulo_id', 'nombre descripcion ruta icono parent_id')
            .lean();
    }

    /**
     * Verifica si un usuario tiene permiso para un módulo
     * @param {String} userId - ID del usuario
     * @param {String} moduleRoute - Ruta del módulo
     * @param {String} requiredLevel - Nivel requerido ('ver', 'editar', 'administrar')
     * @returns {Promise<Boolean>} True si tiene permiso
     */
    static async hasPermission(userId, moduleRoute, requiredLevel = 'ver') {
        const nivelOrden = { 'ninguno': 0, 'ver': 1, 'editar': 2, 'administrar': 3 };
        const requiredOrder = nivelOrden[requiredLevel] || 0;

        // Buscar el módulo por ruta
        const modulo = await ModuloSistema.findOne({ ruta: moduleRoute });
        if (!modulo) return false;

        // Buscar permiso del usuario para este módulo
        const permiso = await PermisoUsuario.findOne({
            user_id: userId,
            modulo_id: modulo._id
        });

        if (!permiso) {
            // Si no tiene permiso específico, verificar permisos heredados del perfil
            return await this.checkProfilePermissions(userId, modulo._id, requiredOrder);
        }

        const userOrder = nivelOrden[permiso.nivel_permiso] || 0;
        return userOrder >= requiredOrder;
    }

    /**
     * Verifica permisos heredados de perfiles
     * @param {String} userId - ID del usuario
     * @param {String} moduleId - ID del módulo
     * @param {Number} requiredOrder - Nivel requerido en orden
     * @returns {Promise<Boolean>} True si tiene permiso
     */
    static async checkProfilePermissions(userId, moduleId, requiredOrder) {
        // Obtener roles del usuario
        const roles = await UserRole.find({ user_id: userId });
        const roleNames = roles.map(r => r.role);

        // Buscar perfiles asociados a estos roles
        const perfiles = await PerfilPermiso.find({
            roles_asociados: { $in: roleNames }
        });

        // Verificar permisos en cada perfil
        for (const perfil of perfiles) {
            if (perfil.permisos_json) {
                // Buscar el módulo en los permisos del perfil
                const modulo = await ModuloSistema.findById(moduleId);
                if (modulo && perfil.permisos_json[modulo.nombre]) {
                    const nivelOrden = { 'ninguno': 0, 'ver': 1, 'editar': 2, 'administrar': 3 };
                    const profileOrder = nivelOrden[perfil.permisos_json[modulo.nombre]] || 0;
                    
                    if (profileOrder >= requiredOrder) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Asigna permisos a un usuario basado en su rol
     * @param {String} userId - ID del usuario
     * @param {String} role - Rol del usuario
     * @returns {Promise<Array>} Permisos asignados
     */
    static async assignDefaultPermissions(userId, role) {
        // Buscar perfil predeterminado para este rol
        const perfil = await PerfilPermiso.findOne({
            roles_asociados: role
        });

        if (!perfil || !perfil.permisos_json) {
            return [];
        }

        const assignedPermissions = [];

        // Para cada permiso en el perfil, asignarlo al usuario
        for (const [moduloNombre, nivel] of Object.entries(perfil.permisos_json)) {
            const modulo = await ModuloSistema.findOne({ nombre: moduloNombre });
            
            if (modulo) {
                // Crear o actualizar permiso
                const permiso = await PermisoUsuario.findOneAndUpdate(
                    { user_id: userId, modulo_id: modulo._id },
                    { nivel_permiso: nivel },
                    { upsert: true, new: true }
                );
                
                assignedPermissions.push(permiso);
            }
        }

        return assignedPermissions;
    }

    /**
     * Actualiza permisos de un usuario
     * @param {String} userId - ID del usuario
     * @param {Array} permissions - Array de permisos a actualizar
     * @returns {Promise<Array>} Permisos actualizados
     */
    static async updateUserPermissions(userId, permissions) {
        const updatedPermissions = [];

        for (const perm of permissions) {
            const { moduloId, nivel } = perm;

            const permiso = await PermisoUsuario.findOneAndUpdate(
                { user_id: userId, modulo_id: moduloId },
                { nivel_permiso: nivel },
                { upsert: true, new: true }
            );

            updatedPermissions.push(permiso);
        }

        return updatedPermissions;
    }

    /**
     * Obtiene el árbol completo de módulos con permisos del usuario
     * @param {String} userId - ID del usuario
     * @returns {Promise<Array>} Árbol de módulos con permisos
     */
    static async getModuleTreeWithPermissions(userId) {
        // Obtener todos los módulos
        const modulos = await ModuloSistema.find({ activo: true })
            .sort({ orden: 1 })
            .lean();

        // Obtener permisos del usuario
        const userPermissions = await PermisoUsuario.find({ user_id: userId })
            .populate('modulo_id', 'nombre')
            .lean();

        // Crear mapa de permisos
        const permissionMap = {};
        userPermissions.forEach(p => {
            if (p.modulo_id) {
                permissionMap[p.modulo_id.nombre] = p.nivel_permiso;
            }
        });

        // Construir árbol jerárquico
        const moduleMap = {};
        const rootModules = [];

        // Primero, crear mapa de módulos
        modulos.forEach(modulo => {
            moduleMap[modulo._id] = {
                ...modulo,
                children: [],
                permiso: permissionMap[modulo.nombre] || 'ninguno',
                tieneAcceso: (permissionMap[modulo.nombre] && permissionMap[modulo.nombre] !== 'ninguno')
            };
        });

        // Luego, construir árbol
        modulos.forEach(modulo => {
            if (modulo.parent_id) {
                if (moduleMap[modulo.parent_id]) {
                    moduleMap[modulo.parent_id].children.push(moduleMap[modulo._id]);
                }
            } else {
                rootModules.push(moduleMap[modulo._id]);
            }
        });

        // Filtrar módulos sin acceso (y sus hijos) si no tienen permiso
        const filterModules = (modules) => {
            return modules.filter(module => {
                if (module.tieneAcceso) {
                    module.children = filterModules(module.children);
                    return true;
                }
                return false;
            });
        };

        return filterModules(rootModules);
    }

    /**
     * Verifica si un usuario tiene al menos un rol específico
     * @param {String} userId - ID del usuario
     * @param {Array|String} roles - Rol o roles a verificar
     * @returns {Promise<Boolean>} True si tiene el rol
     */
    static async hasRole(userId, roles) {
        const rolesArray = Array.isArray(roles) ? roles : [roles];
        
        const userRole = await UserRole.findOne({
            user_id: userId,
            role: { $in: rolesArray }
        });

        return !!userRole;
    }

    /**
     * Obtiene todos los roles de un usuario
     * @param {String} userId - ID del usuario
     * @returns {Promise<Array>} Roles del usuario
     */
    static async getUserRoles(userId) {
        const roles = await UserRole.find({ user_id: userId });
        return roles.map(r => r.role);
    }

    /**
     * Obtiene resumen de permisos para la tabla de usuarios
     * @param {String} userId - ID del usuario
     * @returns {Promise<Object>} Resumen de permisos
     */
    static async getPermissionsSummary(userId) {
        const permisos = await PermisoUsuario.find({ user_id: userId });
        
        const summary = {
            editar: 0,
            ver: 0,
            ninguno: 0,
            total: permisos.length
        };

        permisos.forEach(p => {
            if (summary[p.nivel_permiso] !== undefined) {
                summary[p.nivel_permiso]++;
            }
        });

        return summary;
    }
}

export default PermissionService;