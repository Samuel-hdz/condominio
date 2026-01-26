import { Domicilio } from '../models/domicilio.model.js';
import { Residente } from '../models/residente.model.js';

/**
 * Servicio para manejar el estatus de domicilios
 */
class DomicilioStatusService {
    
    /**
     * Actualizar estatus de domicilio basado en residentes activos
     * @param {String} domicilioId - ID del domicilio
     * @returns {Promise<Object>} Resultado de la actualización
     */
    static async updateDomicilioStatus(domicilioId) {
        try {
            // Contar residentes activos en el domicilio
            const residentesActivosCount = await Residente.countDocuments({
                domicilio_id: domicilioId,
                estatus: 'activo'
            });
            
            const domicilio = await Domicilio.findById(domicilioId);
            if (!domicilio) {
                throw new Error('Domicilio no encontrado');
            }
            
            const estatusAnterior = domicilio.estatus;
            let nuevoEstatus = 'inactivo';
            let cambios = {};
            
            // Determinar nuevo estatus basado en residentes activos
            if (residentesActivosCount > 0) {
                nuevoEstatus = 'activo';
                if (estatusAnterior !== 'activo') {
                    cambios.fecha_activacion = new Date();
                    cambios.motivo_estatus = `Activado automáticamente por asignación de ${residentesActivosCount} residente(s) activo(s)`;
                }
            } else {
                nuevoEstatus = 'inactivo';
                if (estatusAnterior !== 'inactivo') {
                    cambios.fecha_inactivacion = new Date();
                    cambios.motivo_estatus = 'Inactivado automáticamente por falta de residentes activos';
                }
            }
            
            // Solo actualizar si hay cambio
            if (estatusAnterior !== nuevoEstatus) {
                domicilio.estatus = nuevoEstatus;
                Object.assign(domicilio, cambios);
                await domicilio.save();
                
                console.log(`🏠 Domicilio ${domicilioId} cambió de ${estatusAnterior} a ${nuevoEstatus}`);
                
                return {
                    success: true,
                    domicilio_id: domicilioId,
                    estatus_anterior: estatusAnterior,
                    estatus_nuevo: nuevoEstatus,
                    residentes_activos: residentesActivosCount,
                    cambios
                };
            }
            
            return {
                success: true,
                domicilio_id: domicilioId,
                estatus_actual: estatusAnterior,
                residentes_activos: residentesActivosCount,
                mensaje: 'Sin cambios necesarios'
            };
            
        } catch (error) {
            console.error('❌ Error actualizando estatus de domicilio:', error);
            throw error;
        }
    }
    
    /**
     * Verificar y corregir estatus de todos los domicilios
     * @returns {Promise<Object>} Reporte de correcciones
     */
    static async verifyAllDomiciliosStatus() {
        try {
            console.log('🔍 Verificando estatus de todos los domicilios...');
            
            const domicilios = await Domicilio.find();
            const resultados = [];
            let corregidos = 0;
            
            for (const domicilio of domicilios) {
                const resultado = await this.updateDomicilioStatus(domicilio._id);
                if (resultado.estatus_anterior && resultado.estatus_anterior !== resultado.estatus_nuevo) {
                    corregidos++;
                }
                resultados.push(resultado);
            }
            
            console.log(`✅ Verificación completada: ${corregidos} domicilios corregidos de ${domicilios.length}`);
            
            return {
                success: true,
                total_domicilios: domicilios.length,
                corregidos,
                resultados
            };
            
        } catch (error) {
            console.error('❌ Error verificando domicilios:', error);
            throw error;
        }
    }
    
    /**
     * Obtener estadísticas de domicilios por estatus
     * @returns {Promise<Object>} Estadísticas
     */
    static async getDomiciliosStats() {
        try {
            const stats = await Domicilio.aggregate([
                {
                    $group: {
                        _id: '$estatus',
                        count: { $sum: 1 },
                        total: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        estatus: '$_id',
                        count: 1,
                        porcentaje: {
                            $multiply: [
                                { $divide: ['$count', { $sum: '$total' }] },
                                100
                            ]
                        }
                    }
                }
            ]);
            
            const totalDomicilios = await Domicilio.countDocuments();
            const domiciliosConResidentes = await Domicilio.aggregate([
                {
                    $lookup: {
                        from: 'residentes',
                        localField: '_id',
                        foreignField: 'domicilio_id',
                        as: 'residentes'
                    }
                },
                {
                    $match: {
                        'residentes.estatus': 'activo'
                    }
                },
                {
                    $count: 'total'
                }
            ]);
            
            const ocupados = domiciliosConResidentes[0]?.total || 0;
            const vacios = totalDomicilios - ocupados;
            
            return {
                success: true,
                total_domicilios: totalDomicilios,
                por_estatus: stats,
                ocupacion: {
                    ocupados,
                    vacios,
                    porcentaje_ocupacion: (ocupados / totalDomicilios * 100).toFixed(2)
                }
            };
            
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas:', error);
            throw error;
        }
    }
}

export default DomicilioStatusService;