// jobs/notificationCleanup.js
import { DispositivoUsuario } from '../models/dispositivoUsuario.model.js';
import { EntregaNotificacion } from '../models/entregaNotificacion.model.js';
import { Notificacion } from '../models/notificacion.model.js';
import cron from 'node-cron';

/**
 * Job para limpieza de notificaciones antiguas y dispositivos inactivos
 */
class NotificationCleanupJob {
    static setup() {
        // Ejecutar diariamente a las 3:00 AM
        cron.schedule('0 3 * * *', async () => {
            try {
                console.log('🧹 Iniciando limpieza de notificaciones...');
                await this.cleanupOldNotifications();
                await this.cleanupInactiveDevices();
                console.log('✅ Limpieza de notificaciones completada');
            } catch (error) {
                console.error('❌ Error en limpieza de notificaciones:', error);
            }
        });

        console.log('⏰ Job de limpieza de notificaciones configurado');
    }

    /**
     * Limpiar notificaciones antiguas
     */
    static async cleanupOldNotifications() {
        const daysToKeep = process.env.NOTIFICATION_RETENTION_DAYS || 90;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        // Eliminar notificaciones leídas antiguas
        const result = await Notificacion.deleteMany({
            leida: true,
            created_at: { $lt: cutoffDate }
        });

        console.log(`🗑️ Eliminadas ${result.deletedCount} notificaciones leídas antiguas`);
    }

    /**
     * Limpiar dispositivos inactivos
     */
    static async cleanupInactiveDevices() {
        const daysInactive = 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

        // Desactivar dispositivos sin actividad
        const result = await DispositivoUsuario.updateMany(
            {
                activo: true,
                ultima_actividad: { $lt: cutoffDate }
            },
            {
                activo: false,
                token_fcm: null
            }
        );

        console.log(`📱 Desactivados ${result.modifiedCount} dispositivos inactivos`);
    }
}

export default NotificationCleanupJob;