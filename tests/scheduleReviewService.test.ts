import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterScheduleContent } from '../utils/masterScheduleTypes';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';

const {
  collectionMock,
  docMock,
  getDocMock,
  getDocsMock,
  limitMock,
  orderByMock,
  queryMock,
  serverTimestampMock,
  setDocMock,
  updateDocMock,
  storageRefMock,
  uploadBytesMock,
  deleteObjectMock,
  getBytesMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  docMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  limitMock: vi.fn(),
  orderByMock: vi.fn(),
  queryMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
  setDocMock: vi.fn(),
  updateDocMock: vi.fn(),
  storageRefMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  getBytesMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: docMock,
  getDoc: getDocMock,
  getDocs: getDocsMock,
  limit: limitMock,
  orderBy: orderByMock,
  query: queryMock,
  serverTimestamp: serverTimestampMock,
  setDoc: setDocMock,
  updateDoc: updateDocMock,
}));

vi.mock('firebase/storage', () => ({
  deleteObject: deleteObjectMock,
  getBytes: getBytesMock,
  ref: storageRefMock,
  uploadBytes: uploadBytesMock,
}));

vi.mock('../utils/firebase', () => ({
  db: { name: 'db' },
  storage: { name: 'storage' },
}));

import {
  buildScheduleReviewSummary,
  createScheduleReview,
  loadScheduleReviewPayload,
  updateScheduleReviewStatus,
} from '../utils/services/scheduleReviewService';

const makeTrip = (id: string, startTime: number, flags: Partial<MasterTrip> = {}): MasterTrip => ({
  id,
  blockId: '10-1',
  direction: 'North' as const,
  tripNumber: 1,
  rowId: 1,
  startTime,
  endTime: startTime + 30,
  recoveryTime: 5,
  travelTime: 30,
  cycleTime: 35,
  stops: { Terminal: '6:00 AM' },
  arrivalTimes: { Terminal: '6:00 AM' },
  stopMinutes: { Terminal: startTime },
  ...flags,
});

const makeSchedule = (trip = makeTrip('trip-1', 360)): MasterScheduleContent => ({
  northTable: {
    routeName: '10 (Weekday) (North)',
    stops: ['Terminal'],
    stopIds: { Terminal: '1' },
    trips: [trip],
  },
  southTable: {
    routeName: '10 (Weekday) (South)',
    stops: ['Terminal'],
    stopIds: { Terminal: '1' },
    trips: [],
  },
  metadata: { routeNumber: '10', dayType: 'Weekday' as const, uploadedAt: '2026-07-15T00:00:00Z' },
});

describe('scheduleReviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectionMock.mockReturnValue({ path: 'teams/team-1/scheduleReviews' });
    docMock.mockImplementation((...args: unknown[]) => ({
      id: args.length === 1 ? 'review-1' : String(args.at(-1)),
      path: args.length === 1
        ? 'teams/team-1/scheduleReviews/review-1'
        : args.map(String).join('/'),
    }));
    storageRefMock.mockImplementation((_storage: unknown, path: string) => ({ path }));
    uploadBytesMock.mockResolvedValue(undefined);
    deleteObjectMock.mockResolvedValue(undefined);
    setDocMock.mockResolvedValue(undefined);
    updateDocMock.mockResolvedValue(undefined);
  });

  it('builds a deterministic bounded summary from the schedule and source', () => {
    const source = makeSchedule(makeTrip('source-trip', 360));
    const current = makeSchedule(makeTrip('current-trip', 365, { isOverlap: true, isTightRecovery: true }));

    const first = buildScheduleReviewSummary(current as any, source as any);
    const second = buildScheduleReviewSummary(current as any, source as any);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      totalTrips: 1,
      overlapTrips: 1,
      tightRecoveryTrips: 1,
      blockingIssueCount: 1,
    });
    expect(first.totalChanges).toBe(
      first.addedTrips + first.removedTrips + first.retimedTrips +
      first.extendedTrips + first.shortenedTrips + first.reviewNeededTrips,
    );
  });

  it('uploads an immutable team-scoped payload before writing bounded metadata', async () => {
    const schedule = makeSchedule();
    const result = await createScheduleReview({
      teamId: 'team-1',
      userId: 'planner-1',
      plannerName: 'Transit Planner',
      routeNumber: '10',
      dayType: 'Weekday',
      draftId: 'draft-1',
      sourceVersion: 12,
      plannerNote: 'Review the PM recovery change.',
      schedule: schedule as any,
      sourceSchedule: schedule as any,
    });

    const expectedPath = 'teams/team-1/scheduleReviews/review-1/planner-1/schedule.json';
    const [, uploadedPayload, uploadMetadata] = uploadBytesMock.mock.calls[0];
    expect(uploadBytesMock).toHaveBeenCalledOnce();
    expect(uploadBytesMock.mock.calls[0][0]).toEqual({ path: expectedPath });
    expect(ArrayBuffer.isView(uploadedPayload)).toBe(true);
    expect(uploadedPayload.constructor.name).toBe('Uint8Array');
    expect(uploadMetadata).toEqual({ contentType: 'application/json' });
    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'review-1' }),
      expect.objectContaining({
        teamId: 'team-1',
        draftId: 'draft-1',
        sourceVersion: 12,
        status: 'ready_for_review',
        storagePath: expectedPath,
        createdBy: 'planner-1',
      }),
    );
    expect(result.id).toBe('review-1');
    expect(result.storagePath).toBe(expectedPath);
  });

  it('cleans up an orphaned upload when the metadata write fails', async () => {
    setDocMock.mockRejectedValueOnce(new Error('permission denied'));

    await expect(createScheduleReview({
      teamId: 'team-1', userId: 'planner-1', plannerName: 'Planner', routeNumber: '10',
      dayType: 'Weekday', draftId: 'draft-1', sourceVersion: 1, schedule: makeSchedule() as any,
    })).rejects.toThrow('permission denied');

    expect(deleteObjectMock).toHaveBeenCalledWith({
      path: 'teams/team-1/scheduleReviews/review-1/planner-1/schedule.json',
    });
  });

  it('loads only a payload whose immutable identity matches its metadata', async () => {
    const payload = {
      schemaVersion: 1,
      reviewId: 'review-1',
      teamId: 'team-1',
      createdBy: 'planner-1',
      routeNumber: '10',
      dayType: 'Weekday',
      draftId: 'draft-1',
      sourceVersion: 12,
      summary: buildScheduleReviewSummary(makeSchedule() as any),
      schedule: makeSchedule(),
    };
    const encodedPayload = new TextEncoder().encode(JSON.stringify(payload));
    const reorderedSummary = Object.fromEntries(Object.entries(payload.summary).reverse()) as typeof payload.summary;
    getBytesMock.mockResolvedValue(encodedPayload.buffer);

    const loaded = await loadScheduleReviewPayload({
      id: 'review-1',
      teamId: 'team-1',
      createdBy: 'planner-1',
      storagePath: 'teams/team-1/scheduleReviews/review-1/planner-1/schedule.json',
      payloadBytes: encodedPayload.byteLength,
      routeNumber: '10',
      dayType: 'Weekday',
      draftId: 'draft-1',
      sourceVersion: 12,
      summary: reorderedSummary,
    });

    expect(loaded.reviewId).toBe('review-1');
    expect(getBytesMock).toHaveBeenCalledWith(
      { path: 'teams/team-1/scheduleReviews/review-1/planner-1/schedule.json' },
      10 * 1024 * 1024,
    );
  });

  it('writes only manager-review status fields through the status API', async () => {
    await updateScheduleReviewStatus({
      teamId: 'team-1',
      reviewId: 'review-1',
      reviewerId: 'manager-1',
      status: 'approved',
    });

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'review-1' }),
      {
        status: 'approved',
        reviewedBy: 'manager-1',
        reviewedAt: 'server-timestamp',
        updatedAt: 'server-timestamp',
      },
    );
  });
});
