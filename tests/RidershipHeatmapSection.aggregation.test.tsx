import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RidershipHeatmapSection } from '../components/Performance/RidershipHeatmapSection';
import { PerformanceAggregationProvider } from '../components/Performance/performanceAggregation';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

const data = {
  dailySummaries: ['2026-09-01', '2026-09-21'].map(date => ({
    date, dayType: 'weekday', ridershipHeatmaps: [{ routeId: '10', routeName: 'Test', direction: 'North',
      stops: [{ stopId: '100', stopName: 'Terminal', routeStopIndex: 0, isTimepoint: true }],
      trips: [{ tripId: '1', terminalDepartureTime: '08:00', block: '1' }], cells: [[[15, 5]]],
    }],
  })),
} as unknown as PerformanceDataSummary;

function render(mode: 'sum' | 'average', days = 2) {
  return renderToStaticMarkup(<PerformanceAggregationProvider value={{ mode, divisor: mode === 'average' ? days : 1, unit: 'weekday', coveredDays: 2, expectedDays: 2, label: '' }}><RidershipHeatmapSection data={data} /></PerformanceAggregationProvider>);
}

describe('Ridership heatmap shared aggregation', () => {
  it('includes every selected date and switches cell counts from sum to daily average', () => {
    const sum = render('sum');
    const average = render('average');
    expect(sum).toContain('>30<');
    expect(average).toContain('>15<');
    expect(sum).not.toContain('Past Week');
    expect(average).toContain('Values are averages / weekday');
    const fractional = render('average', 4);
    expect(fractional).toContain('text-green-800\">7.5<');
  });
});
