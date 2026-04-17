import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TripContextMenu } from '../components/NewSchedule/TripContextMenu';

describe('TripContextMenu', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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

  it('shows Edit Trip in the quick add menu and dispatches the edit action', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    flushSync(() => {
      root?.render(
        <TripContextMenu
          x={10}
          y={10}
          tripId="trip-1"
          tripDirection="North"
          blockId="10-1"
          stops={['A', 'B']}
          quickAddActionsOnly
          onAction={onAction}
          onClose={onClose}
        />
      );
    });

    const editButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('Edit Trip')
    ) as HTMLButtonElement | undefined;

    expect(editButton).toBeTruthy();

    flushSync(() => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'editTrip',
        tripId: 'trip-1'
      })
    );
  });
});
