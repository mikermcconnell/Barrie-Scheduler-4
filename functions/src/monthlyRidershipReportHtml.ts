import sharp from 'sharp';
import type {
  MonthlyRidershipComparison,
  MonthlyRidershipReportModel,
  MonthlyRidershipServiceKey,
  MonthlyRidershipServiceSummary,
} from '../../utils/ridership-trends/monthlyReport';

export const MONTHLY_RIDERSHIP_LOGO_CID = 'barrie-transit-logo';
export const MONTHLY_RIDERSHIP_CHANGE_CHART_CID = 'monthly-ridership-change-chart';
export const MONTHLY_RIDERSHIP_TREND_CHART_CID = 'monthly-ridership-trend-chart';
export function monthlyRidershipSparklineCid(service: MonthlyRidershipServiceKey): string {
  return `monthly-ridership-sparkline-${service}`;
}

export interface MonthlyRidershipChartImage {
  cid: string;
  filename: string;
  png: Buffer;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTH_NAMES.map(name => name.slice(0, 3));

const BRAND = '#044C7C';
const SKY = '#74CCEA';
const LAST_YEAR = '#94A3B8';
const INK = '#0F172A';
const INK2 = '#475569';
const MUTED = '#64748B';
const GRID = '#E2E8F0';
const LINE = '#DCE5EC';
const UP = '#15803D';
const UP_BG = '#DCFCE7';
const DOWN = '#B91C1C';
const DOWN_BG = '#FEE2E2';
const NA_BG = '#F1F5F9';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";
const SVG_FONT = 'Arial, Helvetica, sans-serif';
// Charts are drawn at twice their display size so they stay sharp on high-density screens.
const SCALE = 2;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value: number | null): string {
  return value === null ? '&mdash;' : Math.round(value).toLocaleString('en-CA');
}

function formatPlainNumber(value: number | null): string {
  return value === null ? 'not yet available' : Math.round(value).toLocaleString('en-CA');
}

function formatRate(value: number | null): string {
  return value === null ? '&mdash;' : value.toFixed(1);
}

function signedPercent(change: number, html = true): string {
  const percent = Math.abs(change * 100).toFixed(1);
  if (percent === '0.0') return '0.0%';
  return `${change > 0 ? '+' : html ? '&minus;' : '-'}${percent}%`;
}

function arrow(change: number): string {
  if (Math.abs(change) < 0.0005) return '';
  return change > 0 ? '&#9650; ' : '&#9660; ';
}

function changeColour(change: number): string {
  if (Math.abs(change) < 0.0005) return INK2;
  return change > 0 ? UP : DOWN;
}

function monthLabel(key: string, short = false): string {
  const [year, month] = key.split('-').map(Number);
  return `${(short ? SHORT_MONTHS : MONTH_NAMES)[month - 1]} ${year}`;
}

function serviceList(model: MonthlyRidershipReportModel, keys: MonthlyRidershipServiceKey[]): string {
  const labels = keys.map(key => model.services.find(service => service.key === key)?.label ?? key);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function pill(change: number | null, options: { label?: string; big?: boolean; unavailable?: string } = {}): string {
  const size = options.big ? 'font-size:15px;padding:6px 12px;' : 'font-size:13px;padding:4px 9px;';
  if (change === null) {
    return `<span style="display:inline-block;background:${NA_BG};color:${MUTED};border-radius:999px;${size}font-weight:700;white-space:nowrap;">${escapeHtml(options.unavailable ?? 'No comparison yet')}</span>`;
  }
  const flat = Math.abs(change) < 0.0005;
  const colour = flat ? INK2 : change > 0 ? UP : DOWN;
  const background = flat ? NA_BG : change > 0 ? UP_BG : DOWN_BG;
  const label = options.label ? ` <span style="font-weight:600;">${escapeHtml(options.label)}</span>` : '';
  return `<span style="display:inline-block;background:${background};color:${colour};border-radius:999px;${size}font-weight:800;white-space:nowrap;">${arrow(change)}${signedPercent(change)}${label}</span>`;
}

function changeText(change: number | null): string {
  if (change === null) return `<span style="color:${MUTED};">&mdash;</span>`;
  return `<span style="color:${changeColour(change)};font-weight:700;white-space:nowrap;">${arrow(change)}${signedPercent(change)}</span>`;
}

function coverageText(model: MonthlyRidershipReportModel, source: 'scheduledRoutes' | 'onDemand'): string {
  const coverage = model.coverage[source];
  if (coverage.complete) return `all ${coverage.expectedDays} days reported`;
  if (coverage.observedDays === 0) return 'no days reported';
  return `${coverage.observedDays} of ${coverage.expectedDays} days reported`;
}

function headlineSummary(model: MonthlyRidershipReportModel): string {
  const monthName = MONTH_NAMES[model.month - 1];
  const grew = model.services.filter(service => (service.month.change ?? 0) >= 0.0005);
  const fell = model.services.filter(service => (service.month.change ?? 0) <= -0.0005);
  const unreported = model.services.filter(service => service.month.current === null);
  const uncompared = model.services.filter(service => service.month.current !== null && service.month.change === null);
  const sentences: string[] = [];
  if (grew.length > 0) {
    sentences.push(`${serviceList(model, grew.map(service => service.key))} grew compared with ${monthName} ${model.reportYear - 1}.`);
  }
  for (const service of fell) {
    sentences.push(`${service.label} was down ${Math.abs((service.month.change ?? 0) * 100).toFixed(1)}%.`);
  }
  if (uncompared.length > 0) {
    sentences.push(`${serviceList(model, uncompared.map(service => service.key))} ${uncompared.length === 1 ? 'has' : 'have'} no comparison with last year yet.`);
  }
  if (unreported.length > 0) {
    sentences.push(`${serviceList(model, unreported.map(service => service.key))} ${unreported.length === 1 ? 'has' : 'have'} not reported ${monthName} yet.`);
  }
  return sentences.join(' ');
}

// ---------- Chart SVGs (rendered to PNG for email clients) ----------

export function buildMonthlyRidershipChangeChartSvg(model: MonthlyRidershipReportModel): string {
  const rows = [
    ...model.services.map(service => ({ label: service.label, change: service.month.change, total: false })),
    { label: 'All Services', change: model.total.change, total: true },
  ];
  const width = 600;
  const labelWidth = 150;
  const rowHeight = 44;
  const top = 6;
  const height = top + rowHeight * rows.length + 34;
  const base = height - 30;
  const changes = rows.flatMap(row => row.change === null ? [] : [row.change * 100]);
  // Leave room beyond each bar end for its value label.
  const low = Math.min(-10, Math.floor((Math.min(0, ...changes) - 8) / 10) * 10);
  const high = Math.max(20, Math.ceil((Math.max(0, ...changes) + 8) / 10) * 10);
  const plotWidth = width - labelWidth - 80;
  const x = (value: number) => labelWidth + ((value - low) / (high - low)) * plotWidth;
  const parts: string[] = [];
  for (let tick = low; tick <= high; tick += 10) {
    parts.push(`<line x1="${x(tick)}" y1="${top}" x2="${x(tick)}" y2="${base}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${x(tick)}" y="${height - 10}" font-size="11" fill="${MUTED}" text-anchor="middle">${tick === 0 ? '0%' : `${tick > 0 ? '+' : '&#8722;'}${Math.abs(tick)}%`}</text>`);
  }
  const separatorY = top + model.services.length * rowHeight;
  parts.push(`<line x1="0" y1="${separatorY}" x2="${width}" y2="${separatorY}" stroke="${LINE}" stroke-width="1"/>`);
  rows.forEach((row, index) => {
    const cy = top + (index * rowHeight) + (rowHeight / 2);
    parts.push(`<text x="${labelWidth - 14}" y="${cy + 5}" font-size="14" font-weight="${row.total ? 800 : 600}" fill="${INK}" text-anchor="end">${escapeHtml(row.label)}</text>`);
    if (row.change === null) {
      parts.push(`<text x="${x(0) + 10}" y="${cy + 5}" font-size="13" font-style="italic" fill="${MUTED}">No comparison yet</text>`);
      return;
    }
    const value = row.change * 100;
    const [x0, x1] = [x(0), x(value)].sort((a, b) => a - b);
    const colour = changeColour(row.change);
    const barHeight = row.total ? 22 : 18;
    parts.push(`<rect x="${x0}" y="${cy - (barHeight / 2)}" width="${Math.max(x1 - x0, 2)}" height="${barHeight}" rx="4" fill="${colour}"/>`);
    const label = `${value >= 0 ? '&#9650;' : '&#9660;'} ${signedPercent(row.change).replace('&minus;', '&#8722;')}`;
    parts.push(value >= 0
      ? `<text x="${x1 + 8}" y="${cy + 5}" font-size="14" font-weight="800" fill="${colour}">${label}</text>`
      : `<text x="${x0 - 8}" y="${cy + 5}" font-size="14" font-weight="800" fill="${colour}" text-anchor="end">${label}</text>`);
  });
  parts.push(`<line x1="${x(0)}" y1="${top}" x2="${x(0)}" y2="${base}" stroke="${INK2}" stroke-width="1.5"/>`);
  return svgDocument(width, height, parts.join('\n'));
}

export function buildMonthlyRidershipTrendChartSvg(model: MonthlyRidershipReportModel): string {
  const width = 600;
  const height = 250;
  const margin = { left: 50, right: 96, top: 14, bottom: 32 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = [...model.trend.current, ...model.trend.priorYear].filter((value): value is number => value !== null);
  const parts: string[] = [];
  if (values.length === 0) {
    parts.push(`<text x="${width / 2}" y="${height / 2}" font-size="14" fill="${MUTED}" text-anchor="middle">Not enough history yet</text>`);
    return svgDocument(width, height, parts.join('\n'));
  }
  const step = niceStep((Math.max(...values) - Math.min(...values)) / 3 || Math.max(...values) / 3 || 1);
  const low = Math.floor((Math.min(...values) * 0.95) / step) * step;
  const high = Math.ceil(Math.max(...values) / step) * step;
  const count = model.trend.months.length;
  const xs = model.trend.months.map((_, index) => margin.left + ((index * plotWidth) / Math.max(count - 1, 1)));
  const y = (value: number) => margin.top + (((high - value) / (high - low || 1)) * plotHeight);
  for (let tick = low; tick <= high + (step / 2); tick += step) {
    parts.push(`<line x1="${margin.left}" y1="${y(tick)}" x2="${width - margin.right}" y2="${y(tick)}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${margin.left - 8}" y="${y(tick) + 4}" font-size="11" fill="${MUTED}" text-anchor="end">${escapeHtml(formatAxisValue(tick))}</text>`);
  }
  model.trend.months.forEach((key, index) => {
    if (index % 2 !== 0) return;
    const [year, month] = key.split('-').map(Number);
    const label = `${SHORT_MONTHS[month - 1]}${index === 0 || month === 1 ? ` &#8217;${String(year).slice(2)}` : ''}`;
    parts.push(`<text x="${xs[index]}" y="${height - 10}" font-size="11" fill="${MUTED}" text-anchor="middle">${label}</text>`);
  });
  const segments = (series: Array<number | null>): string[][] => {
    const result: string[][] = [[]];
    series.forEach((value, index) => {
      if (value === null) {
        if (result.at(-1)?.length) result.push([]);
        return;
      }
      result.at(-1)?.push(`${xs[index].toFixed(1)},${y(value).toFixed(1)}`);
    });
    return result.filter(points => points.length > 0);
  };
  for (const points of segments(model.trend.priorYear)) {
    parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${LAST_YEAR}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`);
  }
  for (const points of segments(model.trend.current)) {
    if (points.length > 1) {
      const first = points[0].split(',')[0];
      const last = points.at(-1)?.split(',')[0];
      parts.push(`<polygon points="${first},${y(low)} ${points.join(' ')} ${last},${y(low)}" fill="${BRAND}" fill-opacity="0.07"/>`);
    }
    parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${BRAND}" stroke-width="2.5" stroke-linejoin="round"/>`);
  }
  model.trend.current.forEach((value, index) => {
    if (value === null) return;
    const last = index === count - 1;
    parts.push(`<circle cx="${xs[index]}" cy="${y(value)}" r="${last ? 5.5 : 3}" fill="${BRAND}" stroke="#FFFFFF" stroke-width="2"/>`);
  });
  const lastCurrent = model.trend.current.at(-1) ?? null;
  const lastPrior = model.trend.priorYear.at(-1) ?? null;
  const labelX = xs[count - 1] + 12;
  if (lastCurrent !== null) {
    parts.push(`<text x="${labelX}" y="${y(lastCurrent) - 2}" font-size="13" font-weight="800" fill="${INK}">${Math.round(lastCurrent).toLocaleString('en-CA')}</text>`);
    parts.push(`<text x="${labelX}" y="${y(lastCurrent) + 13}" font-size="11" fill="${INK2}">This Year</text>`);
  }
  if (lastPrior !== null) {
    const priorY = lastCurrent !== null && Math.abs(y(lastPrior) - y(lastCurrent)) < 30 ? y(lastCurrent) + 30 : y(lastPrior) + 4;
    parts.push(`<text x="${labelX}" y="${priorY}" font-size="11" fill="${INK2}">Year Before</text>`);
  }
  return svgDocument(width, height, parts.join('\n'));
}

export function buildMonthlyRidershipSparklineSvg(service: MonthlyRidershipServiceSummary): string | null {
  const width = 170;
  const height = 44;
  const pad = 5;
  const values = service.trend.map(point => point.total);
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  const xs = values.map((_, index) => pad + ((index * (width - (2 * pad))) / Math.max(values.length - 1, 1)));
  const y = (value: number) => pad + (((high - value) / (high - low || 1)) * (height - (2 * pad)));
  const points = values.flatMap((value, index) => value === null ? [] : [`${xs[index].toFixed(1)},${y(value).toFixed(1)}`]);
  const firstIndex = values.findIndex(value => value !== null);
  const lastIndex = values.length - 1 - [...values].reverse().findIndex(value => value !== null);
  const parts = [
    `<polygon points="${xs[firstIndex]},${height} ${points.join(' ')} ${xs[lastIndex]},${height}" fill="${BRAND}" fill-opacity="0.08"/>`,
    `<polyline points="${points.join(' ')}" fill="none" stroke="${BRAND}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="${xs[firstIndex]}" cy="${y(values[firstIndex] ?? 0)}" r="3" fill="${LAST_YEAR}"/>`,
    `<circle cx="${xs[lastIndex]}" cy="${y(values[lastIndex] ?? 0)}" r="4.5" fill="${BRAND}" stroke="#FFFFFF" stroke-width="2"/>`,
  ];
  return svgDocument(width, height, parts.join('\n'));
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${height * SCALE}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#FFFFFF"/>
  <g font-family="${SVG_FONT}">${body}</g>
</svg>`;
}

function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toString();
}

async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

export async function renderMonthlyRidershipCharts(model: MonthlyRidershipReportModel): Promise<MonthlyRidershipChartImage[]> {
  const images: Array<{ cid: string; filename: string; svg: string }> = [
    { cid: MONTHLY_RIDERSHIP_CHANGE_CHART_CID, filename: `ridership-change-${model.reportMonth}.png`, svg: buildMonthlyRidershipChangeChartSvg(model) },
    { cid: MONTHLY_RIDERSHIP_TREND_CHART_CID, filename: `ridership-trend-${model.reportMonth}.png`, svg: buildMonthlyRidershipTrendChartSvg(model) },
  ];
  for (const service of model.services) {
    const svg = buildMonthlyRidershipSparklineSvg(service);
    if (svg) images.push({ cid: monthlyRidershipSparklineCid(service.key), filename: `ridership-${service.key}-${model.reportMonth}.png`, svg });
  }
  return Promise.all(images.map(async image => ({ cid: image.cid, filename: image.filename, png: await svgToPng(image.svg) })));
}

// ---------- Email HTML ----------

function section(title: string, subtitle: string, body: string): string {
  return `<tr><td style="padding:26px 26px 0;">
    <div style="font-size:18px;line-height:24px;font-weight:900;color:${BRAND};">${escapeHtml(title)}</div>
    <div style="font-size:13px;line-height:18px;color:${MUTED};margin:2px 0 14px;">${subtitle}</div>
    ${body}
  </td></tr>`;
}

function chartImage(cid: string, alt: string, width: number): string {
  return `<img class="chart-image" src="cid:${escapeHtml(cid)}" width="${width}" alt="${escapeHtml(alt)}" style="display:block;width:${width}px;max-width:100%;height:auto;border:0;" />`;
}

function serviceCard(model: MonthlyRidershipReportModel, service: MonthlyRidershipServiceSummary, hasSparkline: boolean): string {
  const monthName = MONTH_NAMES[model.month - 1];
  const value = service.month.current === null
    ? `<div style="font-size:18px;line-height:32px;font-weight:800;color:${MUTED};margin-top:10px;">Not yet reported</div>`
    : `<div style="font-size:28px;line-height:32px;font-weight:900;color:${INK};margin-top:10px;">${formatNumber(service.month.current)}</div>`;
  const badge = service.month.current === null ? '' : `<div style="margin-top:6px;">${pill(service.month.change)}</div>`;
  const sourceNote = service.month.changeFromSourceReport
    ? `<div style="font-size:11px;color:${MUTED};margin-top:4px;">Change from the ${escapeHtml(monthName)} source report</div>`
    : '';
  const first = service.trend[0]?.month;
  const last = service.trend.at(-1)?.month;
  const spark = hasSparkline
    ? `<div style="margin-top:10px;">${chartImage(monthlyRidershipSparklineCid(service.key), `${service.label} riders, last 13 months`, 170)}</div>
       <div style="font-size:11px;color:${MUTED};margin-top:2px;">${first && last ? `${monthLabel(first, true)} &rarr; ${monthLabel(last, true)}` : ''}</div>`
    : `<div style="margin-top:10px;padding:8px 6px;background:${NA_BG};border-radius:8px;text-align:center;font-size:11px;line-height:14px;color:${MUTED};">Trend builds as months are added</div>`;
  return `<td class="card-cell" width="33%" valign="top" style="padding:0 5px;">
    <div style="border:1px solid ${LINE};border-radius:16px;padding:14px 14px 12px;background:#FFFFFF;">
      <div style="font-size:14px;font-weight:800;color:${BRAND};">${escapeHtml(service.label)}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:1px;">${escapeHtml(service.description)}</div>
      ${value}${badge}${sourceNote}${spark}
      <div style="border-top:1px solid ${GRID};margin-top:10px;padding-top:8px;font-size:12px;color:${INK2};">Year to Date ${service.yearToDate.change === null ? `<span style="color:${MUTED};">not yet available</span>` : changeText(service.yearToDate.change)}</div>
    </div>
  </td>`;
}

function barRow(year: number, value: number, top: number, colour: string, label: string): string {
  const percent = Math.max(2, Math.round((value / top) * 100));
  return `<tr>
    <td width="34" style="font-size:11px;color:${MUTED};padding:2px 6px 2px 0;">${year}</td>
    <td style="padding:2px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${GRID};border-radius:4px;"><tr>
        <td width="${percent}%" height="10" style="height:10px;line-height:10px;font-size:1px;background:${colour};border-radius:4px;">&nbsp;</td>
        ${percent < 100 ? '<td style="font-size:1px;line-height:10px;">&nbsp;</td>' : ''}
      </tr></table>
    </td>
    <td width="56" align="right" style="font-size:12px;color:${INK2};padding:2px 0 2px 8px;white-space:nowrap;">${label}</td>
  </tr>`;
}

function efficiencyCell(
  model: MonthlyRidershipReportModel,
  metric: MonthlyRidershipComparison,
  format: (value: number | null) => string,
  unavailable: string,
): string {
  if (metric.current === null) {
    return `<td class="card-cell" width="50%" valign="top" style="padding:0 5px 10px;">
      <div style="border:1px solid ${LINE};border-radius:14px;padding:12px 14px;background:#FAFBFC;">
        <div style="font-size:24px;line-height:28px;font-weight:900;color:#CBD5E1;">&mdash;</div>
        <div style="font-size:12px;color:${MUTED};margin-top:8px;">${escapeHtml(unavailable)}</div>
      </div></td>`;
  }
  const top = Math.max(metric.current, metric.priorYear ?? 0) || 1;
  const bars = barRow(model.reportYear, metric.current, top, BRAND, format(metric.current))
    + (metric.priorYear === null ? '' : barRow(model.reportYear - 1, metric.priorYear, top, LAST_YEAR, format(metric.priorYear)));
  return `<td class="card-cell" width="50%" valign="top" style="padding:0 5px 10px;">
    <div style="border:1px solid ${LINE};border-radius:14px;padding:12px 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
        <td style="font-size:24px;line-height:28px;font-weight:900;color:${INK};">${format(metric.current)}</td>
        <td align="right">${pill(metric.change)}</td>
      </tr></table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bars}</table>
    </div></td>`;
}

const CLOCK_ICON = `<span style="display:inline-block;width:14px;height:14px;border:2px solid ${BRAND};border-radius:50%;vertical-align:-3px;margin-right:6px;"></span>`;
const CALENDAR_ICON = `<span style="display:inline-block;width:14px;height:12px;border:2px solid ${BRAND};border-top-width:4px;border-radius:3px;vertical-align:-3px;margin-right:6px;"></span>`;

function efficiencySection(model: MonthlyRidershipReportModel): string {
  const rows = model.services.map(service => `
    <tr><td colspan="2" style="padding:6px 5px;font-size:14px;font-weight:800;color:${BRAND};">${escapeHtml(service.label)}</td></tr>
    <tr>
      ${efficiencyCell(model, service.ridersPerServiceHour, formatRate,
        service.serviceHours.current === null ? 'Official service hours not yet entered' : 'Riders not yet reported')}
      ${efficiencyCell(model, service.weekdayAverage, formatNumber,
        service.weekdayAverage.supported ? 'Weekday riders not yet reported' : 'Not available from the monthly source report')}
    </tr>`).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 -5px;width:calc(100% + 10px);">
    <tr>
      <td class="card-cell" width="50%" style="padding:0 5px 4px;font-size:13px;font-weight:800;color:${INK2};">${CLOCK_ICON}Riders per Service Hour</td>
      <td class="card-cell" width="50%" style="padding:0 5px 4px;font-size:13px;font-weight:800;color:${INK2};">${CALENDAR_ICON}Average Weekday Riders</td>
    </tr>
    ${rows}
  </table>`;
}

function detailTable(model: MonthlyRidershipReportModel): string {
  const shortMonth = SHORT_MONTHS[model.month - 1];
  const th = `style="padding:9px 8px;font-size:12px;font-weight:800;color:${INK2};border-bottom:2px solid ${BRAND};"`;
  const td = (content: string, align = 'right', extra = '') => `<td style="padding:11px 8px;font-size:14px;color:${INK};text-align:${align};border-bottom:1px solid ${GRID};${extra}">${content}</td>`;
  const rows = model.services.map(service => `<tr>
    ${td(`<b>${escapeHtml(service.label)}</b>`, 'left')}
    ${td(formatNumber(service.month.current), 'right', 'font-weight:700;')}
    ${td(formatNumber(service.month.priorYear), 'right', `color:${INK2};`)}
    ${td(changeText(service.month.change))}
    ${td(formatNumber(service.yearToDate.current))}
    ${td(changeText(service.yearToDate.change))}
  </tr>`).join('');
  const last = 'border-bottom:none;';
  const totalRow = `<tr style="background:#EAF6FC;">
    ${td('<b>All Services</b>', 'left', last)}
    ${td(formatNumber(model.total.current), 'right', `font-weight:900;${last}`)}
    ${td(formatNumber(model.total.priorYear), 'right', `color:${INK2};${last}`)}
    ${td(changeText(model.total.change), 'right', last)}
    ${td(`<b>${formatNumber(model.totalYearToDate.current)}</b>`, 'right', last)}
    ${td(changeText(model.totalYearToDate.change), 'right', last)}
  </tr>`;
  const notes: string[] = [];
  if (model.total.change !== null && model.total.comparedServices.length < model.total.reportedServices.length) {
    notes.push(`All Services ${escapeHtml(shortMonth)} ${model.reportYear - 1} and change cover ${escapeHtml(serviceList(model, model.total.comparedServices))} only.`);
  }
  if (model.totalYearToDate.current !== null && model.totalYearToDate.comparedServices.length < model.services.length) {
    notes.push(`All Services year to date covers ${escapeHtml(serviceList(model, model.totalYearToDate.comparedServices))} only.`);
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
    <tr><th align="left" ${th}>Service</th><th align="right" ${th}>${escapeHtml(shortMonth)} ${model.reportYear}</th><th align="right" ${th}>${escapeHtml(shortMonth)} ${model.reportYear - 1}</th><th align="right" ${th}>Change</th><th align="right" ${th}>Year to Date</th><th align="right" ${th}>YTD Change</th></tr>
    ${rows}${totalRow}
  </table>${notes.length ? `<div style="font-size:12px;line-height:18px;color:${MUTED};margin-top:8px;">${notes.join(' ')}</div>` : ''}`;
}

export function buildMonthlyRidershipReportHtml(input: {
  model: MonthlyRidershipReportModel;
  brandLogoCid?: string;
  sparklineServices?: MonthlyRidershipServiceKey[];
}): string {
  const { model } = input;
  const monthName = MONTH_NAMES[model.month - 1];
  const priorYear = model.reportYear - 1;
  const sparklines = new Set(input.sparklineServices ?? model.services
    .filter(service => service.trend.filter(point => point.total !== null).length >= 2)
    .map(service => service.key));
  const brand = input.brandLogoCid
    ? `<img src="cid:${escapeHtml(input.brandLogoCid)}" width="190" alt="Barrie Transit" style="display:block;width:190px;max-width:100%;height:auto;border:0;" />`
    : `<div style="font-size:30px;line-height:32px;font-weight:900;color:${BRAND};letter-spacing:-.03em;">Barrie Transit <span style="color:${SKY};">&gt;&gt;</span></div>`;
  const partialCoverageNotice = model.coverage.complete ? '' : `<tr><td style="padding:18px 20px 0;">
    <div style="background:#FFF7E6;border:2px solid #F4C56A;border-radius:16px;padding:14px 16px;color:#854D0E;">
      <div style="font-size:14px;font-weight:900;">Some Days Are Missing</div>
      <div style="margin-top:5px;font-size:12px;line-height:18px;">
        Conventional: ${escapeHtml(coverageText(model, 'scheduledRoutes'))}. Transit ON Demand: ${escapeHtml(coverageText(model, 'onDemand'))}.
        Missing days are excluded from the totals; they are not counted as zero. Comparisons need every day reported.
      </div>
    </div>
  </td></tr>`;
  const partialTotalNote = model.total.change !== null && model.total.comparedServices.length < model.total.reportedServices.length
    ? `<div style="font-size:12px;color:${MUTED};margin-top:6px;">Change covers ${escapeHtml(serviceList(model, model.total.comparedServices))} only</div>`
    : '';
  const ytdNote = model.totalYearToDate.current !== null && model.totalYearToDate.comparedServices.length < model.services.length
    ? `<div style="font-size:11px;color:${MUTED};margin-top:4px;">${escapeHtml(serviceList(model, model.totalYearToDate.comparedServices))} only</div>`
    : '';
  const rph = model.totalRidersPerServiceHour;
  const rphBlock = rph.current === null
    ? `<div style="font-size:13px;font-weight:700;color:${MUTED};margin-top:2px;">Official hours not yet entered</div>`
    : `<div style="font-size:20px;font-weight:900;color:${INK};margin-top:2px;">${formatRate(rph.current)}${rph.priorYear === null ? '' : ` <span style="font-size:12px;font-weight:600;color:${MUTED};">was ${formatRate(rph.priorYear)}</span>`}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Barrie Transit Monthly Ridership - ${escapeHtml(monthName)} ${model.reportYear}</title>
  <style>
    @media only screen and (max-width:620px) {
      .report-shell { width:100% !important; }
      .header-cell, .hero-cell, .card-cell { display:block !important; width:100% !important; text-align:left !important; padding-left:0 !important; padding-right:0 !important; padding-bottom:12px !important; border-left:none !important; }
      .chart-image { width:100% !important; height:auto !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#F2F5F7;font-family:${FONT};color:${INK};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F2F5F7;">
    <tr><td align="center" style="padding:22px 10px;">
      <table role="presentation" class="report-shell" width="660" cellspacing="0" cellpadding="0" border="0" style="width:660px;max-width:660px;background:#FFFFFF;border:3px solid ${BRAND};border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08);">
        <tr><td style="padding:24px 26px 20px;border-bottom:1px solid ${LINE};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td class="header-cell" width="58%" valign="top">
              <div style="font-size:13px;line-height:17px;font-weight:900;color:${BRAND};">Monthly Ridership Report</div>
              <div style="margin-top:6px;font-size:31px;line-height:36px;font-weight:900;color:${INK};">${escapeHtml(monthName)} ${model.reportYear}</div>
              <div style="margin-top:7px;font-size:13px;line-height:20px;color:${INK2};">Passenger boardings across Conventional, Transit ON Demand and Specialized service.</div>
            </td>
            <td class="header-cell" width="42%" align="right" valign="top">${brand}</td>
          </tr></table>
        </td></tr>

        ${partialCoverageNotice}

        <tr><td style="padding:20px 20px 0;">
          <div style="background:#EAF6FC;border:2px solid ${SKY};border-radius:20px;padding:18px 20px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td class="hero-cell" valign="top">
                <div style="font-size:15px;font-weight:800;color:${BRAND};">Total ${escapeHtml(monthName)} Ridership</div>
                <div style="font-size:46px;line-height:52px;font-weight:900;color:${INK};margin-top:4px;">${formatNumber(model.total.current)}</div>
                <div style="margin-top:8px;">${pill(model.total.change, { label: `vs ${monthName} ${priorYear}`, big: true })}</div>
                ${partialTotalNote}
              </td>
              <td class="hero-cell" width="190" valign="top" style="border-left:1px solid #BFE6F5;padding-left:18px;">
                <div style="font-size:13px;font-weight:800;color:${BRAND};">Year to Date</div>
                <div style="font-size:26px;line-height:32px;font-weight:900;color:${INK};margin-top:4px;">${formatNumber(model.totalYearToDate.current)}</div>
                <div style="margin-top:6px;">${pill(model.totalYearToDate.change, { label: `vs ${priorYear}`, unavailable: 'Not yet available' })}</div>
                ${ytdNote}
                <div style="font-size:13px;font-weight:800;color:${BRAND};margin-top:14px;">Riders per Service Hour</div>
                ${rphBlock}
              </td>
            </tr></table>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid #BFE6F5;font-size:14px;line-height:20px;color:${INK};">${escapeHtml(headlineSummary(model))}</div>
          </div>
        </td></tr>

        ${section('Ridership by Service', `${escapeHtml(monthName)} ${model.reportYear} riders, change from ${escapeHtml(monthName)} ${priorYear}, and the last 13 months`,
          `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 -5px;width:calc(100% + 10px);"><tr>
            ${model.services.map(service => serviceCard(model, service, sparklines.has(service.key))).join('')}
          </tr></table>`)}

        ${section('Change From Last Year', `Percent change in riders, ${escapeHtml(monthName)} ${model.reportYear} vs ${escapeHtml(monthName)} ${priorYear}`,
          chartImage(MONTHLY_RIDERSHIP_CHANGE_CHART_CID, 'Change in riders from last year, by service', 608))}

        ${section('13-Month Trend', 'Conventional riders per month. The dashed line shows the same months one year earlier.',
          chartImage(MONTHLY_RIDERSHIP_TREND_CHART_CID, 'Conventional riders per month for the last 13 months', 608))}

        ${section('Service Efficiency', `${escapeHtml(monthName)} ${model.reportYear}, compared with ${escapeHtml(monthName)} ${priorYear}`, efficiencySection(model))}

        ${section('Detailed Numbers', 'Subtotals for each service and the grand total', detailTable(model))}

        <tr><td style="padding:22px 26px 24px;font-size:12px;color:${MUTED};line-height:18px;">
          Sources: Conventional - STREETS boardings; Transit ON Demand - completed trips; Specialized - monthly ridership report.
          Ridership counts trips taken, not unique people. Missing days are excluded, not counted as zero.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildMonthlyRidershipReportText(model: MonthlyRidershipReportModel): string {
  const monthName = MONTH_NAMES[model.month - 1];
  const priorYear = model.reportYear - 1;
  const change = (value: number | null) => value === null ? 'no comparison yet' : `${signedPercent(value, false)} vs ${monthName} ${priorYear}`;
  const serviceLines = model.services.map(service => {
    const riders = service.month.current === null
      ? 'not yet reported'
      : `${formatPlainNumber(service.month.current)} (${change(service.month.change)})`;
    return `${service.label}: ${riders}`;
  });
  return [
    `Barrie Transit Monthly Ridership - ${monthName} ${model.reportYear}`,
    '',
    `Total ridership: ${formatPlainNumber(model.total.current)} (${change(model.total.change)})`,
    `Year to date: ${formatPlainNumber(model.totalYearToDate.current)}`,
    headlineSummary(model),
    '',
    ...serviceLines,
    '',
    'Missing reports are excluded, not counted as zero. Ridership counts trips taken, not unique people.',
  ].join('\n');
}
