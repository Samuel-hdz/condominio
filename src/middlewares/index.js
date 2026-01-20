// Auth middlewares
export { authenticate, requireRole, requirePrincipalResident, requireSelfOrAdmin, blockSuspendedResidents } from './auth.js';

// Permission middlewares
export { 
    requirePermission, 
    requireAdminPanelAccess, 
    requireCasetaAccess,
    requireFullAdmin,
    requireResidentMobileAccess 
} from './permissions.js';

// Error handling middlewares
export { 
    AppError, 
    notFound, 
    errorHandler, 
    catchAsync, 
    validateObjectId 
} from './errorHandler.js';

// Validation middlewares
export {
    validateCreateUser,
    validateCreateResident,
    validateVisitAuthorization,
    validateCreateCharge,
    validatePaymentReceipt,
    validatePublication,
    validateFileUpload,
    validateCreateSurcharge
} from './validation.js';

// Audit middlewares
export {
    auditAction,
    auditSensitiveAccess,
    auditAdminActions,
    auditFinancialActions,
    auditSecurityActions
} from './audit.js';