import { ALLOWED_STATUS_TRANSITIONS, JobStatus } from '../constants/job.constants.js';
import { InvalidJobStateError } from '../errors/InvalidJobStateError.js';

export const validateStatusTransition = (
  currentStatus: JobStatus,
  targetStatus: JobStatus,
): void => {
  if (currentStatus === targetStatus) {
    return;
  }

  const allowedNextStatuses = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
  if (!allowedNextStatuses.includes(targetStatus)) {
    throw new InvalidJobStateError(
      `Invalid job status transition from '${currentStatus}' to '${targetStatus}'. Allowed transitions from '${currentStatus}': [${allowedNextStatuses.join(', ')}]`,
      { currentStatus, targetStatus, allowedNextStatuses },
    );
  }
};
