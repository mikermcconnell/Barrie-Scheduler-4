import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoutePlanner2GtfsImportModal } from '../components/Analytics/route-planner-2/RoutePlanner2GtfsImportModal';
import type { RoutePlanner2GtfsImportPattern } from '../utils/route-planner-2/routePlanner2GtfsImport';

const pattern: RoutePlanner2GtfsImportPattern = {
  id: 'pattern-8a',
  routeId: '8A',
  routeShortName: '8A',
  routeLongName: 'RVH/Yonge',
  routeColor: '00AEEF',
  serviceId: 'weekday',
  dayTypeLabel: 'Weekday',
  directionId: 0,
  tripHeadsign: 'To Terminal B',
  shapeId: 'shape-8a',
  tripCount: 12,
  stopCount: 42,
  shapePointCount: 600,
  stops: [],
  shapePoints: [],
};

function click(element: Element | null | undefined) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) ?? null;
}

describe('RoutePlanner2GtfsImportModal', () => {
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

  function renderModal(props: Partial<React.ComponentProps<typeof RoutePlanner2GtfsImportModal>> = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const mergedProps: React.ComponentProps<typeof RoutePlanner2GtfsImportModal> = {
      open: true,
      patterns: [pattern],
      loading: false,
      error: null,
      onClose: vi.fn(),
      onImport: vi.fn(),
      onRetry: vi.fn(),
      ...props,
    };

    flushSync(() => {
      root?.render(<RoutePlanner2GtfsImportModal {...mergedProps} />);
    });

    return { view: container, props: mergedProps };
  }

  it('renders loading state', () => {
    const { view } = renderModal({ loading: true, patterns: [] });
    expect(view.textContent).toContain('Import GTFS route');
    expect(view.textContent).toContain('Loading GTFS routes');
    expect(view.textContent).toContain('This creates an editable planning copy. It does not modify GTFS.');
  });

  it('renders route pattern options and imports the selected pattern', () => {
    const { view, props } = renderModal();
    const importButton = findButton(view, 'Import as editable route');

    expect(view.textContent).toContain('Route 8A');
    expect(view.textContent).toContain('To Terminal B');
    expect(view.textContent).toContain('42 stops');
    expect(importButton?.disabled).toBe(true);

    flushSync(() => click(findButton(view, 'Route 8A')));
    expect(importButton?.disabled).toBe(false);

    flushSync(() => click(importButton));
    expect(props.onImport).toHaveBeenCalledWith([pattern]);
  });

  it('calls close and retry actions', () => {
    const { view, props } = renderModal({ error: 'Network unavailable', patterns: [] });

    expect(view.textContent).toContain('Network unavailable');
    flushSync(() => click(findButton(view, 'Retry')));
    expect(props.onRetry).toHaveBeenCalled();

    flushSync(() => click(findButton(view, 'Cancel')));
    expect(props.onClose).toHaveBeenCalled();
  });
});
