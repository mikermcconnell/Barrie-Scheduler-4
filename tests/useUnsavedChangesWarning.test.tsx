import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';

function Harness({ shouldWarn }: { shouldWarn: boolean }): null {
  useUnsavedChangesWarning(shouldWarn, 'Unsaved Fleet Plan changes');
  return null;
}

describe('useUnsavedChangesWarning', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  const renderHarness = (shouldWarn: boolean) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(<Harness shouldWarn={shouldWarn} />);
    });
  };

  it('blocks browser unload when there are unsaved changes', () => {
    renderHarness(true);

    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);

    expect(allowed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not block browser unload when there are no unsaved changes', () => {
    renderHarness(false);

    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);

    expect(allowed).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('removes the unload warning when changes are saved', () => {
    renderHarness(true);

    flushSync(() => {
      root?.render(<Harness shouldWarn={false} />);
    });

    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);

    expect(allowed).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });
});
