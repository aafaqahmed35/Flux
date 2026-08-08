import { Response, NextFunction } from 'express';
import {
  AuthenticationRequiredError,
  ForbiddenError,
  InsufficientScopeError,
} from './auth.errors.js';
import { ApiKeyScope, AuthenticatedRequest, UserRole } from './auth.types.js';
import { prometheusRegistry } from '../observability/prometheus.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.authContext) {
      next(new AuthenticationRequiredError());
      return;
    }

    if (!allowedRoles.includes(req.authContext.role)) {
      prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_FAILED_TOTAL, 1, {
        failure_type: 'FORBIDDEN',
      });
      next(
        new ForbiddenError(
          `Role '${req.authContext.role}' is not authorized to access this resource`,
        ),
      );
      return;
    }

    next();
  };
};

export const requireScope = (requiredScope: ApiKeyScope) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.authContext) {
      next(new AuthenticationRequiredError());
      return;
    }

    const userScopes = req.authContext.scopes || [];
    const hasAdmin = userScopes.includes('admin:*');
    const hasScope = userScopes.includes(requiredScope);

    if (!hasAdmin && !hasScope) {
      prometheusRegistry.incrementCounter(METRIC_NAMES.JOBS_FAILED_TOTAL, 1, {
        failure_type: 'INSUFFICIENT_SCOPE',
      });
      next(new InsufficientScopeError(requiredScope));
      return;
    }

    next();
  };
};
