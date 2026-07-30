import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDocMock = vi.fn();
const runTransactionMock = vi.fn();
const uploadBytesMock = vi.fn();
const getBytesMock = vi.fn();
const getDownloadURLMock = vi.fn();
const deleteObjectMock = vi.fn();

vi.mock('../utils/firebase', () => ({
    db: { kind: 'db' },
    storage: { kind: 'storage' },
}));

vi.mock('firebase/firestore', () => {
    class MockTimestamp {}

    return {
        collection: vi.fn((...args: unknown[]) => ({ kind: 'collection', args })),
        doc: vi.fn((...args: unknown[]) => {
            const id = args.length >= 2 ? String(args[args.length - 1]) : 'generated-project';
            return { kind: 'doc', id, args };
        }),
        getDoc: (...args: unknown[]) => getDocMock(...args),
        getDocs: vi.fn(),
        deleteDoc: vi.fn(),
        query: vi.fn((...args: unknown[]) => ({ kind: 'query', args })),
        orderBy: vi.fn((...args: unknown[]) => ({ kind: 'orderBy', args })),
        runTransaction: (...args: unknown[]) => runTransactionMock(...args),
        deleteField: vi.fn(() => 'DELETE_FIELD'),
        serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
        Timestamp: MockTimestamp,
    };
});

vi.mock('firebase/storage', () => ({
    ref: vi.fn((_: unknown, path: string) => ({ path })),
    uploadBytes: (...args: unknown[]) => uploadBytesMock(...args),
    getBytes: (...args: unknown[]) => getBytesMock(...args),
    getDownloadURL: (...args: unknown[]) => getDownloadURLMock(...args),
    deleteObject: (...args: unknown[]) => deleteObjectMock(...args),
}));

const eligibleBucket = {
    timeBucket: '06:30 - 06:59',
    totalP50: 20,
    totalP80: 24,
    assignedBand: 'A',
    ignored: false,
    isOutlier: false,
    expectedSegmentCount: 1,
    observedSegmentCount: 1,
    sampleCountMode: 'observations',
    details: [{ segmentName: 'A to B', p50: 20, p80: 24, n: 10 }],
    evidence: {
        kind: 'uploaded-percentiles',
        qualifyingCount: 10,
        requiredCount: 10,
        planningEligible: true,
        exclusionReasons: [] as string[],
    },
};

const validContract: any = {
    schemaVersion: 2,
    routeIdentity: '8-Weekday',
    routeNumber: '8',
    dayType: 'Weekday',
    importMode: 'performance',
    inputFingerprint: 'fingerprint',
    approvalState: 'approved',
    readinessStatus: 'ready',
    approvedAt: '2026-07-29T12:00:00.000Z',
    sourceSnapshot: {},
    planning: {
        reviewBuckets: [eligibleBucket],
        approvedBuckets: [eligibleBucket],
        buckets: [eligibleBucket],
        bands: [{ id: 'A' }],
        directionBandSummary: { North: [{ bandId: 'A' }] },
        canonicalDirectionStops: { North: ['A', 'B'] },
        segmentColumns: [{ segmentName: 'A to B', direction: 'North' }],
        directions: ['North'],
        usableBucketCount: 1,
        ignoredBucketCount: 0,
        usableBandCount: 1,
    },
    healthSnapshot: {
        status: 'ready', blockers: [], warnings: [], expectedDirections: 1,
        matchedDirections: ['North'], expectedSegmentCount: 1, matchedSegmentCount: 1,
        missingSegments: [], availableBucketCount: 1, completeBucketCount: 1,
        coverageCompleteBucketCount: 1, trustedReadyBucketCount: 1,
        incompleteBucketCount: 0, lowConfidenceBucketCount: 0,
        runtimeSourceSummary: 'uploaded percentile observations', confidenceThreshold: 10,
        usesLegacyRuntimeLogic: false,
    },
};

const snapshot = (data: Record<string, unknown> | null, id = 'project-1') => ({
    exists: () => data !== null,
    id,
    data: () => data ?? {},
});

describe('newScheduleProjectService', () => {
    beforeEach(() => {
        getDocMock.mockReset();
        runTransactionMock.mockReset();
        uploadBytesMock.mockReset();
        getBytesMock.mockReset();
        getDownloadURLMock.mockReset();
        deleteObjectMock.mockReset();
        uploadBytesMock.mockResolvedValue(undefined);
        deleteObjectMock.mockResolvedValue(undefined);
        getBytesMock.mockImplementation(async () => {
            const bytes = uploadBytesMock.mock.calls.at(-1)?.[1] as Uint8Array | undefined;
            return bytes?.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) ?? new ArrayBuffer(0);
        });
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('deeply validates approved buckets, canonical stops, and planning counts', async () => {
        const { isStructurallyValidRuntimeTrustContract } = await import(
            '../utils/services/newScheduleProjectService'
        );
        expect(isStructurallyValidRuntimeTrustContract(validContract)).toBe(true);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            planning: {
                ...validContract.planning,
                approvedCycleBucketsByStartDirection: { South: [eligibleBucket] },
            },
        })).toBe(true);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            planning: {
                ...validContract.planning,
                approvedCycleBucketsByStartDirection: { East: [eligibleBucket] },
            },
        })).toBe(false);
        const earlierV2Health = { ...validContract.healthSnapshot };
        delete earlierV2Health.coverageCompleteBucketCount;
        delete earlierV2Health.trustedReadyBucketCount;
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            healthSnapshot: earlierV2Health,
        })).toBe(true);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            planning: { ...validContract.planning, approvedBuckets: [], usableBucketCount: 0 },
        })).toBe(false);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            planning: { ...validContract.planning, canonicalDirectionStops: { North: ['A'] } },
        })).toBe(false);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            planning: {
                ...validContract.planning,
                approvedBuckets: [{
                    ...eligibleBucket,
                    evidence: {
                        ...eligibleBucket.evidence,
                        qualifyingCount: 1,
                        planningEligible: true,
                    },
                }],
            },
        })).toBe(false);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            planning: { ...validContract.planning, usableBandCount: 2 },
        })).toBe(false);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            planning: { ...validContract.planning, segmentColumns: undefined },
        })).toBe(false);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            healthSnapshot: { ...validContract.healthSnapshot, trustedReadyBucketCount: '1' },
        })).toBe(false);
        expect(isStructurallyValidRuntimeTrustContract({
            ...validContract,
            sourceSnapshot: { performanceDateRange: { start: '2026-01-01' } },
        })).toBe(false);
    });

    it('writes schema-v2 trust markers and deletes the old blob only after the transaction commits', async () => {
        const oldPath = 'users/user-1/newScheduleProjects/old.json';
        getDocMock.mockResolvedValue(snapshot({ storagePath: oldPath, projectRevision: 3 }));
        let committedData: Record<string, unknown> | undefined;
        runTransactionMock.mockImplementation(async (_db, callback) => callback({
            get: async () => snapshot({ storagePath: oldPath, projectRevision: 3 }),
            set: (_ref: unknown, data: Record<string, unknown>) => { committedData = data; },
        }));

        const { saveProject } = await import('../utils/services/newScheduleProjectService');
        await saveProject('user-1', {
            id: 'project-1',
            name: 'Project 1',
            dayType: 'Weekday',
            approvedRuntimeContract: validContract as never,
            isGenerated: false,
        }, { expectedRevision: 3 });

        expect(committedData).toMatchObject({
            projectRevision: 4,
            runtimeTrustSchemaVersion: 2,
            runtimeTrustMigrationVersion: 2,
        });
        expect(deleteObjectMock).toHaveBeenLastCalledWith({ path: oldPath });
        expect(runTransactionMock.mock.invocationCallOrder[0])
            .toBeLessThan(deleteObjectMock.mock.invocationCallOrder.at(-1) as number);
    });

    it('deletes an uncommitted upload and keeps the active blob after a concurrent edit', async () => {
        const oldPath = 'users/user-1/newScheduleProjects/old.json';
        getDocMock.mockResolvedValue(snapshot({ storagePath: oldPath, projectRevision: 3 }));
        runTransactionMock.mockImplementation(async (_db, callback) => callback({
            get: async () => snapshot({ storagePath: 'users/user-1/newScheduleProjects/newer.json', projectRevision: 4 }),
            set: vi.fn(),
        }));

        const { saveProject, StaleNewScheduleProjectError } = await import('../utils/services/newScheduleProjectService');
        await expect(saveProject('user-1', {
            id: 'project-1', name: 'Project 1', dayType: 'Weekday',
            generatedSchedules: [{ routeName: '10', stops: [], stopIds: {}, trips: [] }],
            isGenerated: true,
        })).rejects.toBeInstanceOf(StaleNewScheduleProjectError);

        const deletedPaths = deleteObjectMock.mock.calls.map(([value]) => value.path);
        expect(deletedPaths).toHaveLength(1);
        expect(deletedPaths[0]).not.toBe(oldPath);
    });

    it('durably sanitizes legacy Storage while preserving settings and config', async () => {
        const oldPath = 'users/user-1/newScheduleProjects/old.json';
        const oldBytes = new TextEncoder().encode(JSON.stringify({
            analysis: [{ bucket: '10:00' }],
            generatedSchedules: [{ route: '8' }],
            config: { routeNumber: '8', recoveryTime: 5 },
            plannerNotes: 'keep this',
        }));
        getDocMock.mockResolvedValue(snapshot({ storagePath: oldPath, projectRevision: 7 }));
        getBytesMock
            .mockResolvedValueOnce(oldBytes.buffer)
            .mockImplementationOnce(async () => {
                const bytes = uploadBytesMock.mock.calls.at(-1)?.[1] as Uint8Array;
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            });
        let updateData: Record<string, unknown> | undefined;
        runTransactionMock.mockImplementation(async (_db, callback) => callback({
            get: async () => snapshot({ storagePath: oldPath, projectRevision: 7 }),
            update: (_ref: unknown, data: Record<string, unknown>) => { updateData = data; },
        }));

        const { resetLegacyRuntimeProject } = await import('../utils/services/newScheduleProjectService');
        await expect(resetLegacyRuntimeProject('user-1', 'project-1', { expectedRevision: 7 }))
            .resolves.toBe(8);

        const uploaded = JSON.parse(new TextDecoder().decode(uploadBytesMock.mock.calls[0][1]));
        expect(uploaded).toEqual({
            config: { routeNumber: '8', recoveryTime: 5 },
            plannerNotes: 'keep this',
            runtimeTrustMigrationVersion: 2,
        });
        expect(updateData).toMatchObject({
            storagePath: expect.stringContaining('_v2-reset.json'),
            projectRevision: 8,
            runtimeTrustMigrationVersion: 2,
            isGenerated: false,
        });
        expect(deleteObjectMock).toHaveBeenLastCalledWith({ path: oldPath });
    });

    it('cleans up the replacement but never the active blob when reset commit fails', async () => {
        const oldPath = 'users/user-1/newScheduleProjects/old.json';
        const oldBytes = new TextEncoder().encode(JSON.stringify({ analysis: [1], config: { routeNumber: '8' } }));
        getDocMock.mockResolvedValue(snapshot({ storagePath: oldPath, projectRevision: 2 }));
        getBytesMock
            .mockResolvedValueOnce(oldBytes.buffer)
            .mockImplementationOnce(async () => {
                const bytes = uploadBytesMock.mock.calls.at(-1)?.[1] as Uint8Array;
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            });
        runTransactionMock.mockRejectedValue(new Error('commit failed'));

        const { resetLegacyRuntimeProject } = await import('../utils/services/newScheduleProjectService');
        await expect(resetLegacyRuntimeProject('user-1', 'project-1')).rejects.toThrow('commit failed');

        const deletedPaths = deleteObjectMock.mock.calls.map(([value]) => value.path);
        expect(deletedPaths).toHaveLength(1);
        expect(deletedPaths[0]).not.toBe(oldPath);
    });

    it('returns null when a stored blob cannot be loaded', async () => {
        getDocMock.mockResolvedValue(snapshot({
            name: 'Project 1', dayType: 'Weekday', importMode: 'csv', isGenerated: true,
            storagePath: 'users/user-1/newScheduleProjects/project-1.json',
        }));
        getDownloadURLMock.mockResolvedValue('https://example.com/project-1.json');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));

        const { getProject } = await import('../utils/services/newScheduleProjectService');
        await expect(getProject('user-1', 'project-1')).resolves.toBeNull();
    });
});
