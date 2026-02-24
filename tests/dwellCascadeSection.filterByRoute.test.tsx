import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DwellCascadeSection } from '../components/Performance/DwellCascadeSection';
import type { DwellCascade, PerformanceDataSummary } from '../utils/performanceDataTypes';

function makeCascade(overrides: Partial<DwellCascade> = {}): DwellCascade {
  return {
    date: '2026-02-20',
    block: '10-01',
    routeId: '10',
    routeName: 'Route 10',
    stopName: 'Main Terminal',
    stopId: 'MT',
    tripName: 'Trip-R10',
    operatorId: 'OP1',
    observedDepartureTime: '08:15:00',
    trackedDwellSeconds: 180,
    severity: 'high',
    excessLateSeconds: 420,
    recoveryTimeAvailableSeconds: 300,
    cascadedTrips: [],
    blastRadius: 1,
    absorbed: false,
    ...overrides,
  };
}

describe('DwellCascadeSection stop filter', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('filters cascade detail by stop and route (not stop-only)', () => {
    const data = {
      dailySummaries: [
        {
          date: '2026-02-20',
          dayType: 'weekday',
          byCascade: {
            cascades: [
              makeCascade({ routeId: '10', routeName: 'Route 10', tripName: 'Trip-R10' }),
              makeCascade({ routeId: '20', routeName: 'Route 20', tripName: 'Trip-R20' }),
            ],
            byStop: [],
            byTerminal: [],
            totalCascades: 2,
            totalAbsorbed: 0,
            avgBlastRadius: 1,
            totalCascadeOTPDamage: 2,
          },
        },
      ],
      metadata: {
        importedAt: '2026-02-24T00:00:00Z',
        importedBy: 'test',
        dateRange: { start: '2026-02-20', end: '2026-02-20' },
        dayCount: 1,
        totalRecords: 100,
      },
      schemaVersion: 3,
    } as unknown as PerformanceDataSummary;

    flushSync(() => {
      root.render(<DwellCascadeSection data={data} />);
    });

    expect(container.textContent).toContain('Trip-R10');
    expect(container.textContent).toContain('Trip-R20');

    const route10Row = Array.from(container.querySelectorAll('tr'))
      .find(tr => (tr.textContent || '').includes('Main Terminal') && (tr.textContent || '').includes('10'));
    expect(route10Row).toBeTruthy();

    flushSync(() => {
      route10Row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Trip-R10');
    expect(container.textContent).not.toContain('Trip-R20');
  });
});
