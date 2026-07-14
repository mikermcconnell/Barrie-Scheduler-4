import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

vi.mock('../components/Performance/reports/reportExporter', () => ({
  exportOperatorDwell: vi.fn().mockResolvedValue(undefined),
  exportOperatorDwellPDF: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../components/Performance/DwellIncidentDetailDrawer', () => ({
  default: (): null => null,
}));

import { OperatorDwellModule } from '../components/Performance/OperatorDwellModule';

const data = {
  dailySummaries: [{
    date: '2026-07-01',
    dayType: 'weekday',
    schemaVersion: 12,
    byOperatorDwell: {
      incidents: [
        { incidentId: 'moderate', operatorId: 'OP2', date: '2026-07-01', routeId: '20', routeName: 'Route 20', stopName: 'Second Stop', stopId: 'S2', tripName: 'Trip 2', block: '20-01', observedArrivalTime: '09:00:00', observedDepartureTime: '09:04:00', rawDwellSeconds: 240, trackedDwellSeconds: 240, severity: 'moderate' },
        { incidentId: 'high', operatorId: 'OP1', date: '2026-07-01', routeId: '10', routeName: 'Route 10', stopName: 'Main Terminal', stopId: 'S1', tripName: 'Trip 1', block: '10-01', observedArrivalTime: '08:00:00', observedDepartureTime: '08:06:00', rawDwellSeconds: 360, trackedDwellSeconds: 360, severity: 'high' },
      ],
      byOperator: [],
      totalIncidents: 2,
      totalTrackedDwellMinutes: 10,
      exposureByRouteOperator: [
        { routeId: '10', operatorId: 'OP1', eligibleTimepointVisits: 50 },
        { routeId: '20', operatorId: 'OP2', eligibleTimepointVisits: 50 },
      ],
    },
    byCascade: {
      cascades: [], byStop: [], byTerminal: [], totalCascaded: 0, totalNonCascaded: 0, avgBlastRadius: 0, totalBlastRadius: 0,
    },
    loadProfiles: [],
  }],
  metadata: { importedAt: '', importedBy: '', dateRange: { start: '2026-07-01', end: '2026-07-01' }, dayCount: 1, totalRecords: 2 },
  schemaVersion: 12,
} as unknown as PerformanceDataSummary;

describe('Dwell Incident Review module', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('states the non-blaming purpose and defaults to impact-prioritized incidents', () => {
    flushSync(() => root.render(<OperatorDwellModule data={data} />));
    expect(container.textContent).toContain('Dwell Incident Review');
    expect(container.textContent).toContain('investigation signals, not proof of operator fault');
    expect(container.textContent).toContain('Incidents / 1K visits');

    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows[0].textContent).toContain('Route 10');
    expect(rows[0].textContent).toContain('High');
  });

  it('filters by severity and exposes the neutral patterns view', () => {
    flushSync(() => root.render(<OperatorDwellModule data={data} />));
    const severity = container.querySelector('select[aria-label="Severity"]') as HTMLSelectElement;
    flushSync(() => {
      severity.value = 'moderate';
      severity.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('1 of 2 incidents');
    expect(container.textContent).toContain('Route 20');

    const patternsButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Patterns');
    flushSync(() => patternsButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('Operator context');
    expect(container.textContent).toContain('not a ranking or finding of fault');
  });
});

