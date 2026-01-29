// src/jobs/morosidadSuspension.js
import { ResidenteMorosidad } from '../models/residenteMorosidad.model.js';
import { Residente } from '../models/residente.model.js';
import { User } from '../models/user.model.js';
import NotificationService from '../libs/notifications.js';

/**
 * Job diario para gestionar morosidad y suspensiones
 */
export const checkMorosidadSuspension = async () => {
    console.log('🔍 Iniciando verificación de morosidad...');
    
    try {
        // 1. Actualizar días de morosidad para todos los morosos
        const morosos = await ResidenteMorosidad.find({
            es_moroso: true,
            monto_adeudado: { $gt: 0 }
        }).populate('residente_id');
        
        for (const morosidad of morosos) {
            if (morosidad.fecha_primer_morosidad) {
                const ahora = new Date();
                const dias = Math.floor((ahora - morosidad.fecha_primer_morosidad) / (1000 * 60 * 60 * 24));
                morosidad.dias_morosidad = dias;
                
                // Enviar notificaciones según días
                await enviarNotificacionesSegunDias(morosidad, dias);
                
                await morosidad.save();
            }
        }
        
        // 2. Suspender residentes con más de 60 días
        await suspenderMorososMayor60Dias();
        
        console.log('✅ Verificación de morosidad completada');
    } catch (error) {
        console.error('❌ Error en job de morosidad:', error);
    }
};

/**
 * Enviar notificaciones según días de morosidad
 */
const enviarNotificacionesSegunDias = async (morosidad, dias) => {
    const residente = morosidad.residente_id;
    const hoy = new Date();
    const ultimaNotif = morosidad.ultima_notificacion;
    
    // Solo enviar una notificación por día
    if (ultimaNotif && 
        ultimaNotif.getDate() === hoy.getDate() &&
        ultimaNotif.getMonth() === hoy.getMonth() &&
        ultimaNotif.getFullYear() === hoy.getFullYear()) {
        return;
    }
    
    let titulo = '';
    let mensaje = '';
    
    if (dias === 30) {
        titulo = '⚠️ Recordatorio de morosidad';
        mensaje = 'Tienes 30 días de morosidad. Tienes 30 días más para regularizar tu situación.';
    } else if (dias === 45) {
        titulo = '⏰ Morosidad - 15 días restantes';
        mensaje = 'Solo te quedan 15 días para regularizar tu morosidad antes de suspensión.';
    } else if (dias >= 55 && dias < 60) {
        const diasRestantes = 60 - dias;
        titulo = '🚨 Morosidad crítica';
        mensaje = `Solo te quedan ${diasRestantes} días para evitar la suspensión de tu cuenta.`;
    }
    
    if (titulo && mensaje && residente && residente.user_id) {
        await NotificationService.sendNotification({
            userId: residente.user_id,
            tipo: 'push',
            titulo,
            mensaje,
            data: { 
                tipo: 'morosidad', 
                action: 'morosidad_recordatorio',
                dias_morosidad: dias.toString(),
                monto_adeudado: morosidad.monto_adeudado.toString() 
            }
        });
        
        morosidad.notificaciones_enviadas += 1;
        morosidad.ultima_notificacion = hoy;
    }
};

/**
 * Suspender residentes con más de 60 días de morosidad
 */
const suspenderMorososMayor60Dias = async () => {
    const sesentaDiasAtras = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    
    const morososParaSuspender = await ResidenteMorosidad.find({
        es_moroso: true,
        fecha_primer_morosidad: { $lte: sesentaDiasAtras },
        suspendido_por_morosidad: false,
        monto_adeudado: { $gt: 0 }
    }).populate('residente_id');
    
    console.log(`📊 Residentes a suspender por morosidad: ${morososParaSuspender.length}`);
    
    for (const morosidad of morososParaSuspender) {
        try {
            const residente = morosidad.residente_id;
            
            // Suspender residente
            residente.estatus = 'suspendido';
            await residente.save();
            
            // Actualizar morosidad
            morosidad.suspendido_por_morosidad = true;
            morosidad.fecha_suspension = new Date();
            morosidad.motivo_suspension = 'Morosidad automática (>60 días)';
            await morosidad.save();
            
            // Suspender usuario asociado
            await User.findByIdAndUpdate(residente.user_id._id, {
                estatus: 'suspendido'
            });
            
            // Notificar al residente
            await NotificationService.sendNotification({
                userId: residente.user_id._id,
                tipo: 'push',
                titulo: '⛔ Cuenta suspendida por morosidad',
                mensaje: 'Tu acceso ha sido suspendido automáticamente por morosidad de más de 60 días.',
                data: { 
                    tipo: 'morosidad', 
                    action: 'suspended_auto',
                    motivo: 'Morosidad automática (>60 días)',
                    fecha_suspension: new Date().toISOString(), 
                    monto_adeudado: morosidad.monto_adeudado.toString()
                }
            });
            
            console.log(`✅ Residente suspendido: ${residente._id}`);
            
        } catch (error) {
            console.error(`Error suspendiendo residente ${morosidad.residente_id}:`, error);
        }
    }
};

/**
 * Iniciar el job diario
 */
export const iniciarJobMorosidad = () => {
    // Ejecutar al inicio
    checkMorosidadSuspension();
    
    // Programar ejecución diaria a las 2:00 AM
    const ahora = new Date();
    const horaEjecucion = new Date(ahora);
    horaEjecucion.setHours(2, 0, 0, 0);
    
    if (ahora > horaEjecucion) {
        horaEjecucion.setDate(horaEjecucion.getDate() + 1);
    }
    
    const tiempoHastaEjecucion = horaEjecucion - ahora;
    
    setTimeout(() => {
        checkMorosidadSuspension();
        // Programar cada 24 horas
        setInterval(checkMorosidadSuspension, 24 * 60 * 60 * 1000);
    }, tiempoHastaEjecucion);
    
    console.log(`⏰ Job de morosidad programado para ejecutar diariamente a las 2:00 AM`);
};