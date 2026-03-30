import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useGridNavigation, type GridNavigationCallbacks } from '../hooks/useGridNavigation';

const columns = [
  { stopName: 'Stop 1', cellType: 'dep' as const, direction: 'North' as const },
  { stopName: 'Stop 2', cellType: 'arr' as const, direction: 'North' as const },
  { stopName: 'Stop 3', cellType: 'dep' as const, direction: 'South' as const },
];

const rows = [
  { northTripId: 'north-1', southTripId: 'south-1', populatedCols: [true, true, false] },
  { northTripId: 'north-2', southTripId: 'south-2', populatedCols: [true, false, true] },
];

function GridHarness({ callbacks }: { callbacks: GridNavigationCallbacks }) {
  const grid = useGridNavigation({
    columns,
    rows,
    callbacks,
  });

  return (
    <div>
      <button data-testid="focus-first" onClick={() => grid.focusFirstCell()}>
        Focus first
      </button>
      <button data-testid="activate-first" onClick={() => grid.navigateTo(0, 0)}>
        Activate first
      </button>
      <div data-testid="active-cell">
        {grid.activeCell ? `${grid.activeCell.rowIndex}:${grid.activeCell.colIndex}` : 'none'}
      </div>
      <div data-testid="editing-state">{grid.isEditing ? 'editing' : 'idle'}</div>
      <div
        data-testid="grid-container"
        ref={grid.containerRef}
        tabIndex={0}
        onKeyDown={grid.handleKeyDown}
      />
    </div>
  );
}

describe('useGridNavigation', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const onStartEdit = vi.fn();
  const onCopy = vi.fn(() => '7:00 AM');
  const onPaste = vi.fn();

  beforeEach(() => {
    onStartEdit.mockReset();
    onCopy.mockClear();
    onPaste.mockClear();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('8:15 AM'),
      },
    });
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  const renderHarness = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <GridHarness
          callbacks={{
            onStartEdit,
            onCopy,
            onPaste,
          }}
        />
      );
    });
  };

  it('can jump to the first and last populated cells with grid boundary commands', () => {
    renderHarness();

    const focusFirstButton = container?.querySelector('[data-testid="focus-first"]');
    const gridContainer = container?.querySelector('[data-testid="grid-container"]');
    const activeCell = () => container?.querySelector('[data-testid="active-cell"]')?.textContent;

    flushSync(() => {
      focusFirstButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(activeCell()).toBe('0:0');

    flushSync(() => {
      gridContainer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true }));
    });
    expect(activeCell()).toBe('1:2');

    flushSync(() => {
      gridContainer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true }));
    });
    expect(activeCell()).toBe('0:0');
  });

  it('supports Command copy and paste shortcuts plus F2 editing', async () => {
    renderHarness();

    const activateFirstButton = container?.querySelector('[data-testid="activate-first"]');
    const gridContainer = container?.querySelector('[data-testid="grid-container"]');
    const editingState = () => container?.querySelector('[data-testid="editing-state"]')?.textContent;

    flushSync(() => {
      activateFirstButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    flushSync(() => {
      gridContainer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }));
    });

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('7:00 AM');

    flushSync(() => {
      gridContainer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true }));
    });

    await Promise.resolve();

    expect(onPaste).toHaveBeenCalledWith(
      expect.objectContaining({ rowIndex: 0, colIndex: 0, tripId: 'north-1' }),
      '8:15 AM'
    );

    flushSync(() => {
      gridContainer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    });

    expect(editingState()).toBe('editing');
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });
});
