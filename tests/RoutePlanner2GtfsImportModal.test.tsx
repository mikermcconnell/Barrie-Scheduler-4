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

function findPatternButton(container: HTMLElement, route: string, headsign: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => {
    const label = button.getAttribute('aria-label') ?? '';
    return label.includes(`Route ${route}`) && label.includes(headsign);
  }) ?? null;
}

function patternFor(overrides: Partial<RoutePlanner2GtfsImportPattern>): RoutePlanner2GtfsImportPattern {
  return { ...pattern, ...overrides };
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
    expect(view.textContent).toContain('Weekday');
    expect(view.textContent).toContain('42 stops');
    expect(importButton?.disabled).toBe(true);

    flushSync(() => click(findPatternButton(view, '8A', 'To Terminal B')));
    expect(importButton?.disabled).toBe(false);

    flushSync(() => click(importButton));
    expect(props.onImport).toHaveBeenCalledWith([pattern]);
    expect(importButton?.disabled).toBe(true);
  });

  it('imports all patterns for one day type from the bulk import buttons', () => {
    const props = {
      patterns: [
        patternFor({ id: 'saturday-8a', routeShortName: '8A', routeId: '8A', dayTypeLabel: 'Saturday', serviceId: 'saturday', tripHeadsign: 'Saturday 8A' }),
        patternFor({ id: 'weekday-8b', routeShortName: '8B', routeId: '8B', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'Weekday 8B' }),
        patternFor({ id: 'weekday-8a', routeShortName: '8A', routeId: '8A', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'Weekday 8A' }),
      ],
      onImport: vi.fn(),
    };
    const { view } = renderModal(props);

    expect(view.textContent).toContain('Import a full schedule');
    expect(findButton(view, 'Import all weekday')?.disabled).toBe(false);
    expect(findButton(view, 'Import all Saturday')?.disabled).toBe(false);
    expect(findButton(view, 'Import all Sunday')?.disabled).toBe(true);

    flushSync(() => click(findButton(view, 'Import all weekday')));

    const imported = props.onImport.mock.calls[0]?.[0] as RoutePlanner2GtfsImportPattern[];
    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(imported).toHaveLength(2);
    expect(imported.map((selected) => selected.id).sort()).toEqual(['weekday-8a', 'weekday-8b']);
  });

  it('clears selected patterns when the drawer closes and reopens', () => {
    const { view, props } = renderModal();
    const importButton = findButton(view, 'Import as editable route');

    flushSync(() => click(findPatternButton(view, '8A', 'To Terminal B')));
    expect(importButton?.disabled).toBe(false);

    flushSync(() => click(findButton(view, 'Cancel')));
    flushSync(() => {
      root?.render(<RoutePlanner2GtfsImportModal {...props} open />);
    });

    expect(props.onClose).toHaveBeenCalled();
    expect(findButton(view, 'Import as editable route')?.disabled).toBe(true);
  });

  it('calls close and retry actions', () => {
    const { view, props } = renderModal({ error: 'Network unavailable', patterns: [] });

    expect(view.textContent).toContain('Network unavailable');
    flushSync(() => click(findButton(view, 'Retry')));
    expect(props.onRetry).toHaveBeenCalled();

    flushSync(() => click(findButton(view, 'Cancel')));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('groups patterns by day type and sorts route headings smallest to largest', () => {
    const { view } = renderModal({
      patterns: [
        patternFor({ id: 'saturday-10', routeShortName: '10', routeId: '10', dayTypeLabel: 'Saturday', serviceId: 'saturday', tripHeadsign: 'Saturday 10' }),
        patternFor({ id: 'weekday-2a', routeShortName: '2A', routeId: '2A', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'Weekday 2A', routeFamily: { key: 'barrie-merged-2', name: 'Route 2', shortName: '2', memberShortName: '2A', directionRole: 'out', directionLabel: 'Out' } }),
        patternFor({ id: 'sunday-2b', routeShortName: '2B', routeId: '2B', dayTypeLabel: 'Sunday', serviceId: 'sunday', tripHeadsign: 'Sunday 2B' }),
        patternFor({ id: 'weekday-10', routeShortName: '10', routeId: '10', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'Weekday 10' }),
        patternFor({ id: 'weekday-2b', routeShortName: '2B', routeId: '2B', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'Weekday 2B', routeFamily: { key: 'barrie-merged-2', name: 'Route 2', shortName: '2', memberShortName: '2B', directionRole: 'back', directionLabel: 'Back' } }),
      ],
    });

    const dayHeadings = Array.from(view.querySelectorAll('h3')).map((heading) => heading.textContent);
    expect(dayHeadings).toEqual(['Weekday', 'Saturday', 'Sunday']);
    const text = view.textContent ?? '';
    expect(text.indexOf('Route 2')).toBeLessThan(text.indexOf('Route 10'));
    expect(text).toContain('2 directions');
    expect(text).toContain('Out · 2A');
    expect(text).toContain('Back · 2B');
  });

  it('selects a route family from the visible route heading', () => {
    const props = {
      patterns: [
        patternFor({ id: 'weekday-2a', routeShortName: '2A', routeId: '2A', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'To Downtown', routeFamily: { key: 'barrie-merged-2', name: 'Route 2', shortName: '2', memberShortName: '2A', directionRole: 'out', directionLabel: 'Out' } }),
        patternFor({ id: 'weekday-2b', routeShortName: '2B', routeId: '2B', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'To Park Place', routeFamily: { key: 'barrie-merged-2', name: 'Route 2', shortName: '2', memberShortName: '2B', directionRole: 'back', directionLabel: 'Back' } }),
        patternFor({ id: 'weekday-8a', routeShortName: '8A', routeId: '8A', dayTypeLabel: 'Weekday', serviceId: 'weekday', tripHeadsign: 'To Park Place' }),
      ],
      onImport: vi.fn(),
    };
    const { view } = renderModal(props);

    flushSync(() => {
      click(findButton(view, 'Route 2'));
    });

    expect(view.textContent).toContain('2 routes selected');

    flushSync(() => click(findButton(view, 'Import 2 editable routes')));

    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(props.onImport.mock.calls[0]?.[0]).toHaveLength(2);
    expect(props.onImport.mock.calls[0]?.[0].map((selected: RoutePlanner2GtfsImportPattern) => selected.routeShortName)).toEqual(['2A', '2B']);
  });
});
