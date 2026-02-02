import cron from 'node-cron';
import { Publicacion } from '../models/publicacion.model.js';
import { communicationsController } from '../controllers/communications.controller.js';

class PublicacionesProgramadasJob {
    /**
     * Configurar el job para ejecutarse cada 5 minutos
     */
    static setup() {
        // Ejecutar cada 5 minutos
        cron.schedule('*/5 * * * *', async () => {
            console.log('🔄 [Publicaciones] Verificando publicaciones programadas...');
            await this.verificarYEnviarPublicaciones();
        });

        console.log('✅ Job de publicaciones programadas configurado (cada 5 minutos)');
    }

    /**
     * Verificar y enviar publicaciones que ya llegaron a su fecha programada
     */
    static async verificarYEnviarPublicaciones() {
        try {
            const ahora = new Date();

            // Buscar publicaciones programadas que ya deberían enviarse
            const publicacionesPendientes = await Publicacion.find({
                programado: true,
                notificaciones_enviadas: false,
                fecha_programada: { $lte: ahora }  // Fecha programada <= ahora
            });

            if (publicacionesPendientes.length === 0) {
                console.log('ℹ️  [Publicaciones] No hay publicaciones programadas pendientes de envío');
                return;
            }

            console.log(`📤 [Publicaciones] Encontradas ${publicacionesPendientes.length} publicaciones para enviar`);

            // Enviar cada publicación
            for (const publicacion of publicacionesPendientes) {
                try {
                    console.log(`📧 [Publicaciones] Enviando: "${publicacion.titulo}"`);
                    
                    // Enviar notificaciones
                    const residentesNotificados = await communicationsController.sendPublicationNotifications(
                        publicacion._id
                    );

                    console.log(`✅ [Publicaciones] "${publicacion.titulo}" enviada a ${residentesNotificados} residentes`);

                } catch (error) {
                    console.error(`❌ [Publicaciones] Error enviando publicación ${publicacion._id}:`, error.message);
                }
            }

        } catch (error) {
            console.error('❌ [Publicaciones] Error en job de publicaciones programadas:', error);
        }
    }

    /**
     * Forzar envío de publicaciones programadas (para testing)
     */
    static async forzarEnvio(req, res) {
        try {
            console.log('🔧 [Publicaciones] Forzando envío de publicaciones programadas...');
            await PublicacionesProgramadasJob.verificarYEnviarPublicaciones();

            const publicacionesPendientes = await Publicacion.countDocuments({
                programado: true,
                notificaciones_enviadas: false
            });

            res.json({
                success: true,
                message: 'Verificación de publicaciones programadas ejecutada',
                publicaciones_pendientes: publicacionesPendientes
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error forzando envío de publicaciones',
                error: error.message
            });
        }
    }

    /**
     * Obtener estado de publicaciones programadas
     */
    static async obtenerEstado(req, res) {
        try {
            const ahora = new Date();

            const publicacionesProgramadas = await Publicacion.find({
                programado: true
            }).select('titulo fecha_programada notificaciones_enviadas createdAt')
              .sort({ fecha_programada: 1 });

            const porEnviar = publicacionesProgramadas.filter(p => !p.notificaciones_enviadas);
            const enviadas = publicacionesProgramadas.filter(p => p.notificaciones_enviadas);
            const vencidas = porEnviar.filter(p => p.fecha_programada <= ahora);

            res.json({
                success: true,
                data: {
                    resumen: {
                        total: publicacionesProgramadas.length,
                        por_enviar: porEnviar.length,
                        enviadas: enviadas.length,
                        vencidas_sin_enviar: vencidas.length
                    },
                    publicaciones: {
                        por_enviar: porEnviar.map(p => ({
                            id: p._id,
                            titulo: p.titulo,
                            fecha_programada: p.fecha_programada,
                            creada_en: p.createdAt,
                            esta_vencida: p.fecha_programada <= ahora,
                            tiempo_para_envio: p.fecha_programada > ahora 
                                ? `En ${Math.ceil((p.fecha_programada - ahora) / (1000 * 60))} minutos`
                                : 'Vencida - pendiente de envío'
                        })),
                        enviadas: enviadas.map(p => ({
                            id: p._id,
                            titulo: p.titulo,
                            fecha_programada: p.fecha_programada,
                            creada_en: p.createdAt
                        }))
                    }
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error obteniendo estado de publicaciones',
                error: error.message
            });
        }
    }
}

export default PublicacionesProgramadasJob;