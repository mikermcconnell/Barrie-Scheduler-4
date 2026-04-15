import React, { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { getValidationClasses, useTimeValidation } from '../hooks/useTimeValidation';

type TimeValidationApi = ReturnType<typeof useTimeValidation>;

function Harness({ onReady }: { onReady: (api: TimeValidationApi) => void }): null {
  const api = useTimeValidation();

  useLayoutEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

describe('useTimeValidation', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let api: TimeValidationApi | null = null;

  beforeEach(() => {
    vi.useRealTimers();
    api = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Harness
          onReady={(value) => {
            api = value;
          }}
        />,
      );
    });
  });

  afterEach(() => {
    vi.useRealTimers();

    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
    api = null;
  });

  it('shows an error for invalid time input and auto-hides it after 3 seconds', () => {
    vi.useFakeTimers();

    flushSync(() => {
      expect(api?.validateTime('cell-1', 'not-a-time')).toBe(false);
    });

    expect(api?.getValidationState('cell-1')).toEqual({
      isValid: false,
      errorMessage: 'Invalid time format. Use HH:MM or H:MM AM/PM',
      showError: true,
    });

    flushSync(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(api?.getValidationState('cell-1')).toEqual({
      isValid: false,
      errorMessage: 'Invalid time format. Use HH:MM or H:MM AM/PM',
      showError: false,
    });
  });

  it('treats empty values as valid and clearValidation resets an error state', () => {
    flushSync(() => {
      api?.validateTime('cell-2', 'bad');
    });

    expect(api?.getValidationState('cell-2').isValid).toBe(false);

    flushSync(() => {
      expect(api?.validateTime('cell-2', '   ')).toBe(true);
    });

    expect(api?.getValidationState('cell-2')).toEqual({
      isValid: true,
      errorMessage: null,
      showError: false,
    });

    flushSync(() => {
      api?.validateTime('cell-2', 'still bad');
      api?.clearValidation('cell-2');
    });

    expect(api?.getValidationState('cell-2')).toEqual({
      isValid: true,
      errorMessage: null,
      showError: false,
    });
  });

  it('returns the shake/error classes only when the invalid state is visible', () => {
    expect(getValidationClasses(false, true)).toContain('border-red-400');
    expect(getValidationClasses(false, true)).toContain('animate-shake');
    expect(getValidationClasses(false, false)).toBe('');
    expect(getValidationClasses(true, false)).toBe('');
  });
});
