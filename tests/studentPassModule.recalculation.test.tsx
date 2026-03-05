import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { findTripOptionsRaptorMock } = vi.hoisted(() => ({
  findTripOptionsRaptorMock: vi.fn(),
}));

vi.mock('../utils/transit-app/studentPassUtils', () => ({
  BARRIE_SCHOOLS: [
    {
      id: 'school-a',
      name: 'School A',
      lat: 44.41,
      lon: -79.67,
      bellStart: '08:45',
      bellEnd: '15:10',
    },
    {
      id: 'school-b',
      name: 'School B',
      lat: 44.40,
      lon: -79.70,
      bellStart: '09:00',
      bellEnd: '15:30',
    },
  ],
  minutesToDisplayTime: (minutes: number): string => `${minutes}`,
}));

vi.mock('../utils/transit-app/studentPassRaptorAdapter', () => ({
  findTripOptionsRaptor: findTripOptionsRaptorMock,
}));

vi.mock('../components/Analytics/StudentPassMap', () => ({
  StudentPassMap: ({ onPolygonComplete }: { onPolygonComplete: (coords: [number, number][]) => void }) => (
    <div>
      <div className="student-pass-map" />
      <button onClick={() => onPolygonComplete([[44.4, -79.7], [44.42, -79.7], [44.41, -79.68]])}>
        Draw Zone
      </button>
    </div>
  ),
}));

vi.mock('../components/Analytics/StudentPassPreview', () => ({
  StudentPassPreview: (): null => null,
}));

import { StudentPassModule } from '../components/Analytics/StudentPassModule';

function createTripOptions() {
  const result = {
    found: true,
    isDirect: true,
    morningLegs: [
      {
        routeShortName: '1',
        routeColor: '#111111',
        tripId: 'trip-am-1',
        fromStopId: 'stop-from',
        toStopId: 'stop-to',
        departureMinutes: 480,
        arrivalMinutes: 510,
        fromStop: 'From Stop',
        toStop: 'To Stop',
      },
    ],
    afternoonLegs: [] as { routeShortName: string; routeColor: string; tripId: string; fromStopId: string; toStopId: string; departureMinutes: number; arrivalMinutes: number; fromStop: string; toStop: string }[],
    frequencyPerHour: 2,
  };
  return {
    morningOptions: [{ id: 'am-1', label: 'Rt 1 Direct', result }],
    afternoonOptions: [] as { id: string; label: string; result: typeof result }[],
  };
}

describe('StudentPassModule recalculation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelRafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findTripOptionsRaptorMock.mockReset();
    findTripOptionsRaptorMock.mockReturnValue(createTripOptions());

    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback): number => {
      cb(0);
      return 1;
    });
    cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
  });

  it('recomputes trip result when bell times change after drawing a zone', async () => {
    flushSync(() => {
      root.render(<StudentPassModule onBack={() => {}} />);
    });

    const drawButton = Array.from(container.querySelectorAll('button'))
      .find((btn) => (btn.textContent || '').includes('Draw Zone'));
    expect(drawButton).toBeTruthy();

    flushSync(() => {
      drawButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await Promise.resolve();

    expect(findTripOptionsRaptorMock).toHaveBeenCalledTimes(1);
    expect(findTripOptionsRaptorMock.mock.calls[0]?.[1]).toMatchObject({
      id: 'school-a',
      bellStart: '08:45',
      bellEnd: '15:10',
    });

    const timeInputs = container.querySelectorAll('input[type="time"]');
    expect(timeInputs.length).toBeGreaterThanOrEqual(2);
    const startInput = timeInputs[0] as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    expect(valueSetter).toBeTruthy();

    flushSync(() => {
      valueSetter?.call(startInput, '09:10');
      startInput.dispatchEvent(new Event('input', { bubbles: true }));
      startInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await Promise.resolve();

    expect(findTripOptionsRaptorMock).toHaveBeenCalledTimes(2);
    expect(findTripOptionsRaptorMock.mock.calls[1]?.[1]).toMatchObject({
      id: 'school-a',
      bellStart: '09:10',
      bellEnd: '15:10',
    });
  });

  it('recomputes with defaults for the newly selected school', async () => {
    flushSync(() => {
      root.render(<StudentPassModule onBack={() => {}} />);
    });

    const drawButton = Array.from(container.querySelectorAll('button'))
      .find((btn) => (btn.textContent || '').includes('Draw Zone'));
    expect(drawButton).toBeTruthy();

    flushSync(() => {
      drawButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await Promise.resolve();
    expect(findTripOptionsRaptorMock).toHaveBeenCalledTimes(1);

    const schoolSelect = container.querySelector('select');
    expect(schoolSelect).toBeTruthy();

    flushSync(() => {
      (schoolSelect as HTMLSelectElement).value = 'school-b';
      schoolSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await Promise.resolve();

    expect(findTripOptionsRaptorMock).toHaveBeenCalledTimes(2);
    expect(findTripOptionsRaptorMock.mock.calls[1]?.[1]).toMatchObject({
      id: 'school-b',
      bellStart: '09:00',
      bellEnd: '15:30',
    });
  });
});
