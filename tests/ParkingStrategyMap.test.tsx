import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mapMethods = vi.hoisted(() => ({ fitBounds: vi.fn(), easeTo: vi.fn(), resize: vi.fn(), project: vi.fn(() => ({ x: 400, y: 200 })), getMap: () => ({ getCanvas: () => ({ clientWidth: 900, clientHeight: 440 }), on: vi.fn(), off: vi.fn() }) }));
vi.mock('../components/shared/MapBase', () => ({ MapBase: ({ children, mapRef, onLoad }: {
  children: React.ReactNode;
  mapRef: React.MutableRefObject<unknown>;
  onLoad: () => void;
}) => {
  React.useEffect(() => {
    mapRef.current = mapMethods;
    onLoad();
    return () => { mapRef.current = null; };
  }, []);
  return <div>{children}</div>;
} }));
vi.mock('react-map-gl/mapbox', () => ({ Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import { ParkingStrategyMap } from '../components/Parking/ParkingStrategyMap';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('ParkingStrategyMap', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['label', 'dot', 'list', 'clear'])('deselects through %s without moving the map, with bubbles enabled by default', async (control) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onSelect = vi.fn();
    const point = { id: 'a', name: 'Marina', latitude: 44.38, longitude: -79.69, recordCount: 100, reportedAmount: 500 };
    function Harness() {
      const [selected, setSelected] = React.useState<string | undefined>('a');
      return <ParkingStrategyMap points={[point]} selectedId={selected} onSelect={id => { onSelect(id); setSelected(id); }} />;
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
      mapMethods.easeTo.mockClear();
      mapMethods.fitBounds.mockClear();
      if (control === 'list') {
        await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.startsWith('Browse lots'))!.click());
      }
      const target = control === 'label' ? container.querySelector<HTMLButtonElement>('[data-parking-label="a"]')
        : control === 'dot' ? container.querySelector<HTMLButtonElement>('[aria-label="Deselect Marina"]')
        : control === 'list' ? container.querySelector<HTMLButtonElement>('[aria-label="Mapped parking lots"] button[aria-pressed="true"]')
        : Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Clear selection');
      await act(async () => target!.click());
      expect(onSelect).toHaveBeenCalledWith(undefined);
      expect(container.querySelector('[data-parking-label="a"]')?.getAttribute('aria-pressed')).toBe('false');
      expect(container.textContent).toContain('Select a mapped lot');
      expect(mapMethods.easeTo).not.toHaveBeenCalled();
      expect(mapMethods.fitBounds).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
  it('fits initially but preserves the viewport through metric, count, ordering and selected-detail changes', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const points = [
      { id: 'a', name: 'Lot A', latitude: 44.38, longitude: -79.69, recordCount: 100, reportedAmount: 5 },
      { id: 'b', name: 'Lot B', latitude: 44.39, longitude: -79.68, recordCount: 10, reportedAmount: 500 },
    ];
    const onSelect = vi.fn();
    try {
      await act(async () => root.render(<ParkingStrategyMap points={points} onSelect={onSelect} />));
      expect(mapMethods.fitBounds).toHaveBeenCalledOnce();
      expect(mapMethods.fitBounds).toHaveBeenCalledWith([[-79.69, 44.38], [-79.68, 44.39]], expect.objectContaining({ maxZoom: 15 }));
      expect(mapMethods.easeTo).not.toHaveBeenCalled();
      mapMethods.fitBounds.mockClear();
      const reordered = [...points].reverse().map(point => ({ ...point, recordCount: point.recordCount + 5, reportedAmount: point.reportedAmount + 10 }));
      await act(async () => root.render(<ParkingStrategyMap points={reordered} metric="totalReportedAmount" selectedId="a" onSelect={onSelect} />));
      expect(mapMethods.fitBounds).not.toHaveBeenCalled();
      expect(mapMethods.easeTo).not.toHaveBeenCalled();
      await act(async () => root.render(<ParkingStrategyMap points={reordered} metric="totalReportedAmount" selectedId="a" focusId="b" onSelect={onSelect} />));
      expect(mapMethods.fitBounds).not.toHaveBeenCalled();
      expect(mapMethods.easeTo).toHaveBeenCalledExactlyOnceWith({ center: [-79.68, 44.39], zoom: 15, duration: 300 });
      const showAll = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Show all lots')!;
      await act(async () => showAll.click());
      expect(mapMethods.fitBounds).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
  });
  it('keeps metric controls, period, coverage and selected payment evidence inside the fullscreen surface', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onMetricChange = vi.fn();
    try {
      await act(async () => root.render(<ParkingStrategyMap points={[]} onSelect={vi.fn()} onMetricChange={onMetricChange}
        periodLabel="January to October 2025" coverageLabel="30 of 40 records mapped"
        selection={{ name: 'Marina', recordCount: 30, reportedAmount: 125, mapped: false }} />));
      const surface = container.firstElementChild!;
      expect(surface.textContent).toContain('January to October 2025');
      expect(surface.textContent).toContain('30 of 40 records mapped');
      expect(surface.textContent).toContain('Marina');
      expect(surface.textContent).toContain('30 records');
      expect(surface.textContent).toContain('$125.00');
      expect(surface.textContent).toContain('Not mapped:');
      const controls = surface.querySelector('[aria-label="Map measure"]')!;
      const records = Array.from(controls.querySelectorAll('button')).find(button => button.textContent === 'Records')!;
      const amount = Array.from(controls.querySelectorAll('button')).find(button => button.textContent === 'Amount')!;
      expect(records.getAttribute('aria-pressed')).toBe('true');
      expect(amount.getAttribute('aria-pressed')).toBe('false');
      await act(async () => amount.click());
      expect(onMetricChange).toHaveBeenCalledWith('totalReportedAmount');
      await act(async () => records.click());
      expect(onMetricChange).toHaveBeenLastCalledWith('rowCount');
    } finally { await act(async () => root.unmount()); }
  });
  it('offers an editor review action on an empty map and explains missing coordinates to read-only viewers', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onReviewLinks = vi.fn();
    try {
      await act(async () => root.render(<ParkingStrategyMap points={[]} onSelect={vi.fn()} canEdit onReviewLinks={onReviewLinks} />));
      expect(container.textContent).toContain('No locations mapped yet');
      expect(container.textContent).toContain('Unlinked records remain in the evidence totals.');
      const review = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Review location links')!;
      await act(async () => review.click());
      expect(onReviewLinks).toHaveBeenCalledOnce();
      expect(mapMethods.fitBounds).not.toHaveBeenCalled();
      await act(async () => root.render(<ParkingStrategyMap points={[]} onSelect={vi.fn()} canEdit={false} onReviewLinks={onReviewLinks} missingCoordinateCount={2} />));
      expect(container.textContent).toContain('2 linked locations need valid coordinates in Parking settings.');
      expect(container.textContent).toContain('Ask a Parking editor to review location links and coordinates.');
      expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Review location links')).toBe(false);
    } finally { await act(async () => root.unmount()); }
  });
  it('switches named label values and accessible labels with the metric', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const points = [
      { id: 'a', name: 'Lot A', latitude: 44.38, longitude: -79.69, recordCount: 100, reportedAmount: 5 },
      { id: 'b', name: 'Lot B', latitude: 44.39, longitude: -79.68, recordCount: 10, reportedAmount: 500 },
      { id: 'zero', name: 'Zero', latitude: 44.4, longitude: -79.67, recordCount: 1, reportedAmount: 0 },
    ];
    const onSelect = vi.fn();
    await act(async () => root.render(<ParkingStrategyMap points={points} metric="rowCount" onSelect={onSelect} selectedId="a" />));
    expect(container.querySelector('[data-parking-label="a"]')?.textContent).toBe('Lot A100');
    await act(async () => root.render(<ParkingStrategyMap points={points} metric="totalReportedAmount" onSelect={onSelect} selectedId="a" />));
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]');
    expect(buttons[0].textContent).toBe('Lot A$5.00');
    expect(buttons[1].textContent).toBe('Lot B$500.00');
    expect(buttons[2].textContent).toBe('Zero$0.00');
    expect(buttons[0].getAttribute('aria-label')).toContain('source-reported amount');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    await act(async () => buttons[1].click());
    expect(onSelect).toHaveBeenCalledWith('b');
    await act(async () => root.unmount());
  });
  it('keeps distinct lots separate even at the same coordinates and selects their actual ids', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onSelect = vi.fn();
    const base = { latitude: 44.38, longitude: -79.69, recordCount: 123, reportedAmount: 400 };
    await act(async () => root.render(<ParkingStrategyMap selectedId="a" onSelect={onSelect} points={[
      { ...base, id: 'a', name: '<img src=x>' },
      { ...base, id: 'b', name: 'Other lot' },
      { ...base, id: 'invalid', name: 'Invalid coordinates', latitude: NaN },
    ]} />));
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('img')).toBeNull();
    await act(async () => buttons[1].click());
    expect(onSelect).toHaveBeenCalledWith('b');
    await act(async () => root.unmount());
  });
  it('enters and exits fullscreen on the existing map container', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<ParkingStrategyMap points={[]} onSelect={() => {}} compact />));
    const surface = container.firstElementChild as HTMLDivElement;
    const request = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: surface });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Object.defineProperty(surface, 'requestFullscreen', { configurable: true, value: request });
    const previousExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    const previousElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      document.dispatchEvent(new Event('fullscreenchange'));
    }) });
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="View map fullscreen"]')!.click());
      expect(request).toHaveBeenCalledOnce();
      expect(surface.style.height).toBe('100dvh');
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Exit fullscreen map"]')!.click());
      expect(surface.style.height).toBe('440px');
    } finally {
      await act(async () => root.unmount());
      if (previousExit) Object.defineProperty(document, 'exitFullscreen', previousExit);
      else Reflect.deleteProperty(document, 'exitFullscreen');
      if (previousElement) Object.defineProperty(document, 'fullscreenElement', previousElement);
      else Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });
});
