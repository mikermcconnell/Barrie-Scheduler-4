import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSTREETSCSV } from '../functions/src/parser';
import {
  parseSTREETSFile,
  parseRow,
  serializeSTREETSRecordsToCSV,
} from '../utils/performanceDataParser';

function buildWorkbookRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    VehicleLocationTPKey: 123,
    VehicleID: 'Bus 1',
    InBetween: 'N',
    IsTripper: 'Y',
    Date: 46023,
    Month: '2026-01',
    Day: 'TUESDAY',
    ArrivalTime: '08:00',
    ObservedArrivalTime: '08:01:02',
    StopTime: '08:00',
    ObservedDepartureTime: '08:01:30',
    WheelchairUsageCount: 1,
    DepartureLoad: 24,
    Boardings: 3,
    Alightings: 1,
    APCSource: 1,
    Block: '10-17',
    OperatorID: 'operator-1',
    TripName: 'Trip "A", inbound',
    StopName: 'Main, at First',
    RouteName: 'NORTH LOOP',
    Branch: '10 FULL',
    RouteID: '10',
    RouteStopIndex: 4,
    StopID: '1001',
    Direction: 'N',
    IsDetour: 'N',
    StopLat: 44.389,
    StopLon: -79.69,
    TimePoint: 'Y',
    Distance: 1.25,
    PreviousStopName: 'Previous Stop',
    TripID: 'trip-1',
    InternalTripID: 99,
    TerminalDepartureTime: '08:00',
    ...overrides,
  };
}

describe('Excel performance import server handoff', () => {
  it('preserves the first worksheet record through browser and server parsing', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([buildWorkbookRow()]), 'STREETS');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Not: 'STREETS data' }]), 'Notes');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([bytes], 'streets.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes,
    });
    const browserResult = await parseSTREETSFile(file);
    const browserRecord = browserResult.records[0];
    expect(browserResult.records).toHaveLength(1);
    expect(browserRecord.date).toBe('2026-01-01');

    const csv = serializeSTREETSRecordsToCSV([browserRecord]);
    const serverResult = parseSTREETSCSV(csv);

    expect(serverResult.warnings).toEqual([]);
    expect(serverResult.records).toEqual(browserResult.records);
  });

  it('keeps generated CSV records on one physical line', () => {
    const browserRecord = parseRow(buildWorkbookRow({ StopName: 'Main\nTerminal' }), 2);
    const csv = serializeSTREETSRecordsToCSV([browserRecord!]);

    expect(csv.split('\n')).toHaveLength(2);
    expect(parseSTREETSCSV(csv).records[0].stopName).toBe('Main Terminal');
  });
});
