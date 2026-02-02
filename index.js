import app from './app.js';
import { connectDB } from './db.js';
import RecurrentChargesJob from './src/jobs/recurrentCharges.js';
import SurchargesJob from './src/jobs/surcharges.js';
import { iniciarJobMorosidad } from './src/jobs/morosidadSuspension.js';
import PublicacionesProgramadasJob from './src/jobs/publicacionesProgramadas.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

// Conectar a MongoDB
connectDB().then(() => {
    // Iniciar jobs programados
    RecurrentChargesJob.setup();
    SurchargesJob.setup();
    iniciarJobMorosidad();
    PublicacionesProgramadasJob.setup();
    
    // Iniciar servidor
    app.listen(PORT, () => {
        console.log(`Servidor corriendo en puerto ${PORT}`);
        console.log(`Jobs programados iniciados:`);
        console.log(`• Cargos recurrentes: diario`);
        console.log(`• Recargos automáticos: diario`);
        console.log(`• Morosidad: verificación diaria`);
        console.log(`• Publicaciones programadas: cada 5 minutos`);
    });
}).catch(err => {
    console.error('Error iniciando aplicación:', err);
    process.exit(1);
});