import { describe, expect, it } from 'vitest';
import { RIDERSHIP_TREND_BASELINE } from '../utils/ridership-trends/baseline';
import { buildMonthlyRidershipReportModel } from '../utils/ridership-trends/monthlyReport';
import type { TodRidershipProjectionV1 } from '../utils/ridership-trends/tod';
import type { RidershipTrendProjectionV1 } from '../utils/ridership-trends/types';
import {
  buildMonthlyRidershipChartSvg,
  buildMonthlyRidershipReportHtml,
  buildMonthlyRidershipReportText,
  MONTHLY_RIDERSHIP_CHART_CID,
  MONTHLY_RIDERSHIP_LOGO_CID,
  renderMonthlyRidershipChartPng,
} from '../functions/src/monthlyRidershipReportHtml';

const dates = Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);
const fixedProjection: RidershipTrendProjectionV1 = {
  schemaVersion: 1,
  metric: 'fixed_route_boardings',
  cutoverDate: '2026-08-01',
  baselineHash: RIDERSHIP_TREND_BASELINE.source.sha256,
  dailyTotals: Object.fromEntries(dates.map(date => [date, { boardings: 7_000, performanceSchemaVersion: 14 }])),
  latestServiceDate: '2026-08-31',
  updatedAt: '2026-09-01T14:00:00.000Z',
};
const todProjection: TodRidershipProjectionV1 = {
  schemaVersion: 1,
  metric: 'tod_completed_trips',
  dailyTotals: Object.fromEntries(dates.map(date => [date, 100])),
  latestServiceDate: '2026-08-31',
  updatedAt: '2026-09-01T14:00:00.000Z',
};
const priorYearFixedDailyTotals = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [
  `2025-08-${String(index + 1).padStart(2, '0')}`,
  8_000,
]));

function completeModel() {
  return buildMonthlyRidershipReportModel({
    baseline: RIDERSHIP_TREND_BASELINE,
    fixedProjection,
    todProjection,
    priorYearFixedDailyTotals,
    reportMonth: '2026-08',
    generatedAt: '2026-09-01T14:00:00.000Z',
  });
}

describe('monthly ridership report rendering', () => {
  it('renders the Barrie-blue email, logo, coverage, and inline chart', () => {
    const model = completeModel();
    const html = buildMonthlyRidershipReportHtml({ model, brandLogoCid: MONTHLY_RIDERSHIP_LOGO_CID });

    expect(html).toContain('Barrie Transit Monthly Ridership - August 2026');
    expect(html).toContain('#044C7C');
    expect(html).toContain('Total August Ridership');
    expect(html).toContain('Scheduled Bus Service');
    expect(html).toContain('On Demand Service');
    expect(html).not.toContain('Monthly coverage complete');
    expect(html).toContain('Ridership So Far This Year');
    expect(html).toContain('End-of-Year Pace (Estimated)');
    expect(html).toContain('18% lower');
    expect(html).toContain('Compared with August 2025');
    expect(html).toContain('day-type-cell');
    expect(html).not.toContain('Change from August 2025');
    expect(html).not.toContain('text-transform:uppercase');
    expect(html).toContain(`src="cid:${MONTHLY_RIDERSHIP_LOGO_CID}"`);
    expect(html).toContain(`src="cid:${MONTHLY_RIDERSHIP_CHART_CID}"`);
    expect(html).toContain('Five-Year View');
    expect(html).not.toContain('Sources and Limits');
    expect(html).not.toContain('About the Numbers');
    expect(html).not.toContain('Generated automatically');
    expect(html).not.toContain('Specialized Ridership Chart');
  });

  it('renders an explicit partial-evidence warning and withholds the comparison', () => {
    const model = buildMonthlyRidershipReportModel({
      baseline: RIDERSHIP_TREND_BASELINE,
      fixedProjection: { ...fixedProjection, dailyTotals: {} },
      todProjection: { ...todProjection, dailyTotals: {} },
      reportMonth: '2026-08',
      generatedAt: '2026-09-01T14:00:00.000Z',
    });
    const html = buildMonthlyRidershipReportHtml({ model });

    expect(html).toContain('Some Days Are Missing');
    expect(html).toContain('Missing days are excluded from the totals; they are not counted as zero');
    expect(html).toContain('August 2025 comparison not available');
    expect(html).toContain('No scheduled bus days reported');
  });

  it('builds a real PNG and a useful plain-text fallback', async () => {
    const model = completeModel();
    const svg = buildMonthlyRidershipChartSvg(model);
    const png = await renderMonthlyRidershipChartPng(model);
    const text = buildMonthlyRidershipReportText(model);

    expect(svg).toContain('<svg');
    expect(svg).toContain('Year-to-Date Ridership by Year');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.length).toBeLessThan(600_000);
    expect(text).toContain('Total ridership: 220,100');
    expect(text).toContain('End-of-year pace (estimated):');
    expect(text).toContain('Ridership counts trips taken, not unique people');
  });
});
