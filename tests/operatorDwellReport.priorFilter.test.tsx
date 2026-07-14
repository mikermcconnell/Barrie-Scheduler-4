import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { DailySummary, PerformanceDataSummary } from '../utils/performanceDataTypes';

const reviewModuleSpy = vi.fn();

vi.mock('../components/Performance/OperatorDwellModule', () => ({
  OperatorDwellModule: ({ data }: { data: PerformanceDataSummary }): null => {
    reviewModuleSpy(data);
    return null;
  },
}));

import { OperatorDwellReport } from '../components/Performance/reports/OperatorDwellReport';

function makeDay(date: string): DailySummary {
  return { date, dayType: 'weekday', schemaVersion: 12 } as unknown as DailySummary;
}

describe('Dwell Incident Review report wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reviewModuleSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('reuses the filtered dashboard review model instead of maintaining separate metrics', () => {
    const filteredDays = [makeDay('2026-02-10'), makeDay('2026-02-11')];
    flushSync(() => {
      root.render(
        <OperatorDwellReport
          filteredDays={filteredDays}
          allDays={filteredDays}
          startDate="2026-02-10"
          endDate="2026-02-11"
          dayTypeFilter="weekday"
        />
      );
    });

    expect(reviewModuleSpy).toHaveBeenCalledTimes(1);
    const data = reviewModuleSpy.mock.calls[0][0] as PerformanceDataSummary;
    expect(data.dailySummaries).toEqual(filteredDays);
    expect(data.metadata.dateRange).toEqual({ start: '2026-02-10', end: '2026-02-11' });
    expect(data.schemaVersion).toBe(12);
  });
});
