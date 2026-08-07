export interface ExecutionResult {
  success: boolean;
  durationMs: number;
  result?: unknown;
  error?: Error;
}
