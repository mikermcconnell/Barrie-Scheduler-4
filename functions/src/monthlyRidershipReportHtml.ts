import sharp from 'sharp';
import type {
  MonthlyRidershipDayType,
  MonthlyRidershipReportModel,
} from '../../utils/ridership-trends/monthlyReport';

export const MONTHLY_RIDERSHIP_CHART_CID = 'monthly-ridership-chart';
export const MONTHLY_RIDERSHIP_LOGO_CID = 'barrie-transit-logo';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SERIES_COLORS = ['#A8DCEB', '#74CCEA', '#4AA7D2', '#2876A8', '#044C7C'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function formatNumber(value: number | null): string {
  return value === null ? '&mdash;' : Math.round(value).toLocaleString('en-CA');
}

function formatPlainNumber(value: number | null): string {
  return value === null ? 'unavailable' : Math.round(value).toLocaleString('en-CA');
}

function formatChange(value: number | null): string {
  if (value === null) return 'Comparison unavailable';
  const rounded = Math.round(Math.abs(value) * 100);
  if (rounded === 0) return 'No change';
  return `${rounded}% ${value > 0 ? 'higher' : 'lower'}`;
}

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return Math.round(value).toString();
}

function sourceCoverageText(model: MonthlyRidershipReportModel, source: 'scheduledRoutes' | 'onDemand'): string {
  const coverage = model[source].coverage;
  if (coverage.complete) return `All ${coverage.expectedDays} days reported`;
  if (coverage.observedDays === 0) return `No ${source === 'scheduledRoutes' ? 'scheduled bus' : 'On Demand'} days reported`;
  return `${coverage.observedDays} of ${coverage.expectedDays} days reported; ${coverage.missingDates.length} missing`;
}

export function buildMonthlyRidershipChartSvg(model: MonthlyRidershipReportModel): string {
  const width = 800;
  const height = 560;
  const margin = { top: 88, right: 40, bottom: 62, left: 124 };
  const chartWidth = width - margin.left - margin.right;
  const endpoints = model.chart.series.map(series => ({
    year: series.year,
    point: series.points.at(-1),
  }));
  const values = endpoints.flatMap(({ point }) => point?.cumulativeTotal === null || point === undefined
    ? []
    : [point.cumulativeTotal]);
  const maxValue = Math.max(...values, 1);
  const roundedMax = Math.ceil(maxValue / 250_000) * 250_000;
  const rowHeight = 76;
  const barHeight = 48;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (roundedMax * index) / 4;
    const x = margin.left + ((chartWidth * index) / 4);
    return `<line x1="${x}" y1="${margin.top - 12}" x2="${x}" y2="${height - margin.bottom}" stroke="#E2E8F0" stroke-width="2" />
      <text x="${x}" y="${height - 20}" text-anchor="middle" fill="#64748B" font-size="18">${escapeXml(formatAxisValue(value))}</text>`;
  }).join('\n');
  const bars = endpoints.map(({ year, point }, index) => {
    const value = point?.cumulativeTotal ?? null;
    const barWidth = value === null ? 0 : Math.max(8, (value / roundedMax) * chartWidth);
    const y = margin.top + (index * rowHeight);
    const color = SERIES_COLORS[index % SERIES_COLORS.length];
    const valueLabel = value === null ? 'Unavailable' : Math.round(value).toLocaleString('en-CA');
    const partialLabel = point?.partial && value !== null ? ' partial' : '';
    return `<text x="${margin.left - 16}" y="${y + 33}" text-anchor="end" fill="#0F172A" font-size="24" font-weight="800">${year}</text>
      <rect x="${margin.left}" y="${y}" width="${chartWidth}" height="${barHeight}" rx="16" fill="#F1F5F9" />
      ${value === null ? '' : `<rect x="${margin.left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="16" fill="${color}" />`}
      <text x="${value === null ? margin.left + 14 : margin.left + Math.max(barWidth - 14, 116)}" y="${y + 32}" text-anchor="${value === null ? 'start' : 'end'}" fill="${value === null ? '#64748B' : '#FFFFFF'}" font-size="21" font-weight="800">${escapeXml(valueLabel)}${partialLabel}</text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="28" fill="#FFFFFF" />
    <text x="${margin.left}" y="34" fill="#0F172A" font-family="Arial, sans-serif" font-size="28" font-weight="800">Year-to-Date Ridership by Year</text>
    <text x="${margin.left}" y="62" fill="#64748B" font-family="Arial, sans-serif" font-size="20">Scheduled bus service, January through ${escapeXml(MONTH_NAMES[model.month - 1])}</text>
    <g font-family="Arial, sans-serif">
      ${grid}
      ${bars}
    </g>
  </svg>`;
}

export async function renderMonthlyRidershipChartPng(model: MonthlyRidershipReportModel): Promise<Buffer> {
  return sharp(Buffer.from(buildMonthlyRidershipChartSvg(model)))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function metricCell(params: {
  label: string;
  value: string;
  detail: string;
  background: string;
  border: string;
  width?: string;
}): string {
  return `<td class="metric-cell" width="${params.width ?? '33.33%'}" valign="top" style="padding:0 5px 10px;">
    <div style="min-height:118px;background:${params.background};border:2px solid ${params.border};border-radius:18px;padding:16px;">
      <div style="font-size:13px;line-height:17px;font-weight:800;color:#334155;">${escapeHtml(params.label)}</div>
      <div style="margin-top:8px;font-size:29px;line-height:34px;font-weight:900;color:#0F172A;">${params.value}</div>
      <div style="margin-top:6px;font-size:12px;line-height:18px;color:#475569;">${escapeHtml(params.detail)}</div>
    </div>
  </td>`;
}

function dayTypeCard(
  model: MonthlyRidershipReportModel,
  dayType: MonthlyRidershipDayType,
  label: string,
): string {
  const metric = model.dayTypes[dayType];
  const changeColor = metric.yearOverYearChange === null
    ? '#64748B'
    : metric.yearOverYearChange >= 0 ? '#166534' : '#9A3412';
  return `<td class="day-type-cell" width="33.33%" valign="top" style="padding:0 5px 10px;">
    <div style="min-height:82px;background:#F8FAFC;border:1px solid #CBD9E2;border-radius:14px;padding:14px;">
      <div style="font-size:12px;line-height:16px;font-weight:800;color:#044C7C;">${escapeHtml(label)}</div>
      <div style="margin-top:7px;font-size:23px;line-height:27px;font-weight:900;color:#0F172A;">${formatNumber(metric.average)}</div>
      <div style="margin-top:4px;font-size:12px;line-height:16px;font-weight:900;color:${changeColor};">${escapeHtml(formatChange(metric.yearOverYearChange))}</div>
    </div>
  </td>`;
}

export function buildMonthlyRidershipReportHtml(input: {
  model: MonthlyRidershipReportModel;
  chartCid?: string;
  brandLogoCid?: string;
}): string {
  const { model } = input;
  const chartCid = input.chartCid ?? MONTHLY_RIDERSHIP_CHART_CID;
  const monthName = MONTH_NAMES[model.month - 1];
  const complete = model.allTransit.complete;
  const partialCoverageNotice = complete ? '' : `<tr><td style="padding:18px 20px 0;">
    <div style="background:#FFF7E6;border:2px solid #F4C56A;border-radius:16px;padding:14px 16px;color:#854D0E;">
      <div style="font-size:14px;font-weight:900;">Some Days Are Missing</div>
      <div style="margin-top:5px;font-size:12px;line-height:18px;">
        Scheduled bus service: ${escapeHtml(sourceCoverageText(model, 'scheduledRoutes'))}. On Demand service: ${escapeHtml(sourceCoverageText(model, 'onDemand'))}.
        Missing days are excluded from the totals; they are not counted as zero.
      </div>
    </div>
  </td></tr>`;
  const comparisonChange = model.priorYearShare === null
    ? 'Comparison unavailable'
    : formatChange(model.priorYearShare - 1);
  const comparisonDetail = model.priorYearShare === null
    ? `${monthName} ${model.reportYear - 1} comparison not available`
    : `Compared with ${monthName} ${model.reportYear - 1}`;
  const ytdDetail = !model.yearToDateScheduledRoutes.complete
    ? `Partial scheduled bus ridership through ${monthName}`
    : model.yearToDateScheduledRoutes.yearOverYearChange === null
      ? `Scheduled bus ridership through ${monthName}; comparison unavailable`
      : `${formatChange(model.yearToDateScheduledRoutes.yearOverYearChange)} than January-${monthName} ${model.reportYear - 1}`;
  const projectedDetail = model.projectedAnnualScheduledRoutes.yearOverYearChange === null
    ? 'Available when all scheduled bus days have been reported'
    : `${formatChange(model.projectedAnnualScheduledRoutes.yearOverYearChange)} than the ${model.reportYear - 1} full-year total`;
  const brand = input.brandLogoCid
    ? `<img src="cid:${escapeHtml(input.brandLogoCid)}" width="190" alt="Barrie Transit" style="display:block;width:190px;max-width:100%;height:auto;border:0;" />`
    : `<div style="font-size:30px;line-height:32px;font-weight:900;color:#044C7C;letter-spacing:-.03em;">Barrie Transit <span style="color:#74CCEA;">&gt;&gt;</span></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Barrie Transit Monthly Ridership - ${escapeHtml(monthName)} ${model.reportYear}</title>
  <style>
    @media only screen and (max-width:620px) {
      .report-shell { width:100% !important; }
      .metric-cell { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; }
      .day-type-cell { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; }
      .header-cell { display:block !important; width:100% !important; text-align:left !important; padding-bottom:14px !important; }
      .chart-image { width:100% !important; height:auto !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#F2F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F2F5F7;">
    <tr><td align="center" style="padding:22px 10px;">
      <table role="presentation" class="report-shell" width="660" cellspacing="0" cellpadding="0" border="0" style="width:660px;max-width:660px;background:#FFFFFF;border:3px solid #044C7C;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08);">
        <tr><td style="padding:24px 26px 20px;border-bottom:1px solid #DCE5EC;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td class="header-cell" width="58%" valign="top">
              <div style="font-size:13px;line-height:17px;font-weight:900;color:#044C7C;">Monthly Ridership Report</div>
              <div style="margin-top:6px;font-size:31px;line-height:36px;font-weight:900;color:#0F172A;">${escapeHtml(monthName)} ${model.reportYear}</div>
              <div style="margin-top:7px;font-size:13px;line-height:20px;color:#475569;">Passenger boardings across scheduled bus and On Demand service.</div>
            </td>
            <td class="header-cell" width="42%" align="right" valign="top">${brand}</td>
          </tr></table>
        </td></tr>

        ${partialCoverageNotice}

        <tr><td style="padding:18px 20px 0;">
          <div style="background:#EEF8FC;border:2px solid #74CCEA;border-radius:20px;padding:18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td valign="top">
                <div style="font-size:15px;line-height:19px;font-weight:900;color:#044C7C;">Total ${escapeHtml(monthName)} Ridership</div>
                <div style="margin-top:7px;font-size:36px;line-height:40px;font-weight:900;color:#0F172A;">${formatNumber(model.allTransit.total)}</div>
              </td>
              <td align="right" valign="top" style="padding-left:12px;">
                <span style="display:inline-block;background:#FFF3ED;border:1px solid #F1B59E;border-radius:999px;padding:8px 10px;font-size:12px;line-height:16px;font-weight:900;color:#9A3412;white-space:nowrap;">${escapeHtml(comparisonChange)}</span>
              </td>
            </tr></table>
            <div style="margin-top:6px;font-size:13px;line-height:19px;color:#475569;">${escapeHtml(comparisonDetail)}</div>
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;border-collapse:separate;border-spacing:0 6px;">
            <tr>
              <td style="padding:9px 12px;background:#F8FAFC;border-left:4px solid #4AA7D2;font-size:12px;color:#334155;white-space:nowrap;"><strong>Scheduled Bus Service</strong> &nbsp; ${formatNumber(model.scheduledRoutes.total)}</td>
              <td align="right" style="padding:9px 12px;background:#F8FAFC;font-size:11px;color:#64748B;">${escapeHtml(sourceCoverageText(model, 'scheduledRoutes'))}</td>
            </tr>
            <tr>
              <td style="padding:9px 12px;background:#FAF8FF;border-left:4px solid #A78BFA;font-size:12px;color:#334155;white-space:nowrap;"><strong>On Demand Service</strong> &nbsp; ${formatNumber(model.onDemand.total)}</td>
              <td align="right" style="padding:9px 12px;background:#FAF8FF;font-size:11px;color:#64748B;">${escapeHtml(sourceCoverageText(model, 'onDemand'))}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 15px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            ${metricCell({ label: 'Ridership So Far This Year', value: formatNumber(model.yearToDateScheduledRoutes.total), detail: ytdDetail, background: '#F0F9FF', border: '#74CCEA', width: '50%' })}
            ${metricCell({ label: 'End-of-Year Pace (Estimated)', value: formatNumber(model.projectedAnnualScheduledRoutes.total), detail: projectedDetail, background: '#F5F3FF', border: '#A78BFA', width: '50%' })}
          </tr></table>
        </td></tr>

        <tr><td style="padding:10px 15px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="padding:0 5px;"><div style="font-size:18px;font-weight:900;color:#044C7C;">Average Daily Ridership</div></td>
            <td align="right" style="padding:0 5px;font-size:11px;color:#64748B;">Compared with ${escapeHtml(monthName)} ${model.reportYear - 1}</td>
          </tr></table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;"><tr>
            ${dayTypeCard(model, 'weekday', 'Weekdays')}
            ${dayTypeCard(model, 'saturday', 'Saturdays')}
            ${dayTypeCard(model, 'sunday', 'Sundays')}
          </tr></table>
        </td></tr>

        <tr><td style="padding:24px 20px 0;">
          <div style="font-size:18px;font-weight:900;color:#044C7C;">Five-Year View</div>
          <div style="margin-top:4px;font-size:12px;line-height:18px;color:#64748B;">Scheduled bus ridership from January through ${escapeHtml(monthName)} for each of the past five years.</div>
          <div style="margin-top:12px;border:2px solid #B8CBD8;border-radius:18px;padding:8px;background:#FFFFFF;">
            <img class="chart-image" src="cid:${escapeHtml(chartCid)}" width="600" alt="Five-year scheduled-route year-to-date ridership comparison" style="display:block;width:600px;max-width:100%;height:auto;border:0;" />
          </div>
        </td></tr>

        <tr><td style="height:20px;line-height:20px;font-size:1px;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildMonthlyRidershipReportText(model: MonthlyRidershipReportModel): string {
  const monthName = MONTH_NAMES[model.month - 1];
  const dayTypeLine = (dayType: MonthlyRidershipDayType, label: string) => {
    const metric = model.dayTypes[dayType];
    const change = metric.yearOverYearChange === null
      ? 'prior-year comparison unavailable'
      : `${formatChange(metric.yearOverYearChange)} ${monthName} ${model.reportYear - 1}`;
    return `${label} average: ${formatPlainNumber(metric.average)} (${metric.observedDays} complete reported days; ${change})`;
  };
  const comparison = model.priorYearShare === null
    ? 'Prior-year comparison withheld because current source coverage is incomplete.'
    : `${Math.round(model.priorYearShare * 100)}% of ${monthName} ${model.reportYear - 1} scheduled-route ridership.`;
  const ytdComparison = model.yearToDateScheduledRoutes.yearOverYearChange === null
    ? 'comparison with last year unavailable'
    : `${formatChange(model.yearToDateScheduledRoutes.yearOverYearChange)} than January-${monthName} ${model.reportYear - 1}`;
  const annualProjectionComparison = model.projectedAnnualScheduledRoutes.yearOverYearChange === null
    ? 'available when all scheduled bus days have been reported'
    : `${formatChange(model.projectedAnnualScheduledRoutes.yearOverYearChange)} than the ${model.reportYear - 1} full-year total`;
  return [
    `Barrie Transit Monthly Ridership - ${monthName} ${model.reportYear}`,
    '',
    `Total ridership: ${formatPlainNumber(model.allTransit.total)}`,
    `Scheduled bus service: ${formatPlainNumber(model.scheduledRoutes.total)} (${sourceCoverageText(model, 'scheduledRoutes')})`,
    `On Demand service: ${formatPlainNumber(model.onDemand.total)} (${sourceCoverageText(model, 'onDemand')})`,
    comparison,
    `Ridership so far this year: ${formatPlainNumber(model.yearToDateScheduledRoutes.total)} (${ytdComparison})`,
    `End-of-year pace (estimated): ${formatPlainNumber(model.projectedAnnualScheduledRoutes.total)} (${annualProjectionComparison})`,
    '',
    dayTypeLine('weekday', 'Weekday'),
    dayTypeLine('saturday', 'Saturday'),
    dayTypeLine('sunday', 'Sunday'),
    '',
    'Missing reports are excluded, not counted as zero.',
    'Ridership counts trips taken, not unique people. Specialized Transit is not included.',
  ].join('\n');
}
