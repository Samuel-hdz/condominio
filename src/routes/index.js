import { Router } from 'express';
import authRoutes from './auth.routes.js';
import usersRoutes from './users.routes.js';
import residentsRoutes from './residents.routes.js';
import visitsRoutes from './visits.routes.js';
import packagesRoutes from './packages.routes.js';
import communicationsRoutes from './communications.routes.js';
import financesRoutes from './finances.routes.js';
import adminRoutes from './admin.routes.js';
import committeeRoutes from './committee.routes.js';
import systemRoutes from './system.routes.js';
import { notFound } from '../middlewares/errorHandler.js';
import eventsRoutes from './events.routes.js'; // 👈 NUEVO
import gatehouseRoutes from './gatehouse.routes.js'
import deviceRoutes from './device.routes.js'

const router = Router();

// Definir rutas principales
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/residents', residentsRoutes);
router.use('/visits', visitsRoutes);
router.use('/gatehouse', gatehouseRoutes)
router.use('/packages', packagesRoutes);
router.use('/communications', communicationsRoutes);
router.use('/finances', financesRoutes);
router.use('/admin', adminRoutes);
router.use('/committee', committeeRoutes);
router.use('/system', systemRoutes);
router.use('/events', eventsRoutes);
router.use('/device', deviceRoutes)

// Ruta 404 para API no encontrada
router.use(/.*/, notFound);

export default router;