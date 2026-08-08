import { validateEnvConfig } from '../../src/config/config.schema.js';

describe('Config Schema Validation', () => {
  it('should validate valid environment configuration', () => {
    const input = {
      NODE_ENV: 'development',
      PORT: '3000',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '15433',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '16379',
      WORKER_CONCURRENCY: '5',
    };

    const config = validateEnvConfig(input);
    expect(config.PORT).toBe(3000);
    expect(config.POSTGRES_PORT).toBe(15433);
    expect(config.WORKER_CONCURRENCY).toBe(5);
  });

  it('should throw error on invalid port or concurrency', () => {
    const input = {
      PORT: 'invalid-port',
    };

    expect(() => validateEnvConfig(input)).toThrow(/Invalid environment configuration/);
  });
});
