import { Response, NextFunction } from 'express';
import { requireRole, requireScope } from '../../src/auth/authorize.middleware.js';
import { AuthenticatedRequest } from '../../src/auth/auth.types.js';
import { ForbiddenError, InsufficientScopeError } from '../../src/auth/auth.errors.js';

describe('Authorization Middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {};
    mockRes = {};
    mockNext = jest.fn();
  });

  describe('requireRole', () => {
    it('should pass if user role matches allowed roles', () => {
      mockReq.authContext = {
        userId: 'u1',
        email: 'u1@flux.com',
        role: 'ADMIN',
        scopes: ['admin:*'],
        authType: 'JWT',
      };

      const middleware = requireRole('ADMIN', 'OPERATOR');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext as NextFunction);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass error to next if role does not match', () => {
      mockReq.authContext = {
        userId: 'u1',
        email: 'u1@flux.com',
        role: 'VIEWER',
        scopes: ['jobs:read'],
        authType: 'JWT',
      };

      const middleware = requireRole('ADMIN', 'OPERATOR');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext as NextFunction);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });
  });

  describe('requireScope', () => {
    it('should pass if user has specific required scope', () => {
      mockReq.authContext = {
        userId: 'u1',
        email: 'u1@flux.com',
        role: 'OPERATOR',
        scopes: ['jobs:write', 'jobs:read'],
        authType: 'JWT',
      };

      const middleware = requireScope('jobs:write');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext as NextFunction);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass if user has admin wildcard scope admin:*', () => {
      mockReq.authContext = {
        userId: 'u1',
        email: 'u1@flux.com',
        role: 'ADMIN',
        scopes: ['admin:*'],
        authType: 'JWT',
      };

      const middleware = requireScope('jobs:write');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext as NextFunction);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fail with InsufficientScopeError if scope is missing', () => {
      mockReq.authContext = {
        userId: 'u1',
        email: 'u1@flux.com',
        role: 'VIEWER',
        scopes: ['jobs:read'],
        authType: 'JWT',
      };

      const middleware = requireScope('jobs:write');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext as NextFunction);

      expect(mockNext).toHaveBeenCalledWith(expect.any(InsufficientScopeError));
    });
  });
});
