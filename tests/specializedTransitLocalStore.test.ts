import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  clearLocalSpecializedTransit,
  accessLocalSpecializedTransitReports,
  loadLocalSpecializedTransit,
  saveLocalSpecializedTransit,
} from '../utils/specialized-transit/localStore';

const sha256 = 'a'.repeat(64);

function aggregateInput(expectedRevision = 0) {
  return {
    teamId: 'team-a',
    userId: 'manager-1',
    expectedRevision,
    months: {
      '2026-08': {
        reportMonth: '2026-08',
        reportedTrips: 100,
        priorYearPercent: 96,
        commonLocationBookings: 80,
        commonLocationCoverage: 0.8,
        reconciliationGap: 20,
        reconciliationStatus: 'partial-common-location' as const,
        reconciliationNote: 'Common-location export is a subset of the reported monthly total.',
        serviceDateRange: { start: '2026-08-01', end: '2026-08-31' },
        dailyTotals: { '2026-08-01': 80 },
        hourlyTotals: { '8': 80 },
        activityBuckets: [{ date: '2026-08-01', hour: 8, locationId: 'st-test', pickups: 40, dropoffs: 40 }],
        recurringDemand: {
          distinctClientIds: 20,
          medianBookingsPerClient: 4,
          thresholds: [{ minimumBookings: 4, clientCount: 10, bookingCount: 60, bookingShare: 0.75 }],
        },
        sources: {
          monthlyReport: { sha256, pageCount: 1 },
          commonLocationsReport: { sha256, pageCount: 2 },
        },
        importedAt: '2026-09-01T18:00:00.000Z',
        importedBy: 'manager-1',
      },
    },
    locations: {
      'st-test': {
        id: 'st-test',
        displayName: 'Test Location',
        normalizedName: 'test location',
        aliases: ['Test Location'],
        latitude: 44.38,
        longitude: -79.69,
        status: 'reviewed' as const,
        coordinateSource: 'manual' as const,
        relevance: 1,
      },
    },
  };
}

describe('Specialized Transit local browser storage', () => {
  it('restores saved file bytes after reopening and isolates users and teams', async () => {
    const indexedDb = new IDBFactory();
    const reports = {
      monthly: { name: 'monthly.pdf', type: 'application/pdf', lastModified: 123, bytes: new TextEncoder().encode('monthly pdf').buffer },
      common: { name: 'locations.pdf', type: 'application/pdf', lastModified: 456, bytes: new TextEncoder().encode('locations pdf').buffer },
    };
    await saveLocalSpecializedTransit(aggregateInput(), indexedDb);
    await accessLocalSpecializedTransitReports('team-a', 'manager-1', 'save', reports, indexedDb);
    const restored = await accessLocalSpecializedTransitReports('team-a', 'manager-1', 'load', undefined, indexedDb);
    expect(restored).toEqual(reports);
    expect(new TextDecoder().decode(restored!.common.bytes)).toBe('locations pdf');
    expect(await accessLocalSpecializedTransitReports('team-a', 'manager-2', 'load', undefined, indexedDb)).toBeNull();
    expect(await accessLocalSpecializedTransitReports('team-b', 'manager-1', 'load', undefined, indexedDb)).toBeNull();
    await accessLocalSpecializedTransitReports('team-a', 'manager-1', 'clear', undefined, indexedDb);
    expect(await accessLocalSpecializedTransitReports('team-a', 'manager-1', 'load', undefined, indexedDb)).toBeNull();
    expect((await loadLocalSpecializedTransit('team-a', indexedDb))?.dataset.revision).toBe(1);
  });

  it('saves, restores, revises, and clears a team-local aggregate', async () => {
    const indexedDb = new IDBFactory();
    const first = await saveLocalSpecializedTransit(aggregateInput(), indexedDb);
    expect(first.dataset.revision).toBe(1);
    expect(first.metadata.storagePath).toBe('local-specialized-transit://team-a/revision-1');

    const restored = await loadLocalSpecializedTransit('team-a', indexedDb);
    expect(restored?.dataset.months['2026-08'].reportedTrips).toBe(100);
    expect(restored?.metadata.activeRevision).toBe(1);

    const revised = await saveLocalSpecializedTransit(aggregateInput(1), indexedDb);
    expect(revised.dataset.revision).toBe(2);
    await expect(saveLocalSpecializedTransit(aggregateInput(0), indexedDb)).rejects.toThrow(/changed/i);

    expect(await clearLocalSpecializedTransit('team-a', indexedDb)).toBe(true);
    expect(await loadLocalSpecializedTransit('team-a', indexedDb)).toBeNull();
  });

  it('does not fall back to a remote store when IndexedDB is unavailable', async () => {
    expect(await loadLocalSpecializedTransit('team-a', undefined)).toBeNull();
  });
});
