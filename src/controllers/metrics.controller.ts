import { Request, Response, NextFunction } from 'express';
import { prometheusRegistry } from '../observability/prometheus.js';

export class MetricsController {
  public getMetrics = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const metricsText = await prometheusRegistry.getMetricsText();
      res.setHeader('Content-Type', prometheusRegistry.getContentType());
      res.status(200).send(metricsText);
    } catch (err) {
      next(err);
    }
  };
}

export const metricsController = new MetricsController();
