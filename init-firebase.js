// init-firebase.js
import NotificationService from './src/libs/notifications.js';

// Inicializar Firebase al iniciar la aplicación
async function initializeFirebase() {
    console.log('Inicializando Firebase al inicio del servidor...');
    const notificationService = new NotificationService();
    const initialized = await notificationService.initFCM();
    
    if (initialized) {
        console.log('irebase inicializado exitosamente al inicio');
    } else {
        console.error('Falló la inicialización de Firebase al inicio');
    }
    
    return initialized;
}

export default initializeFirebase;