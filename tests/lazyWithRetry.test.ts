import { describe, expect, it, vi } from 'vitest';
import { isDynamicImportFailure, loadWithRetry } from '../utils/lazyWithRetry';

describe('lazyWithRetry helpers', () => {
  it('detects stale chunk loading errors', () => {
    expect(
      isDynamicImportFailure(
        new Error(
          'Failed to fetch dynamically imported module: https://transitscheduler.ca/assets/FixedRouteWorkspace-B3lkzZ-X.js'
        )
      )
    ).toBe(true);

    expect(isDynamicImportFailure(new Error('Some other application error'))).toBe(false);
  });

  it('reloads once for a stale chunk error and stores the retry flag', async () => {
    const storage = createStorage();
    const reload = vi.fn();

    const result = loadWithRetry(
      () =>
        Promise.reject(
          new Error(
            'Failed to fetch dynamically imported module: https://transitscheduler.ca/assets/FixedRouteWorkspace-B3lkzZ-X.js'
          )
        ),
      'fixed-workspace',
      { reload, storage }
    );

    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem('lazy-retry:fixed-workspace')).toBe('true');

    // Prevent an intentionally pending promise from affecting the test process.
    void result;
  });

  it('throws after the retry has already been used', async () => {
    const storage = createStorage();
    storage.setItem('lazy-retry:fixed-workspace', 'true');

    await expect(
      loadWithRetry(
        () =>
          Promise.reject(
            new Error(
              'Failed to fetch dynamically imported module: https://transitscheduler.ca/assets/FixedRouteWorkspace-B3lkzZ-X.js'
            )
          ),
        'fixed-workspace',
        { reload: vi.fn(), storage }
      )
    ).rejects.toThrow('Failed to fetch dynamically imported module');

    expect(storage.getItem('lazy-retry:fixed-workspace')).toBeNull();
  });

  it('clears the retry flag after a successful load', async () => {
    const storage = createStorage();
    storage.setItem('lazy-retry:fixed-workspace', 'true');

    const result = await loadWithRetry(
      async () => ({ default: 'ok' }),
      'fixed-workspace',
      { reload: vi.fn(), storage }
    );

    expect(result).toEqual({ default: 'ok' });
    expect(storage.getItem('lazy-retry:fixed-workspace')).toBeNull();
  });
});

function createStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}
