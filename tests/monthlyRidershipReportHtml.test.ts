import { describe, expect, it } from 'vitest';
import { RIDERSHIP_TREND_BASELINE } from '../utils/ridership-trends/baseline';
import { buildMonthlyRidershipReportModel } from '../utils/ridership-trends/monthlyReport';
import type { TodRidershipProjectionV1 } from '../utils/ridership-trends/tod';
import type { RidershipTrendProjectionV1 } from '../utils/ridership-trends/types';
import {
  buildMonthlyRidershipChangeChartSvg,
  buildMonthlyRidershipReportHtml,
  buildMonthlyRidershipReportText,
  buildMonthlyRidershipSparklineSvg,
  buildMonthlyRidershipTrendChartSvg,
  MONTHLY_RIDERSHIP_CHANGE_CHART_CID,
  MONTHLY_RIDERSHIP_LOGO_CID,
  MONTHLY_RIDERSHIP_TREND_CHART_CID,
  monthlyRidershipSparklineCid,
  renderMonthlyRidershipCharts,
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

function model(overrides: Partial<Parameters<typeof buildMonthlyRidershipReportModel>[0]> = {}) {
  return buildMonthlyRidershipReportModel({
    baseline: RIDERSHIP_TREND_BASELINE,
    fixedProjection,
    todProjection,
    specializedMonths: { '2026-08': { reportedTrips: 7_350, priorYearPercent: 96 } },
    serviceHours: { '2026-08': { conventional: 15_800 } },
    reportMonth: '2026-08',
    generatedAt: '2026-09-01T14:00:00.000Z',
    ...overrides,
  });
}

describe('monthly ridership report rendering', () => {
  it('renders the approved executive layout with every section and inline image', () => {
    const html = buildMonthlyRidershipReportHtml({ model: model(), brandLogoCid: MONTHLY_RIDERSHIP_LOGO_CID });

    expect(html).toContain('Barrie Transit Monthly Ridership - August 2026');
    expect(html).toContain('#044C7C');
    expect(html).toContain('Total August Ridership');
    expect(html).toContain('227,450');
    for (const heading of ['Ridership by Service', 'Change From Last Year', '13-Month Trend', 'Service Efficiency', 'Detailed Numbers']) {
      expect(html).toContain(heading);
    }
    expect(html).toContain('Transit ON Demand');
    expect(html).toContain('Specialized');
    expect(html).toContain('Change from the August source report');
    expect(html).toContain(`src="cid:${MONTHLY_RIDERSHIP_LOGO_CID}"`);
    expect(html).toContain(`src="cid:${MONTHLY_RIDERSHIP_CHANGE_CHART_CID}"`);
    expect(html).toContain(`src="cid:${MONTHLY_RIDERSHIP_TREND_CHART_CID}"`);
    expect(html).toContain(`src="cid:${monthlyRidershipSparklineCid('conventional')}"`);
    expect(html).not.toContain('End-of-Year Pace');
    expect(html).not.toContain('Five-Year View');
    expect(html).not.toContain('Context Notes');
    expect(html).not.toContain('text-transform:uppercase');
  });

  it('shows not-yet-available states instead of zeros or invented comparisons', () => {
    const html = buildMonthlyRidershipReportHtml({
      model: model({ specializedMonths: null, serviceHours: null }),
      sparklineServices: ['conventional'],
    });

    expect(html).toContain('Not yet reported');
    expect(html).toContain('Official service hours not yet entered');
    expect(html).toContain('Official hours not yet entered');
    expect(html).toContain('Not available from the monthly source report');
    expect(html).toContain('No comparison yet');
    expect(html).toContain('Trend builds as months are added');
    expect(html).toContain('Change covers Conventional only');
    expect(html).toContain('Specialized has not reported August yet.');
  });

  it('renders an explicit partial-evidence warning and withholds the comparison', () => {
    const partial = model({
      fixedProjection: { ...fixedProjection, dailyTotals: {} },
      todProjection: { ...todProjection, dailyTotals: {} },
      specializedMonths: null,
    });
    const html = buildMonthlyRidershipReportHtml({ model: partial });

    expect(html).toContain('Some Days Are Missing');
    expect(html).toContain('Conventional: no days reported');
    expect(partial.total.change).toBeNull();
  });

  it('draws charts that label missing comparisons and skips sparklines without history', () => {
    const current = model();
    expect(buildMonthlyRidershipChangeChartSvg(current)).toContain('No comparison yet');
    expect(buildMonthlyRidershipChangeChartSvg(current)).toContain('All Services');
    expect(buildMonthlyRidershipTrendChartSvg(current)).toContain('This Year');
    expect(buildMonthlyRidershipSparklineSvg(current.services[0])).toContain('<polyline');
    expect(buildMonthlyRidershipSparklineSvg(current.services[1])).toBeNull();
  });

  it('builds real PNG charts and a useful plain-text fallback', async () => {
    const current = model();
    const charts = await renderMonthlyRidershipCharts(current);
    const text = buildMonthlyRidershipReportText(current);

    expect(charts.map(chart => chart.cid)).toEqual([
      MONTHLY_RIDERSHIP_CHANGE_CHART_CID,
      MONTHLY_RIDERSHIP_TREND_CHART_CID,
      monthlyRidershipSparklineCid('conventional'),
    ]);
    for (const chart of charts) expect(chart.png.subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(text).toContain('Total ridership: 227,450');
    expect(text).toContain('Conventional: 217,000');
    expect(text).toContain('Transit ON Demand: 3,100 (no comparison yet)');
    expect(text).toContain('Specialized: 7,350 (-4.0% vs August 2025)');
  }, 30_000);
});
