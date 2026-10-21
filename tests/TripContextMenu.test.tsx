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
  it('shows the headway spacing action only when a target is set', () => {
    const onAction = vi.fn();
    const render = (alignHeadwayMinutes?: number) => flushSync(() => {
      root?.render(
        <TripContextMenu
          x={10}
          y={10}
          tripId="trip-1"
          tripDirection="North"
          blockId="2-3"
          stops={['A', 'B']}
          rowTripIds={['trip-1', 'trip-2']}
          quickAddActionsOnly
          alignHeadwayMinutes={alignHeadwayMinutes}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );
    });
    const findButton = () => Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('after previous trip')
    ) as HTMLButtonElement | undefined;

    render(undefined);
    expect(findButton()).toBeUndefined();

    render(30);
    const button = findButton();
    expect(button?.textContent).toContain('Space 30 min after previous trip');
    flushSync(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alignHeadway', tripId: 'trip-1', tripIds: ['trip-1', 'trip-2'] })
    );
  });
});
