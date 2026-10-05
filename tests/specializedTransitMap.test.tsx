// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpecializedTransitMap, type SpecializedTransitMapPoint } from '../components/Performance/SpecializedTransitMap';

const spies = vi.hoisted(() => ({ flyTo: vi.fn(), resize: vi.fn() }));
vi.mock('../components/shared/MapBase', () => ({
  MapBase: ({ mapRef, children, onMouseLeave }: any) => {
    mapRef.current = spies;
    return <div data-testid="map" onMouseOut={onMouseLeave}>{children}</div>;
  },
}));
vi.mock('../components/shared/HeatmapDotLayer', () => ({ HeatmapDotLayer: (): null => null }));
vi.mock('react-map-gl/mapbox', () => ({ Popup: ({ children }: any) => <div data-testid="popup">{children}</div> }));

const point = (index: number): SpecializedTransitMapPoint => ({
  location: { id: `place-${index}`, displayName: `Place ${index}`, normalizedName: `place ${index}`, aliases: [], latitude: 44.4, longitude: -79.7, status: 'automatic', coordinateSource: 'known-place', relevance: 1 },
  pickups: index, dropoffs: 20 - index,
});

let container: HTMLDivElement;
let root: Root;
async function render(points: SpecializedTransitMapPoint[]) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SpecializedTransitMap points={points} />));
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent === label || element.getAttribute('aria-label') === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
  spies.flyTo.mockClear();
});

describe('SpecializedTransitMap', () => {
  it('ranks the top ten by selected metric and includes unresolved locations in All', async () => {
    const points = Array.from({ length: 12 }, (_, index) => point(index));
    points[0].location.latitude = null;
    await render(points);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10);
    await click('pickups');
    expect(container.querySelector('tbody tr')?.textContent).toContain('Place 11');
    await click('dropoffs');
    expect(container.querySelector('tbody tr')?.textContent).toContain('Place 0');
    await click('All locations');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
    expect(container.textContent).toContain('Location unavailable');
    expect(container.querySelector('[aria-label="Show Place 0 on map"]')).toBeNull();
  });

  it('flies to a table location and retains its popup after leaving the map', async () => {
    await render([point(1)]);
    await click('Show Place 1 on map');
    expect(spies.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-79.7, 44.4], zoom: 15 }));
    await act(async () => container.querySelector('[data-testid="map"]')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(container.querySelector('[data-testid="popup"]')?.textContent).toContain('Place 1');
    expect(container.querySelector('[data-testid="popup"]')?.textContent).toContain('Activity: 20');
  });

  it('tracks fullscreen changes including a browser Escape exit', async () => {
    await render([point(1)]);
    const section = container.querySelector('section')!;
    Object.defineProperty(section, 'requestFullscreen', { configurable: true, value: vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: section });
      document.dispatchEvent(new Event('fullscreenchange'));
    }) });
    await click('Full screen');
    expect(container.textContent).toContain('Exit full screen');
    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(container.textContent).not.toContain('Exit full screen');
  });
});
