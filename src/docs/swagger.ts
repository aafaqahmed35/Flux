import swaggerUi from 'swagger-ui-express';
import { serverConfig } from '../config/server.js';

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Flux Background Job Processing API',
    version: serverConfig.appVersion,
    description:
      'Production-style enterprise background job processing platform built with Node.js, Express, TypeScript, PostgreSQL, and Redis.',
    contact: {
      name: 'Flux Engineering',
    },
  },
  servers: [
    {
      url: `http://localhost:${serverConfig.port}`,
      description: 'Local Development Server',
    },
  ],
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  paths: {
    '/health': {
      get: {
        summary: 'System Health Check',
        description:
          'Returns enriched live health metrics for the Flux application, PostgreSQL database, Redis instance, applied migrations, and security settings.',
        tags: ['Health'],
        security: [],
        responses: {
          '200': {
            description: 'System is fully operational (UP)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
          '503': {
            description: 'System component is degraded or down',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        summary: 'User Login',
        description: 'Authenticates user credentials and returns a JWT access token.',
        tags: ['Authentication'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'operator@flux.internal' },
                  password: { type: 'string', example: 'Password123!' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful' },
          '401': { description: 'Invalid credentials' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/v1/jobs': {
      post: {
        summary: 'Create a Background Job',
        description:
          'Creates and persists a new background job with optional idempotency key, priority, schedule, and payload.',
        tags: ['Jobs'],
        parameters: [
          {
            in: 'header',
            name: 'Idempotency-Key',
            required: false,
            schema: { type: 'string' },
            description: 'Optional unique key to ensure idempotent job creation per queue.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateJobRequest' },
              example: {
                name: 'send-welcome-email',
                queueName: 'emails',
                payload: { userId: 'usr_100', email: 'user@example.com' },
                metadata: { correlationId: 'corr_001' },
                priority: 'HIGH',
                maxRetries: 3,
                retryDelay: 1000,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Job created successfully',
            headers: {
              Location: {
                schema: { type: 'string' },
                description: 'URI of the newly created job resource',
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobResponseWrapper' },
              },
            },
          },
          '200': {
            description:
              'Idempotent request matched an existing job (duplicate creation suppressed)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobResponseWrapper' },
              },
            },
          },
          '400': {
            description: 'Validation failure or invalid payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' },
          '429': { description: 'Too Many Requests' },
        },
      },
      get: {
        summary: 'List Background Jobs',
        tags: ['Jobs'],
        responses: {
          '200': { description: 'Paginated job listing' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT access token',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Enter prefixed API Key (e.g. flux_live_...)',
      },
    },
    schemas: {
      JobStatus: {
        type: 'string',
        enum: [
          'PENDING',
          'QUEUED',
          'RUNNING',
          'COMPLETED',
          'FAILED',
          'RETRYING',
          'CANCELLED',
          'DELAYED',
        ],
      },
      JobPriority: {
        type: 'string',
        enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'],
      },
      CreateJobRequest: {
        type: 'object',
        required: ['name', 'queueName'],
        properties: {
          name: { type: 'string', example: 'send-welcome-email' },
          queueName: { type: 'string', example: 'emails' },
          payload: { type: 'object', example: { userId: 'usr_100' } },
          metadata: { type: 'object', example: { correlationId: 'corr_001' } },
          priority: { $ref: '#/components/schemas/JobPriority' },
          maxRetries: { type: 'integer', default: 3, minimum: 0 },
          retryDelay: { type: 'integer', default: 1000, minimum: 0 },
          scheduledFor: { type: 'string', format: 'date-time', nullable: true },
          delayUntil: { type: 'string', format: 'date-time', nullable: true },
          idempotencyKey: { type: 'string', nullable: true },
        },
      },
      JobDTO: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          queueName: { type: 'string' },
          status: { $ref: '#/components/schemas/JobStatus' },
        },
      },
      JobResponseWrapper: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/JobDTO' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'AUTHENTICATION_REQUIRED' },
              message: { type: 'string', example: 'Authentication credentials are required' },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'UP' },
          service: { type: 'string', example: 'Flux' },
          version: { type: 'string', example: '1.0.0' },
        },
      },
    },
  },
};

export const swaggerServe = swaggerUi.serve;
export const swaggerSetup = swaggerUi.setup(openApiSpec);
