import { describe, expect, it } from 'vitest';
import {
  decodeCsvBodyText,
  mergeStoredPerformanceRuntimeMetadata,
  shouldAbortPerformanceSummaryOverwrite,
} from '../functions/src/index';

describe('functions performance ingest guards', () => {
  it('leaves plain CSV request bodies untouched', () => {
    const csv = [
      'VehicleID,RouteID,TripName,StopName,ObservedArrivalTime,TerminalDepartureTime',
      '2302,2A,2A - 07:00,Stop A,07:00:30,07:00',
    ].join('\n');

    expect(decodeCsvBodyText(csv)).toBe(csv);
  });

  it('decodes base64-encoded CSV request bodies', () => {
    const csv = [
      'VehicleID,RouteID,TripName,StopName,ObservedArrivalTime,TerminalDepartureTime',
      '2302,2A,2A - 07:00,Stop A,07:00:30,07:00',
    ].join('\n');
    const encoded = Buffer.from(csv, 'utf-8').toString('base64');

    expect(decodeCsvBodyText(encoded)).toBe(csv);
  });

  it('prefers Firestore runtime metadata over older stored summary metadata', () => {
    const merged = mergeStoredPerformanceRuntimeMetadata(
      {
        runtimeLogicVersion: 2,
      },
      {
        runtimeLogicVersion: 3,
        cleanHistoryStartDate: '2026-03-22',
      },
    );

    expect(merged.runtimeLogicVersion).toBe(3);
    expect(merged.cleanHistoryStartDate).toBe('2026-03-22');
  });

  it('blocks overwriting when metadata points to stored history but the summary could not be read', () => {
    expect(shouldAbortPerformanceSummaryOverwrite('teams/team-1/performanceData/latest.json', null)).toBe(true);
    expect(shouldAbortPerformanceSummaryOverwrite(null, null)).toBe(false);
  });
});
