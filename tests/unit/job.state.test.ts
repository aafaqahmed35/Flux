import { JobStatus } from '../../src/constants/job.constants.js';
import { validateStatusTransition } from '../../src/domain/job.state.js';
import { InvalidJobStateError } from '../../src/errors/InvalidJobStateError.js';

describe('Job State Machine (validateStatusTransition)', () => {
  it('should allow valid status transitions', () => {
    expect(() => validateStatusTransition(JobStatus.PENDING, JobStatus.QUEUED)).not.toThrow();
    expect(() => validateStatusTransition(JobStatus.PENDING, JobStatus.DELAYED)).not.toThrow();
    expect(() => validateStatusTransition(JobStatus.PENDING, JobStatus.CANCELLED)).not.toThrow();

    expect(() => validateStatusTransition(JobStatus.QUEUED, JobStatus.RUNNING)).not.toThrow();
    expect(() => validateStatusTransition(JobStatus.QUEUED, JobStatus.CANCELLED)).not.toThrow();

    expect(() => validateStatusTransition(JobStatus.RUNNING, JobStatus.COMPLETED)).not.toThrow();
    expect(() => validateStatusTransition(JobStatus.RUNNING, JobStatus.FAILED)).not.toThrow();
    expect(() => validateStatusTransition(JobStatus.RUNNING, JobStatus.RETRYING)).not.toThrow();

    expect(() => validateStatusTransition(JobStatus.RETRYING, JobStatus.QUEUED)).not.toThrow();
    expect(() => validateStatusTransition(JobStatus.FAILED, JobStatus.QUEUED)).not.toThrow();
  });

  it('should allow transition to self (no-op)', () => {
    expect(() => validateStatusTransition(JobStatus.RUNNING, JobStatus.RUNNING)).not.toThrow();
  });

  it('should reject invalid status transitions', () => {
    expect(() => validateStatusTransition(JobStatus.COMPLETED, JobStatus.RUNNING)).toThrow(
      InvalidJobStateError,
    );
    expect(() => validateStatusTransition(JobStatus.PENDING, JobStatus.RUNNING)).toThrow(
      InvalidJobStateError,
    );
    expect(() => validateStatusTransition(JobStatus.PENDING, JobStatus.COMPLETED)).toThrow(
      InvalidJobStateError,
    );
    expect(() => validateStatusTransition(JobStatus.QUEUED, JobStatus.COMPLETED)).toThrow(
      InvalidJobStateError,
    );
  });
});
