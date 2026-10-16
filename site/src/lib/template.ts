import * as XLSX from 'xlsx';
import { addMonths, splitMonth } from './months';
import type { MonthKey } from './types';
import {
  NOTES_SHEET,
  ROUTE_COLUMNS,
  ROUTES_SHEET,
  SYSTEM_COLUMNS,
  SYSTEM_SHEET,
  TARGET_DEFS,
  TARGETS_SHEET,
} from './workbookSchema';

type CellObject = XLSX.CellObject;

const monthCell = (key: MonthKey): CellObject => {
  const { year, month } = splitMonth(key);
  return { t: 'n', v: Date.UTC(year, month - 1, 1) / 86400000 + 25569, z: 'mmm yyyy' };
};
const num = (v: number, z = '#,##0'): CellObject => ({ t: 'n', v, z });
const pctCell = (v: number): CellObject => ({ t: 'n', v: v / 100, z: '0.0%' });
const text = (v: string): CellObject => ({ t: 's', v });

function sheet(rows: (CellObject | string | number | null)[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

const INSTRUCTIONS = [
  ['Monthly Transit Dashboard: data workbook'],
  [''],
  ['Fill in one row per month on "System Monthly" and one row per route per month on "Routes".'],
  ['Keep earlier months in the workbook: the dashboard needs 13+ months to compare with the same month last year.'],
  ['Month: any Excel date in the month (e.g. 2026-09-01) or text like "Sep 2026".'],
  ['On-Time %: either 84.3 or 84.3% works.'],
  ['Leave a cell blank if the number is not available; that measure will show "No data".'],
  ['"Targets" holds monthly targets plus annual targets for the year-to-date panel. Blank targets are skipped.'],
  ['"Notes" (optional) adds items to the "Needs attention" panel. Leave Month blank to show a note every month.'],
  [''],
  ['Column', 'Sheet', 'What to enter'],
  ...SYSTEM_COLUMNS.map((c) => [c.header, SYSTEM_SHEET, c.help + (c.required ? ' (required)' : '')]),
  ...ROUTE_COLUMNS.map((c) => [c.header, ROUTES_SHEET, c.help + (c.required ? ' (required)' : '')]),
];

const SAMPLE_TARGETS: Record<string, number> = {
  boardings: 380000,
  boardingsPerRevenueHour: 22,
  onTimePct: 85,
  serviceDeliveredPct: 99.5,
  fareboxRecoveryPct: 30,
  costPerBoarding: 7,
  revenueHours: 17250,
  complaintsPer100k: 10,
  annualBoardings: 4400000,
  annualRevenueHours: 206000,
  annualFareRevenue: 7600000,
  annualOperatingBudget: 26500000,
};

const SAMPLE_ROUTES: [string, string, number, number, number][] = [
  // route, name, share of boardings, share of revenue hours, on-time offset (pts)
  ['8A', 'RVH / Georgian College', 0.142, 0.103, -3.1],
  ['8B', 'Georgian College / RVH', 0.136, 0.101, -2.3],
  ['400', 'Park Place / Downtown', 0.1, 0.083, 2.1],
  ['2A', 'Dunlop', 0.089, 0.083, 0.8],
  ['2B', 'Dunlop', 0.085, 0.083, 0.3],
  ['7A', 'Bayfield / Duckworth', 0.08, 0.079, -0.6],
  ['7B', 'Duckworth / Bayfield', 0.075, 0.079, 0.6],
  ['100', 'Red Express', 0.065, 0.071, 5.3],
  ['101', 'Blue Express', 0.061, 0.068, 4.5],
  ['12A', 'Essa', 0.055, 0.066, 1.9],
  ['12B', 'Essa', 0.052, 0.066, 1.5],
  ['10', 'Painswick', 0.031, 0.06, 4],
  ['11', 'Mapleview', 0.029, 0.058, 3.6],
];

// Jan..Dec ridership seasonality (college terms lift Sep–Nov and Jan–Apr).
const SEASON = [0.9, 0.95, 1.0, 1.01, 0.99, 0.93, 0.9, 0.97, 1.12, 1.03, 1.06, 0.97];

/** Small deterministic pseudo-random generator so the sample is the same every time. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the blank template, or (with `latestMonth`) a filled sample ending at that month. */
export function buildWorkbook(latestMonth?: MonthKey): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(INSTRUCTIONS, [16, 16, 90]), 'Instructions');

  const systemRows: (CellObject | string)[][] = [SYSTEM_COLUMNS.map((c) => c.header)];
  const routeRows: (CellObject | string)[][] = [ROUTE_COLUMNS.map((c) => c.header)];
  const noteRows: (CellObject | string)[][] = [['Month', 'Title', 'Detail']];

  if (latestMonth) {
    const rand = seeded(2026);
    for (let i = 23; i >= 0; i--) {
      const month = addMonths(latestMonth, -i);
      const { month: m } = splitMonth(month);
      const growth = Math.pow(1.055, (23 - i) / 12);
      const boardings = Math.round(352000 * SEASON[m - 1] * growth * (0.98 + rand() * 0.04));
      const revenueHours = Math.round(17100 * (m === 7 || m === 8 ? 0.95 : 1) * (0.99 + rand() * 0.02));
      const scheduledTrips = Math.round(18300 * (m === 7 || m === 8 ? 0.95 : 1));
      const otp = Math.round((83 + rand() * 4.5) * 10) / 10;
      systemRows.push([
        monthCell(month),
        num(boardings),
        num(revenueHours),
        num(scheduledTrips),
        num(scheduledTrips - Math.round(6 + rand() * 18)),
        pctCell(otp),
        num(Math.round(boardings * (1.68 + rand() * 0.06)), '$#,##0'),
        num(Math.round(revenueHours * (126 + rand() * 6)), '$#,##0'),
        num(Math.round(boardings * (0.00008 + rand() * 0.00005))),
      ]);
      if (i <= 12) {
        for (const [route, name, share, hourShare, offset] of SAMPLE_ROUTES) {
          routeRows.push([
            monthCell(month),
            text(route),
            text(name),
            num(Math.round(boardings * share * (0.96 + rand() * 0.08))),
            num(Math.round(revenueHours * hourShare)),
            pctCell(Math.min(97, Math.round((otp + offset + (rand() - 0.5) * 2) * 10) / 10)),
          ]);
        }
      }
    }
    noteRows.push(
      [monthCell(latestMonth), 'College start-up crowding on Route 8', 'Standees on most 8A/8B trips 3–5 pm in the first two weeks of term.'],
      [monthCell(latestMonth), 'Construction on Duckworth St', 'Adding about 3 minutes per trip in the PM peak until mid-November.'],
    );
  }

  const targetRows: (CellObject | string)[][] = [['Measure', 'Target'], ...TARGET_DEFS.map((d) => {
    const v = latestMonth ? SAMPLE_TARGETS[d.key] : undefined;
    return [d.label, v == null ? '' : d.percent ? pctCell(v) : num(v, d.key === 'costPerBoarding' ? '$0.00' : '#,##0.0##')];
  })];

  XLSX.utils.book_append_sheet(wb, sheet(systemRows, [12, 12, 14, 15, 14, 11, 14, 15, 12]), SYSTEM_SHEET);
  XLSX.utils.book_append_sheet(wb, sheet(routeRows, [12, 8, 26, 12, 14, 11]), ROUTES_SHEET);
  XLSX.utils.book_append_sheet(wb, sheet(targetRows, [32, 14]), TARGETS_SHEET);
  XLSX.utils.book_append_sheet(wb, sheet(noteRows, [12, 40, 70]), NOTES_SHEET);
  return wb;
}

export function downloadWorkbook(latestMonth?: MonthKey) {
  const wb = buildWorkbook(latestMonth);
  XLSX.writeFile(wb, latestMonth ? 'Transit-Dashboard-Sample.xlsx' : 'Transit-Dashboard-Template.xlsx');
}
