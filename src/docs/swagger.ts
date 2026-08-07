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
  paths: {
    '/health': {
      get: {
        summary: 'System Health Check',
        description:
          'Returns enriched live health metrics for the Flux application, PostgreSQL database, Redis instance, and applied migration version.',
        tags: ['Health'],
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
        },
      },
      get: {
        summary: 'List Background Jobs',
        description:
          'Retrieves a paginated list of background jobs with optional multi-field filtering and sorting.',
        tags: ['Jobs'],
        parameters: [
          {
            in: 'query',
            name: 'page',
            schema: { type: 'integer', default: 1 },
            description: 'Page number (minimum 1)',
          },
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', default: 20, maximum: 100 },
            description: 'Number of items per page (maximum 100)',
          },
          {
            in: 'query',
            name: 'status',
            schema: { $ref: '#/components/schemas/JobStatus' },
            description: 'Filter by job execution status',
          },
          {
            in: 'query',
            name: 'priority',
            schema: { $ref: '#/components/schemas/JobPriority' },
            description: 'Filter by job priority',
          },
          {
            in: 'query',
            name: 'queue',
            schema: { type: 'string' },
            description: 'Filter by queue name',
          },
          {
            in: 'query',
            name: 'workerId',
            schema: { type: 'string' },
            description: 'Filter by assigned worker process ID',
          },
          {
            in: 'query',
            name: 'sortBy',
            schema: {
              type: 'string',
              enum: ['createdAt', 'priority', 'status', 'scheduledFor'],
              default: 'createdAt',
            },
            description: 'Sort field',
          },
          {
            in: 'query',
            name: 'sortOrder',
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            description: 'Sort direction',
          },
        ],
        responses: {
          '200': {
            description: 'Paginated job listing',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ListJobsResponseWrapper' },
              },
            },
          },
          '400': {
            description: 'Invalid query filter or sort parameter',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/jobs/{id}': {
      get: {
        summary: 'Retrieve Job Details',
        description: 'Retrieves complete state details for a specific background job by UUID.',
        tags: ['Jobs'],
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Unique job UUID',
          },
        ],
        responses: {
          '200': {
            description: 'Job details retrieved successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobResponseWrapper' },
              },
            },
          },
          '404': {
            description: 'Job not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      delete: {
        summary: 'Soft Delete Job',
        description:
          'Soft-deletes a job from Flux storage. Jobs in RUNNING or QUEUED state must be cancelled prior to deletion.',
        tags: ['Jobs'],
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Unique job UUID',
          },
        ],
        responses: {
          '200': {
            description: 'Job soft-deleted successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DeleteJobResponseWrapper' },
              },
            },
          },
          '400': {
            description: 'Invalid state for deletion (e.g. attempting to delete RUNNING job)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Job not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/jobs/{id}/cancel': {
      patch: {
        summary: 'Cancel Job',
        description:
          'Cancels a pending, queued, or running background job with an optional cancellation reason.',
        tags: ['Jobs'],
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Unique job UUID',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', example: 'User requested task cancellation' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Job cancelled successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobResponseWrapper' },
              },
            },
          },
          '400': {
            description:
              'Illegal status transition (e.g. attempting to cancel an already completed job)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Job not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/schedules': {
      get: {
        summary: 'List Recurring Schedules',
        description: 'Retrieves a paginated list of recurring schedules with optional filters.',
        tags: ['Schedules'],
        responses: {
          '200': { description: 'Schedules retrieved successfully' },
        },
      },
      post: {
        summary: 'Create Recurring Schedule',
        description: 'Creates a new cron-based recurring schedule.',
        tags: ['Schedules'],
        responses: {
          '201': { description: 'Schedule created successfully' },
        },
      },
    },
    '/api/v1/schedules/{id}': {
      get: {
        summary: 'Get Schedule Details',
        tags: ['Schedules'],
        responses: {
          '200': { description: 'Schedule details' },
        },
      },
      patch: {
        summary: 'Update Schedule',
        tags: ['Schedules'],
        responses: {
          '200': { description: 'Schedule updated' },
        },
      },
      delete: {
        summary: 'Delete Schedule',
        tags: ['Schedules'],
        responses: {
          '200': { description: 'Schedule deleted' },
        },
      },
    },
    '/api/v1/schedules/{id}/run': {
      post: {
        summary: 'Trigger Schedule Now',
        tags: ['Schedules'],
        responses: {
          '200': { description: 'Schedule triggered manually' },
        },
      },
    },
  },
  components: {
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
          idempotencyKey: { type: 'string', nullable: true },
          workerId: { type: 'string', nullable: true },
          payload: { type: 'object' },
          metadata: { type: 'object' },
          status: { $ref: '#/components/schemas/JobStatus' },
          priority: { $ref: '#/components/schemas/JobPriority' },
          retryCount: { type: 'integer' },
          maxRetries: { type: 'integer' },
          retryDelay: { type: 'integer' },
          nextRetryAt: { type: 'string', format: 'date-time', nullable: true },
          scheduledFor: { type: 'string', format: 'date-time', nullable: true },
          delayUntil: { type: 'string', format: 'date-time', nullable: true },
          attempts: { type: 'integer' },
          version: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          lockedAt: { type: 'string', format: 'date-time', nullable: true },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          failedAt: { type: 'string', format: 'date-time', nullable: true },
          executionTimeMs: { type: 'integer', nullable: true },
          errorMessage: { type: 'string', nullable: true },
          errorStack: { type: 'string', nullable: true },
          failureReason: { type: 'string', nullable: true },
          isDeleted: { type: 'boolean' },
          deletedAt: { type: 'string', format: 'date-time', nullable: true },
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
      ListJobsResponseWrapper: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/JobDTO' },
              },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'integer', example: 1 },
                  limit: { type: 'integer', example: 20 },
                  total: { type: 'integer', example: 42 },
                  totalPages: { type: 'integer', example: 3 },
                  hasNext: { type: 'boolean', example: true },
                  hasPrevious: { type: 'boolean', example: false },
                },
              },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      DeleteJobResponseWrapper: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              deleted: { type: 'boolean', example: true },
              deletedAt: { type: 'string', format: 'date-time' },
            },
          },
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
              code: { type: 'string', example: 'JOB_NOT_FOUND' },
              message: { type: 'string', example: "Job with ID '...' was not found" },
              details: { type: 'object', nullable: true },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
          path: { type: 'string', example: '/api/v1/jobs/123' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'UP' },
          service: { type: 'string', example: 'Flux' },
          version: { type: 'string', example: '1.0.0' },
          uptime: { type: 'number', example: 142.5 },
          timestamp: { type: 'string', format: 'date-time' },
          components: {
            type: 'object',
            properties: {
              database: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'UP' },
                  latencyMs: { type: 'integer', example: 2 },
                },
              },
              redis: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'UP' },
                  latencyMs: { type: 'integer', example: 1 },
                },
              },
              migrations: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'UP' },
                  appliedCount: { type: 'integer', example: 2 },
                  latest: { type: 'string', example: '002_add_soft_delete_to_jobs.sql' },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const swaggerServe = swaggerUi.serve;
export const swaggerSetup = swaggerUi.setup(openApiSpec);
