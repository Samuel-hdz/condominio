import { ComiteMiembro } from '../models/comiteMiembro.model.js';
import { ComiteCargo } from '../models/comiteCargo.model.js';
import { Residente } from '../models/residente.model.js';
import { User } from '../models/user.model.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import NotificationService from '../libs/notifications.js';

export const committeeController = {
    /**
     * Obtener todos los miembros del comité
     */
    getCommitteeMembers: catchAsync(async (req, res) => {
        const { estatus = 'activo' } = req.query;

        const query = { estatus };
        const miembros = await ComiteMiembro.find(query)
            .populate('residente_id', 'user_id')
            .populate({
                path: 'residente_id',
                populate: {
                    path: 'user_id',
                    select: 'nombre apellido email telefono'
                }
            })
            .populate('cargo_id', 'nombre descripcion jerarquia')
            .sort({ 'cargo_id.jerarquia': 1, 'residente_id.user_id.nombre': 1 });

        res.json({
            success: true,
            miembros
        });
    }),

    /**
     * Agregar miembro al comité
     */
    addCommitteeMember: catchAsync(async (req, res) => {
        const { residente_id, cargo_id, cargo_personalizado } = req.body;

        // Verificar que el residente existe
        const residente = await Residente.findById(residente_id)
            .populate('user_id');
        
        if (!residente) {
            return res.status(404).json({
                success: false,
                message: 'Residente no encontrado'
            });
        }

        // Verificar que no sea ya miembro del comité
        const existingMember = await ComiteMiembro.findOne({ residente_id });
        if (existingMember) {
            return res.status(400).json({
                success: false,
                message: 'El residente ya es miembro del comité'
            });
        }

        // Verificar que el cargo existe
        const cargo = await ComiteCargo.findById(cargo_id);
        if (!cargo) {
            return res.status(404).json({
                success: false,
                message: 'Cargo del comité no encontrado'
            });
        }

        // Crear miembro del comité
        const miembro = await ComiteMiembro.create({
            residente_id,
            cargo_id,
            cargo_personalizado,
            fecha_inicio: new Date(),
            estatus: 'activo'
        });

        // Asignar rol 'comite' al usuario
        const { UserRole } = await import('../models/userRole.model.js');
        await UserRole.findOneAndUpdate(
            { user_id: residente.user_id._id, role: 'comite' },
            { user_id: residente.user_id._id, role: 'comite' },
            { upsert: true }
        );

        // Asignar permisos básicos de comité (se hará automáticamente por el middleware del modelo)

        // Enviar notificación al nuevo miembro
        await NotificationService.sendNotification({
            userId: residente.user_id._id,
            tipo: 'push',
            titulo: '👑 Nuevo cargo en el comité',
            mensaje: `Has sido asignado como ${cargo_personalizado || cargo.nombre} en el comité.`,
            data: { 
                tipo: 'committee', 
                action: 'assigned',
                cargo: cargo_personalizado || cargo.nombre,
                miembro_id: miembro._id
            }
        });

        // Notificar a administradores
        const admins = await UserRole.find({ role: 'administrador' })
            .distinct('user_id');

        for (const adminId of admins) {
            await NotificationService.sendNotification({
                userId: adminId,
                tipo: 'in_app',
                titulo: '✅ Nuevo miembro del comité',
                mensaje: `${residente.user_id.nombre} ha sido agregado al comité.`,
                data: { 
                    tipo: 'committee', 
                    action: 'member_added',
                    miembro_id: miembro._id
                }
            });
        }

        // Obtener miembro con información completa
        const miembroCompleto = await ComiteMiembro.findById(miembro._id)
            .populate('residente_id', 'user_id')
            .populate({
                path: 'residente_id',
                populate: {
                    path: 'user_id',
                    select: 'nombre apellido email telefono'
                }
            })
            .populate('cargo_id', 'nombre descripcion jerarquia');

        res.status(201).json({
            success: true,
            message: 'Miembro agregado al comité exitosamente',
            miembro: miembroCompleto
        });
    }),

    /**
     * Actualizar cargo de miembro del comité
     */
    updateCommitteeMember: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { cargo_id, cargo_personalizado, estatus } = req.body;

        const miembro = await ComiteMiembro.findById(id)
            .populate('residente_id', 'user_id');
        
        if (!miembro) {
            return res.status(404).json({
                success: false,
                message: 'Miembro del comité no encontrado'
            });
        }

        // Actualizar campos
        if (cargo_id) {
            const cargo = await ComiteCargo.findById(cargo_id);
            if (!cargo) {
                return res.status(404).json({
                    success: false,
                    message: 'Cargo del comité no encontrado'
                });
            }
            miembro.cargo_id = cargo_id;
        }

        if (cargo_personalizado !== undefined) {
            miembro.cargo_personalizado = cargo_personalizado;
        }

        if (estatus) {
            miembro.estatus = estatus;
            
            // Si se inactiva, quitar rol 'comite'
            if (estatus === 'inactivo' || estatus === 'suspendido') {
                const { UserRole } = await import('../models/userRole.model.js');
                await UserRole.deleteOne({
                    user_id: miembro.residente_id.user_id._id,
                    role: 'comite'
                });
            }
        }

        await miembro.save();

        // Notificar al miembro si hubo cambios
        if (cargo_id || cargo_personalizado || estatus) {
            const cargoInfo = await ComiteCargo.findById(miembro.cargo_id);
            
            await NotificationService.sendNotification({
                userId: miembro.residente_id.user_id._id,
                tipo: 'push',
                titulo: '📋 Actualización de cargo en comité',
                mensaje: `Tu cargo en el comité ha sido actualizado${estatus ? ` (estado: ${estatus})` : ''}.`,
                data: { 
                    tipo: 'committee', 
                    action: 'updated',
                    cargo: cargo_personalizado || cargoInfo?.nombre,
                    estatus: miembro.estatus
                }
            });
        }

        res.json({
            success: true,
            message: 'Miembro del comité actualizado exitosamente',
            miembro
        });
    }),

    /**
     * Eliminar miembro del comité
     */
    removeCommitteeMember: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { motivo } = req.body;

        const miembro = await ComiteMiembro.findById(id)
            .populate('residente_id', 'user_id');
        
        if (!miembro) {
            return res.status(404).json({
                success: false,
                message: 'Miembro del comité no encontrado'
            });
        }

        // Guardar información para la notificación
        const cargoInfo = await ComiteCargo.findById(miembro.cargo_id);

        // Eliminar miembro
        await miembro.deleteOne();

        // Quitar rol 'comite' del usuario
        const { UserRole } = await import('../models/userRole.model.js');
        await UserRole.deleteOne({
            user_id: miembro.residente_id.user_id._id,
            role: 'comite'
        });

        // Notificar al ex-miembro
        await NotificationService.sendNotification({
            userId: miembro.residente_id.user_id._id,
            tipo: 'push',
            titulo: '👋 Removido del comité',
            mensaje: `Has sido removido del cargo de ${miembro.cargo_personalizado || cargoInfo?.nombre} en el comité.`,
            data: { 
                tipo: 'committee', 
                action: 'removed',
                motivo: motivo || 'Sin especificar'
            }
        });

        res.json({
            success: true,
            message: 'Miembro removido del comité exitosamente'
        });
    }),

    /**
     * Obtener cargos disponibles del comité
     */
    getCommitteePositions: catchAsync(async (req, res) => {
        const cargos = await ComiteCargo.find()
            .sort({ jerarquia: 1, nombre: 1 });

        res.json({
            success: true,
            cargos
        });
    }),

    /**
     * Crear nuevo cargo del comité
     */
    createCommitteePosition: catchAsync(async (req, res) => {
        const { nombre, descripcion, jerarquia } = req.body;

        // Verificar si ya existe un cargo con ese nombre
        const existingPosition = await ComiteCargo.findOne({ nombre });
        if (existingPosition) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un cargo con ese nombre'
            });
        }

        // Crear cargo
        const cargo = await ComiteCargo.create({
            nombre,
            descripcion,
            jerarquia: jerarquia || 0
        });

        res.status(201).json({
            success: true,
            message: 'Cargo del comité creado exitosamente',
            cargo
        });
    }),

    /**
     * Actualizar cargo del comité
     */
    updateCommitteePosition: catchAsync(async (req, res) => {
        const { id } = req.params;
        const { nombre, descripcion, jerarquia } = req.body;

        const cargo = await ComiteCargo.findById(id);
        if (!cargo) {
            return res.status(404).json({
                success: false,
                message: 'Cargo del comité no encontrado'
            });
        }

        // Verificar nombre único si se cambia
        if (nombre && nombre !== cargo.nombre) {
            const existingPosition = await ComiteCargo.findOne({ 
                nombre,
                _id: { $ne: id }
            });
            if (existingPosition) {
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe otro cargo con ese nombre'
                });
            }
            cargo.nombre = nombre;
        }

        if (descripcion !== undefined) cargo.descripcion = descripcion;
        if (jerarquia !== undefined) cargo.jerarquia = jerarquia;

        await cargo.save();

        res.json({
            success: true,
            message: 'Cargo del comité actualizado exitosamente',
            cargo
        });
    }),

    /**
     * Eliminar cargo del comité
     */
    deleteCommitteePosition: catchAsync(async (req, res) => {
        const { id } = req.params;

        const cargo = await ComiteCargo.findById(id);
        if (!cargo) {
            return res.status(404).json({
                success: false,
                message: 'Cargo del comité no encontrado'
            });
        }

        // Verificar si hay miembros usando este cargo
        const miembrosConCargo = await ComiteMiembro.countDocuments({ cargo_id: id });
        if (miembrosConCargo > 0) {
            return res.status(400).json({
                success: false,
                message: `No se puede eliminar el cargo porque ${miembrosConCargo} miembro(s) lo tienen asignado`
            });
        }

        await cargo.deleteOne();

        res.json({
            success: true,
            message: 'Cargo del comité eliminado exitosamente'
        });
    }),

    /**
     * Obtener residentes disponibles para agregar al comité
     */
    getAvailableResidents: catchAsync(async (req, res) => {
        const { search } = req.query;

        // Obtener residentes que no son miembros del comité
        const miembrosComite = await ComiteMiembro.find({ estatus: 'activo' })
            .distinct('residente_id');

        let query = { 
            _id: { $nin: miembrosComite },
            estatus: 'activo'
        };

        if (search) {
            const users = await User.find({
                $or: [
                    { nombre: { $regex: search, $options: 'i' } },
                    { apellido: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }).select('_id');
            
            query.user_id = { $in: users.map(u => u._id) };
        }

        const residentes = await Residente.find(query)
            .populate('user_id', 'nombre apellido email telefono')
            .populate('domicilio_id')
            .limit(50);

        res.json({
            success: true,
            residentes
        });
    }),

    /**
     * Obtener estadísticas del comité
     */
    getCommitteeStatistics: catchAsync(async (req, res) => {
        // Total de miembros
        const totalMiembros = await ComiteMiembro.countDocuments({ estatus: 'activo' });

        // Miembros por cargo
        const miembrosPorCargo = await ComiteMiembro.aggregate([
            { $match: { estatus: 'activo' } },
            { $group: { _id: '$cargo_id', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        // Populate nombres de cargos
        const miembrosPorCargoConNombres = await Promise.all(
            miembrosPorCargo.map(async (item) => {
                const cargo = await ComiteCargo.findById(item._id);
                return {
                    cargo: cargo ? cargo.nombre : 'Desconocido',
                    count: item.count
                };
            })
        );

        // Miembros por antigüedad (meses)
        const miembrosConAntiguedad = await ComiteMiembro.find({ estatus: 'activo' });
        const antiguedadStats = miembrosConAntiguedad.map(miembro => {
            const meses = Math.floor((new Date() - miembro.fecha_inicio) / (1000 * 60 * 60 * 24 * 30));
            return {
                id: miembro._id,
                meses: meses
            };
        });

        const promedioAntiguedad = antiguedadStats.length > 0 
            ? antiguedadStats.reduce((sum, item) => sum + item.meses, 0) / antiguedadStats.length
            : 0;

        res.json({
            success: true,
            estadisticas: {
                total_miembros: totalMiembros,
                miembros_por_cargo: miembrosPorCargoConNombres,
                antiguedad: {
                    promedio_meses: promedioAntiguedad.toFixed(1),
                    min_meses: antiguedadStats.length > 0 ? Math.min(...antiguedadStats.map(a => a.meses)) : 0,
                    max_meses: antiguedadStats.length > 0 ? Math.max(...antiguedadStats.map(a => a.meses)) : 0
                }
            }
        });
    })
};