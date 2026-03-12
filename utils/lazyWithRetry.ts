import { lazy } from 'react';

const CHUNK_RETRY_PREFIX = 'lazy-retry:';
const DYNAMIC_IMPORT_FAILURE_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface RetryOptions {
  reload?: () => void;
  storage?: StorageLike;
}

export function isDynamicImportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return DYNAMIC_IMPORT_FAILURE_PATTERN.test(error.message);
}

export async function loadWithRetry<T>(
  loader: () => Promise<T>,
  cacheKey: string,
  options: RetryOptions = {}
): Promise<T> {
  const storage =
    options.storage ??
    (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const reload =
    options.reload ??
    (typeof window !== 'undefined' ? () => window.location.reload() : undefined);
  const retryKey = `${CHUNK_RETRY_PREFIX}${cacheKey}`;

  try {
    const module = await loader();
    storage?.removeItem(retryKey);
    return module;
  } catch (error) {
    const alreadyRetried = storage?.getItem(retryKey) === 'true';

    if (storage && reload && isDynamicImportFailure(error) && !alreadyRetried) {
      storage.setItem(retryKey, 'true');
      reload();

      // Keep Suspense pending while the page reloads.
      return new Promise<T>(() => undefined);
    }

    storage?.removeItem(retryKey);
    throw error;
  }
}

export function lazyWithRetry<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  cacheKey: string
) {
  return lazy(() => loadWithRetry(loader, cacheKey));
}
