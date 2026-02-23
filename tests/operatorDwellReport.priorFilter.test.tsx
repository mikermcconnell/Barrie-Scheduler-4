import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { DailySummary } from '../utils/performanceDataTypes';

const aggregateDwellAcrossDaysMock = vi.fn((days: DailySummary[]) => ({
  incidents: [],
  byOperator: [],
  totalIncidents: days.length,
  totalTrackedDwellMinutes: 0,
}));

vi.mock('../utils/schedule/operatorDwellUtils', () => ({
  aggregateDwellAcrossDays: (days: DailySummary[]) => aggregateDwellAcrossDaysMock(days),
}));

vi.mock('../components/Performance/reports/reportExporter', () => ({
  exportOperatorDwell: vi.fn().mockResolvedValue(undefined),
  exportOperatorDwellPDF: vi.fn().mockResolvedValue(undefined),
}));

import { OperatorDwellReport } from '../components/Performance/reports/OperatorDwellReport';

function makeDay(date: string, dayType: 'weekday' | 'saturday' | 'sunday'): DailySummary {
  return {
    date,
    dayType,
    system: { tripCount: 0 },
    byOperatorDwell: {
      incidents: [],
      byOperator: [],
      totalIncidents: 0,
      totalTrackedDwellMinutes: 0,
    },
  } as unknown as DailySummary;
}

describe('OperatorDwellReport prior period filtering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    aggregateDwellAcrossDaysMock.mockClear();
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

  it('applies dayTypeFilter to prior-period metrics', () => {
    const allDays = [
      makeDay('2026-02-08', 'sunday'),
      makeDay('2026-02-09', 'weekday'),
      makeDay('2026-02-10', 'weekday'),
      makeDay('2026-02-11', 'weekday'),
    ];
    const filteredDays = [allDays[2], allDays[3]];

    flushSync(() => {
      root.render(
        <OperatorDwellReport
          filteredDays={filteredDays}
          allDays={allDays}
          startDate="2026-02-10"
          endDate="2026-02-11"
          dayTypeFilter="weekday"
        />
      );
    });

    expect(aggregateDwellAcrossDaysMock).toHaveBeenCalledTimes(2);

    const priorPeriodDays = aggregateDwellAcrossDaysMock.mock.calls[1][0];
    expect(priorPeriodDays.map(day => day.date)).toEqual(['2026-02-09']);
    expect(priorPeriodDays.every(day => day.dayType === 'weekday')).toBe(true);
  });
});
