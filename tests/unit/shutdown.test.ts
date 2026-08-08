import { gracefulShutdown } from '../../src/runtime/shutdown.js';

describe('Graceful Shutdown Coordinator', () => {
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  it('should execute graceful shutdown without throwing', async () => {
    await gracefulShutdown('API');
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
