/** Публичный API статусов, зависимостей и проверок проекта. */
export { validateProjectModel, type ProjectIssue, type ProjectValidationResult } from './projectValidator';
export {
  computeModuleStatuses,
  MODULE_STATE_LABEL,
  MODULE_STATE_COLOR,
  type ModuleStatus,
  type ModuleState,
} from './moduleStatus';
export { runProductionCheck, type ProductionCheckResult } from './productionCheck';
export { validateConnections } from './connectionCheck';
