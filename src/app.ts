import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware.js';
import { correlationIdMiddleware } from './middleware/correlationId.middleware.js';
import { metricsMiddleware } from './middleware/metrics.middleware.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { appRouter } from './routes/index.js';
import { swaggerServe, swaggerSetup } from './docs/swagger.js';

const app: Express = express();

// Correlation ID & Security Middlewares
app.use(correlationIdMiddleware);
app.use(metricsMiddleware);
app.use(helmet());
app.use(cors());

// Request Parsing Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging Middleware
app.use(requestLoggerMiddleware);

// OpenAPI Swagger UI Documentation
app.use('/docs', swaggerServe, swaggerSetup);

// API Routes
app.use('/', appRouter);

// 404 Not Found Middleware
app.use(notFoundMiddleware);

// Global Error Middleware
app.use(errorMiddleware);

export default app;
