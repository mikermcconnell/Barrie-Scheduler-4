export const DEFAULT_OPTIMIZE_TIMEOUT_MS = 300000;
export const DEFAULT_OPTIMIZE_MAX_RETRIES = 0;

export function parseOptimizeTimeoutMs(rawValue?: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OPTIMIZE_TIMEOUT_MS;
  }
  return parsed;
}

export function parseOptimizeMaxRetries(rawValue?: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_OPTIMIZE_MAX_RETRIES;
  }
  return Math.max(0, Math.floor(parsed));
}

export function isRetryableOptimizeFailure(status?: number, code?: string): boolean {
  if (
    code === 'SERVER_CONFIG'
    || code === 'AUTH_REQUIRED'
    || code === 'INVALID_REQUEST'
    || code === 'CLIENT_TIMEOUT'
  ) {
    return false;
  }

  if (!status) {
    return true;
  }

  if (status === 404 || status === 408 || status === 429) {
    return true;
  }

  if (status >= 500) {
    return true;
  }

  return code === 'TIMEOUT' || code === 'UPSTREAM';
}
