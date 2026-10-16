import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseNumber, parseWorkbook, toPercent } from '../src/lib/importWorkbook';
import { addMonths, parseMonth } from '../src/lib/months';
import { buildWorkbook } from '../src/lib/template';

function workbook(sheets: Record<string, unknown[][]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return wb;
}

/** Round-trips through real .xlsx bytes, as a file picked from disk would. */
const throughFile = (wb: XLSX.WorkBook) => XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });

describe('parseMonth', () => {
  it.each([
    ['2026-09', '2026-09'],
    ['2026-09-01', '2026-09'],
    ['2026/9', '2026-09'],
    ['Sep 2026', '2026-09'],
    ['September 2026', '2026-09'],
    ['Sep-26', '2026-09'],
    ['9/1/2026', '2026-09'],
    ['25/09/2026', '2026-09'],
    [46266, '2026-09'], // Excel serial for 2026-09-01
    [46295.75, '2026-09'], // 2026-09-30 18:00
  ])('reads %s', (input, expected) => {
    expect(parseMonth(input)).toBe(expected);
  });

  it.each([['Total'], [''], [null], ['2026-13'], ['Smarch 2026']])('rejects %s', (input) => {
    expect(parseMonth(input)).toBeNull();
  });

  it('steps across year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-09', -12)).toBe('2025-09');
  });
});

describe('number cells', () => {
  it('strips currency, commas and percent signs', () => {
    expect(parseNumber('$1,234.50')?.value).toBe(1234.5);
    expect(parseNumber('(250)')?.value).toBe(-250);
    expect(parseNumber('84.3%')).toEqual({ value: 84.3, percentSign: true });
    expect(parseNumber('n/a')?.value).toBeNull();
    expect(parseNumber('lots')).toBeUndefined();
  });

  it('treats Excel percent fractions and whole percents alike', () => {
    expect(toPercent({ value: 0.843, percentSign: false })).toBe(84.3);
    expect(toPercent({ value: 84.3, percentSign: false })).toBe(84.3);
    expect(toPercent({ value: 84.3, percentSign: true })).toBe(84.3);
  });
});

describe('parseWorkbook', () => {
  const system = [
    ['Month', 'Boardings', 'Revenue Hours', 'Scheduled Trips', 'Trips Operated', 'On-Time %', 'Fare Revenue', 'Operating Cost', 'Complaints'],
    ['2026-08', '362,000', 16800, 17400, 17390, 0.861, 610000, 2150000, 35],
    ['Sep 2026', 412850, 17140, 18320, 18306, '84.3%', 695000, 2210000, 52],
    ['Total', 774850, 33940, null, null, null, null, null, null],
  ];

  it('reads all four sheets with flexible headers', () => {
    const wb = workbook({
      'system monthly': system,
      Routes: [
        ['Month', 'Route #', 'Route Name', 'Ridership', 'Rev Hours', 'OTP'],
        ['2026-09', '8A', 'RVH / Georgian College', 58420, 1739, 81.2],
      ],
      Targets: [
        ['Measure', 'Target'],
        ['On-Time %', 0.85],
        ['Boardings per Revenue Hour', 22],
        ['Annual Boardings', 4400000],
        ['Parking spaces', 12],
      ],
      Notes: [['Month', 'Title', 'Detail'], ['', 'Standing note', 'Shows every month'], ['2026-09', 'Construction', 'Duckworth St']],
    });
    const result = parseWorkbook(throughFile(wb), 'sept.xlsx');

    expect(result.errors).toEqual([]);
    const data = result.data!;
    expect(data.system.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(data.system[0]).toMatchObject({ boardings: 362000, onTimePct: 86.1 });
    expect(data.system[1]).toMatchObject({ boardings: 412850, onTimePct: 84.3, tripsOperated: 18306 });
    // "Route #" normalises to "route"; "Ridership", "Rev Hours" and "OTP" are aliases.
    expect(data.routes).toEqual([
      { month: '2026-09', route: '8A', routeName: 'RVH / Georgian College', boardings: 58420, revenueHours: 1739, onTimePct: 81.2 },
    ]);
    expect(data.targets).toEqual({ onTimePct: 85, boardingsPerRevenueHour: 22, annualBoardings: 4400000 });
    expect(data.notes).toEqual([
      { month: null, title: 'Standing note', detail: 'Shows every month' },
      { month: '2026-09', title: 'Construction', detail: 'Duckworth St' },
    ]);
    // The "Total" row is skipped silently; the unknown target is reported.
    expect(result.warnings).toEqual([expect.stringContaining('"Parking spaces" is not a known measure')]);
  });

  it('finds a header row below a title block', () => {
    const wb = workbook({ 'System Monthly': [['Barrie Transit monthly stats'], [], ...system] });
    expect(parseWorkbook(wb, 'x.xlsx').data?.system).toHaveLength(2);
  });

  it('treats a single-sheet CSV as the System Monthly sheet', () => {
    const csv = 'Month,Boardings,Revenue Hours\n2026-09-01,412850,17140\n';
    const result = parseWorkbook(XLSX.read(csv, { type: 'string' }), 'sept.csv');
    expect(result.data?.system[0]).toMatchObject({ month: '2026-09', boardings: 412850, revenueHours: 17140, onTimePct: null });
    expect(result.warnings.some((w) => w.includes('no Scheduled Trips'))).toBe(true);
  });

  it('keeps the last row when a month repeats and says so', () => {
    const wb = workbook({ 'System Monthly': [system[0], ['2026-09', 1], ['2026-09', 2]] });
    const result = parseWorkbook(wb, 'x.xlsx');
    expect(result.data?.system).toEqual([expect.objectContaining({ month: '2026-09', boardings: 2 })]);
    expect(result.warnings).toContainEqual(expect.stringContaining('appears more than once'));
  });

  it('reports bad cells without dropping the row', () => {
    const wb = workbook({ 'System Monthly': [system[0], ['2026-09', 'about 400k', 17140], ['not a month', 1, 1]] });
    const result = parseWorkbook(wb, 'x.xlsx');
    expect(result.data?.system).toEqual([expect.objectContaining({ month: '2026-09', boardings: null, revenueHours: 17140 })]);
    expect(result.warnings).toContainEqual(expect.stringContaining('row 2: Boardings "about 400k" is not a number'));
    expect(result.warnings).toContainEqual(expect.stringContaining('row 3: "not a month" is not a month'));
  });

  it('rejects a workbook without the system sheet or its required columns', () => {
    const noSheet = workbook({ Routes: [['Month']], Other: [['x']] });
    expect(parseWorkbook(noSheet, 'x.xlsx')).toMatchObject({ data: null, errors: [expect.stringContaining('No "System Monthly" sheet')] });

    const noColumns = workbook({ 'System Monthly': [['Period', 'Riders?']] });
    expect(parseWorkbook(noColumns, 'x.xlsx')).toMatchObject({ data: null, errors: [expect.stringContaining('needs a header row')] });
  });

  it('does not let a broken Routes sheet block the report', () => {
    const wb = workbook({ 'System Monthly': system, Routes: [['Something else']] });
    const result = parseWorkbook(wb, 'x.xlsx');
    expect(result.data?.routes).toEqual([]);
    expect(result.warnings).toContainEqual(expect.stringContaining('Route table left empty'));
  });

  it('reads back its own template and sample workbook', () => {
    const blank = parseWorkbook(throughFile(buildWorkbook()), 'template.xlsx');
    expect(blank.errors).toEqual([expect.stringContaining('no monthly rows')]);

    const sample = parseWorkbook(throughFile(buildWorkbook('2026-09')), 'sample.xlsx', true);
    expect(sample.errors).toEqual([]);
    expect(sample.warnings).toEqual([]);
    const data = sample.data!;
    expect(data.system).toHaveLength(24);
    expect(data.system[0].month).toBe('2024-10');
    expect(data.system[23].month).toBe('2026-09');
    expect(new Set(data.routes.map((r) => r.month)).size).toBe(13);
    expect(data.targets.onTimePct).toBe(85);
    expect(data.targets.costPerBoarding).toBe(7);
    expect(data.notes).toHaveLength(2);
  });
});
