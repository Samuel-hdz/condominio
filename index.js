import app from './app.js';
import { connectDB } from './db.js';
import RecurrentChargesJob from './src/jobs/recurrentCharges.js';
import SurchargesJob from './src/jobs/surcharges.js';
import { iniciarJobMorosidad } from './src/jobs/morosidadSuspension.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

// Conectar a MongoDB
connectDB().then(() => {
    // Iniciar jobs programados
    RecurrentChargesJob.setup();
    SurchargesJob.setup();
    iniciarJobMorosidad();
    
    // Iniciar servidor
    app.listen(PORT, () => {
        console.log(`Servidor corriendo en puerto ${PORT}`);
        console.log(`Jobs programados iniciados:`);
        //console.log(`• Cargos recurrentes: 00:05 diario`);
        //console.log(`• Recargos automáticos: 02:00 diario`);
    });
}).catch(err => {
    console.error('Error iniciando aplicación:', err);
    process.exit(1);
});