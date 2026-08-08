import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AUTH_DEFAULTS, ROLE_SCOPES_MAP } from './auth.constants.js';
import { InvalidCredentialsError, TokenExpiredError } from './auth.errors.js';
import { authRepository, AuthRepository } from './auth.repository.js';
import { ApiKeyScope, AuthContext, User, UserRole } from './auth.types.js';
import { appLogger } from '../logger/logger.js';

export class AuthService {
  private readonly repository: AuthRepository;

  constructor(repository: AuthRepository = authRepository) {
    this.repository = repository;
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, AUTH_DEFAULTS.bcryptSaltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async createUser(email: string, password: string, role: UserRole = 'OPERATOR'): Promise<User> {
    const existing = await this.repository.findUserByEmail(email);
    if (existing) {
      throw new Error(`User with email '${email}' already exists`);
    }
    const passwordHash = await this.hashPassword(password);
    return this.repository.createUser({ email, passwordHash, role });
  }

  async authenticateUser(
    email: string,
    password: string,
  ): Promise<{ user: User; accessToken: string }> {
    const user = await this.repository.findUserByEmail(email);
    if (!user || !user.enabled) {
      throw new InvalidCredentialsError();
    }

    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    await this.repository.updateLastLogin(user.id);
    const accessToken = this.generateAccessToken(user);

    appLogger.info('User authenticated successfully', {
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return { user, accessToken };
  }

  generateAccessToken(user: User): string {
    const scopes = ROLE_SCOPES_MAP[user.role] || [];
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      scopes,
    };
    const options: jwt.SignOptions = {
      expiresIn: AUTH_DEFAULTS.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    };
    return jwt.sign(payload, AUTH_DEFAULTS.jwtSecret, options);
  }

  verifyAccessToken(token: string): AuthContext {
    try {
      const decoded = jwt.verify(token, AUTH_DEFAULTS.jwtSecret) as {
        sub: string;
        email: string;
        role: UserRole;
        scopes: ApiKeyScope[];
      };
      return {
        userId: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        scopes: decoded.scopes,
        authType: 'JWT',
      };
    } catch (err: unknown) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError();
      }
      throw new InvalidCredentialsError('Invalid access token');
    }
  }
}

export const authService = new AuthService();
