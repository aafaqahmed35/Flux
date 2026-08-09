import { Request, Response } from 'express';
import { HTTP_STATUS } from '../constants/statusCodes.js';
import { RecoveryEngine } from '../recovery/recovery.engine.js';
import { recoveryRuntime } from '../recovery/recovery.runtime.js';
import { QueueReconciler } from '../recovery/reconciler.js';
import { jobRepository } from '../repositories/job.repository.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export class RecoveryController {
  private readonly recoveryEngine: RecoveryEngine;
  private readonly reconciler: QueueReconciler;

  constructor(
    recoveryEngine: RecoveryEngine = new RecoveryEngine(),
    reconciler: QueueReconciler = new QueueReconciler(),
  ) {
    this.recoveryEngine = recoveryEngine;
    this.reconciler = reconciler;
  }

  getStatus = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const status = recoveryRuntime.getMetrics();
    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: status,
    });
    await Promise.resolve();
  });

  runRecovery = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const recoveryResult = await this.recoveryEngine.runRecovery();
    const reconResult = await this.reconciler.runReconciliation();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Manual recovery and reconciliation scan completed successfully',
      data: {
        recovery: recoveryResult,
        reconciliation: reconResult,
      },
    });
  });

  getStaleJobs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const leaseTimeoutMs = req.query.leaseTimeoutMs
      ? parseInt(req.query.leaseTimeoutMs as string, 10)
      : 30000;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    const [staleRunning, staleClaimed, stalePending] = await Promise.all([
      jobRepository.findStaleRunningJobs(leaseTimeoutMs, limit),
      jobRepository.findClaimedJobs(leaseTimeoutMs, limit),
      jobRepository.findRecoverablePendingJobs(leaseTimeoutMs, limit),
    ]);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        staleRunningCount: staleRunning.length,
        staleClaimedCount: staleClaimed.length,
        stalePendingCount: stalePending.length,
        staleRunning,
        staleClaimed,
        stalePending,
      },
    });
  });
}

export const recoveryController = new RecoveryController();
