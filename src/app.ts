import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware.js';
import { correlationIdMiddleware } from './middleware/correlationId.middleware.js';
import { metricsMiddleware } from './middleware/metrics.middleware.js';
import { securityHeadersMiddleware } from './security/security.middleware.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { appRouter } from './routes/index.js';
import { swaggerServe, swaggerSetup } from './docs/swagger.js';

const app: Express = express();

// Correlation ID, Metrics & Security Middlewares
app.use(correlationIdMiddleware);
app.use(metricsMiddleware);
app.use(securityHeadersMiddleware);
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable restrictive default CSP for self-contained UI dashboard
  }),
);
app.use(cors());

// Request Parsing Middlewares with payload size limit (1MB max)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request Logging Middleware
app.use(requestLoggerMiddleware);

// Serve Operational Dashboard static UI
const publicDir = path.join(process.cwd(), 'public');
app.use('/dashboard', express.static(publicDir));

// OpenAPI Swagger UI Documentation
app.use('/docs', swaggerServe, swaggerSetup);

// API Routes
app.use('/', appRouter);

// 404 Not Found Middleware
app.use(notFoundMiddleware);

// Global Error Middleware
app.use(errorMiddleware);

export default app;
