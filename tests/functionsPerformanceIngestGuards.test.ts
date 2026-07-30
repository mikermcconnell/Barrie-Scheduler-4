import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  decodeCsvBodyText,
  mergeStoredPerformanceRuntimeMetadata,
  shouldAbortPerformanceSummaryOverwrite,
} from '../functions/src/index';

describe('functions performance ingest guards', () => {
  it('requires manager or active support-edit authorization for bearer imports', () => {
    const source = readFileSync('functions/src/index.ts', 'utf8');
    const guard = source.match(/async function resolvePerformanceIngestActor[\s\S]*?\n\}/)?.[0] ?? '';

    expect(guard).toContain("role === 'owner' || role === 'admin'");
    expect(guard).toContain("support?.mode === 'edit'");
    expect(guard).toContain('expiresAtMs > Date.now()');
    expect(source).toContain('const importedBy = await resolvePerformanceIngestActor(req, teamId)');
    expect(source).toContain('importedBy,');
  });

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
