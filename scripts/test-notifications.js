// scripts/test-notifications.js
import NotificationService from '../src/libs/notifications.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function testNotifications() {
    console.log('🧪 Probando sistema de notificaciones...\n');
    
    try {
        // Conectar a MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        
        // 1. Testear Firebase
        console.log('1. Probando Firebase...');
        const notificationService = new NotificationService();
        const firebaseInitialized = await notificationService.initFCM();
        
        if (!firebaseInitialized) {
            console.log('Firebase no se pudo inicializar');
            console.log('   Error:', notificationService.fcmError);
            return;
        }
        
        // 2. Crear una notificación de prueba en BD
        console.log('2. Creando notificación de prueba en BD...');
        const testUserId = '65a1b2c3d4e5f6a7b8c9d0e1';
        const testNotification = await NotificationService.sendNotification({
            userId: testUserId,
            tipo: 'in_app',
            titulo: 'Test de Notificación',
            mensaje: 'Esta es una notificación de prueba guardada en BD',
            data: { test: true, timestamp: new Date().toISOString() }
        });
        
        // 3. Testear consulta de notificaciones
        console.log('\n3. Probando consulta de notificaciones...');
        const notifications = await NotificationService.getUserNotifications(testUserId, {
            limit: 5,
            page: 1
        });
        
        console.log(`Total notificaciones para usuario: ${notifications.total}`);
        console.log(`Páginas: ${notifications.totalPages}`);
        
        // 4. Testear push (si hay token de prueba)
        if (process.env.TEST_FCM_TOKEN) {
            console.log('\n4. Probando notificación push...');
            try {
                const pushResult = await NotificationService.sendTestNotification(
                    process.env.TEST_FCM_TOKEN,
                    testUserId
                );
                console.log('Push de prueba enviado:', pushResult.messageId);
            } catch (pushError) {
                console.log('Push falló:', pushError.message);
                console.log('Esto es normal si el token no es válido');
            }
        } else {
            console.log('\nPara probar push, agrega TEST_FCM_TOKEN en .env');
        }
        
    } catch (error) {
        console.error('Error en pruebas:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

testNotifications();