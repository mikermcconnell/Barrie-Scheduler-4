import { describe, expect, it, vi } from 'vitest';
import {
    assertApplyProjectConfirmation,
    isStructurallyValidV2Contract,
    migrateNewScheduleRuntimeProjects,
    needsRuntimeTrustMigration,
    sanitizeStoredWizardContent,
} from '../functions/scripts/migrate-new-schedule-runtime-v2.mjs';

const timestamp = (value: number) => ({ toMillis: () => value });

describe('New Schedule runtime v2 migration', () => {
    const eligibleBucket = {
        timeBucket: '06:30 - 06:59', totalP50: 20, totalP80: 24,
        assignedBand: 'A', ignored: false, isOutlier: false,
        expectedSegmentCount: 1, observedSegmentCount: 1,
        sampleCountMode: 'observations',
        details: [{ segmentName: 'A to B', p50: 20, p80: 24, n: 10 }],
        evidence: {
            kind: 'uploaded-percentiles', qualifyingCount: 10, requiredCount: 10,
            planningEligible: true, exclusionReasons: [] as string[],
        },
    };
    const validV2Contract: any = {
        schemaVersion: 2,
        approvalState: 'approved',
        inputFingerprint: 'fingerprint',
        routeIdentity: '8-Weekday',
        routeNumber: '8',
        dayType: 'Weekday',
        importMode: 'performance',
        readinessStatus: 'ready',
        sourceSnapshot: {},
        planning: {
            reviewBuckets: [eligibleBucket], approvedBuckets: [eligibleBucket], buckets: [eligibleBucket],
            bands: [{ id: 'A' }], directionBandSummary: { North: [{ bandId: 'A' }] },
            canonicalDirectionStops: { North: ['A', 'B'] }, directions: ['North'],
            segmentColumns: [{ segmentName: 'A to B', direction: 'North' }],
            usableBucketCount: 1, ignoredBucketCount: 0, usableBandCount: 1,
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

    it('removes only derived runtime and schedule artifacts', () => {
        expect(sanitizeStoredWizardContent({
            parsedData: [1], analysis: [2], bands: [3], generatedSchedules: [4],
            approvedRuntimeContract: { schemaVersion: 1 },
            config: { routeNumber: '12' }, performanceConfig: { routeId: '12' },
        })).toEqual({
            config: { routeNumber: '12' },
            performanceConfig: { routeId: '12' },
        });
    });

    it('preserves structurally valid v2 contracts even without a marker', () => {
        expect(isStructurallyValidV2Contract(validV2Contract)).toBe(true);
        const earlierV2Health = { ...validV2Contract.healthSnapshot };
        delete earlierV2Health.coverageCompleteBucketCount;
        delete earlierV2Health.trustedReadyBucketCount;
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            healthSnapshot: earlierV2Health,
        })).toBe(true);
        expect(needsRuntimeTrustMigration({ approvedRuntimeContract: validV2Contract })).toBe(false);
        expect(needsRuntimeTrustMigration({}, { approvedRuntimeContract: validV2Contract })).toBe(false);
    });

    it('rejects empty approvals, malformed stops, stale counts, and forged eligibility', () => {
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            planning: { ...validV2Contract.planning, approvedBuckets: [], usableBucketCount: 0 },
        })).toBe(false);
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            planning: { ...validV2Contract.planning, canonicalDirectionStops: { North: ['A', ''] } },
        })).toBe(false);
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            planning: { ...validV2Contract.planning, usableBucketCount: 2 },
        })).toBe(false);
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            planning: {
                ...validV2Contract.planning,
                approvedBuckets: [{
                    ...eligibleBucket,
                    details: [{ ...eligibleBucket.details[0], n: 1 }],
                    evidence: { ...eligibleBucket.evidence, planningEligible: true },
                }],
            },
        })).toBe(false);
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            planning: { ...validV2Contract.planning, segmentColumns: [{ segmentName: '' }] },
        })).toBe(false);
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            healthSnapshot: undefined,
        })).toBe(false);
        expect(isStructurallyValidV2Contract({
            ...validV2Contract,
            sourceSnapshot: [],
        })).toBe(false);
    });

    it('does not let a migration marker bless legacy active content', () => {
        expect(needsRuntimeTrustMigration({ runtimeTrustMigrationVersion: 2, analysis: [1] })).toBe(true);
        expect(needsRuntimeTrustMigration({ analysis: [1] })).toBe(true);
        expect(needsRuntimeTrustMigration({ analysis: [] }, { analysis: [1] })).toBe(true);
        expect(needsRuntimeTrustMigration({ runtimeTrustMigrationVersion: 2 })).toBe(false);
    });

    it('requires explicit matching project confirmation before apply', () => {
        expect(() => assertApplyProjectConfirmation({ apply: false })).not.toThrow();
        expect(() => assertApplyProjectConfirmation({
            apply: true, explicitProjectId: 'prod', confirmedProjectId: 'other',
        })).toThrow(/matching --project/);
        expect(() => assertApplyProjectConfirmation({
            apply: true, explicitProjectId: 'prod', confirmedProjectId: 'prod',
        })).not.toThrow();
    });

    it('supports dry-run, apply, and concurrent-edit skipping', async () => {
        const updates: unknown[] = [];
        const makeDb = (currentTime: number) => {
            const ref = { path: 'users/u1/newScheduleProjects/p1' };
            const project = {
                id: 'p1', ref, updateTime: timestamp(10),
                data: () => ({ analysis: [{ bucket: '10:00' }], isGenerated: true }),
            };
            return {
                collectionGroup: () => ({ get: async () => ({ docs: [project] }) }),
                runTransaction: async (callback: (tx: unknown) => Promise<void>) => callback({
                    get: async () => ({ exists: true, updateTime: timestamp(currentTime) }),
                    update: (_ref: unknown, data: unknown) => updates.push(data),
                }),
            };
        };
        const bucket = { file: () => { throw new Error('No storage access expected'); } };

        await expect(migrateNewScheduleRuntimeProjects({ db: makeDb(10), bucket, apply: false }))
            .resolves.toMatchObject({ scanned: 1, changed: 1, skipped: 0, failed: 0 });
        await expect(migrateNewScheduleRuntimeProjects({ db: makeDb(10), bucket, apply: true }))
            .resolves.toMatchObject({ scanned: 1, changed: 1, skipped: 0, failed: 0 });
        expect(updates).toHaveLength(1);
        await expect(migrateNewScheduleRuntimeProjects({ db: makeDb(11), bucket, apply: true }))
            .resolves.toMatchObject({ scanned: 1, changed: 0, skipped: 1, failed: 0 });
    });

    it('backs up Storage for 30-day retention and removes old active data only after commit', async () => {
        const oldPath = 'users/u1/newScheduleProjects/p1_old.json';
        const oldBuffer = Buffer.from(JSON.stringify({ analysis: [1], config: { routeNumber: '8' } }));
        const files = new Map([[oldPath, oldBuffer]]);
        const saves: Array<{ path: string; options: any }> = [];
        const deletes: string[] = [];
        const bucket = {
            file: (path: string) => ({
                download: async () => [files.get(path) ?? Buffer.alloc(0)],
                save: async (content: Buffer, options: any) => {
                    files.set(path, Buffer.from(content));
                    saves.push({ path, options });
                },
                delete: async () => { deletes.push(path); files.delete(path); },
            }),
        };
        const ref = { path: 'users/u1/newScheduleProjects/p1' };
        const project = {
            id: 'p1', ref, updateTime: timestamp(10),
            data: () => ({ storagePath: oldPath, isGenerated: true }),
        };
        let committed = false;
        const db = {
            collectionGroup: () => ({ get: async () => ({ docs: [project] }) }),
            runTransaction: async (callback: (tx: any) => Promise<void>) => callback({
                get: async () => ({ exists: true, updateTime: timestamp(10) }),
                update: () => { committed = true; },
            }),
        };

        const now = new Date('2026-07-29T12:00:00.000Z');
        const result = await migrateNewScheduleRuntimeProjects({ db, bucket, apply: true, now });
        expect(result).toMatchObject({ changed: 1, failed: 0, cleanupWarnings: 0 });
        expect(result.backups).toHaveLength(1);
        const backup = saves.find(item => item.path.startsWith('migration-backups/'));
        expect(backup?.options.metadata.metadata).toMatchObject({
            retentionPolicy: 'delete-after-30-days',
            deleteAfter: '2026-08-28T12:00:00.000Z',
        });
        expect(committed).toBe(true);
        expect(deletes).toContain(oldPath);
    });

    it('cleans an uncommitted replacement and keeps old active Storage on a concurrent edit', async () => {
        const oldPath = 'users/u1/newScheduleProjects/p1_old.json';
        const oldBuffer = Buffer.from(JSON.stringify({ analysis: [1], config: { routeNumber: '8' } }));
        const files = new Map([[oldPath, oldBuffer]]);
        const deletes: string[] = [];
        const bucket = {
            file: (path: string) => ({
                download: async () => [files.get(path) ?? Buffer.alloc(0)],
                save: async (content: Buffer) => { files.set(path, Buffer.from(content)); },
                delete: async () => { deletes.push(path); files.delete(path); },
            }),
        };
        const ref = { path: 'users/u1/newScheduleProjects/p1' };
        const project = {
            id: 'p1', ref, updateTime: timestamp(10),
            data: () => ({ storagePath: oldPath, analysis: [1] }),
        };
        const db = {
            collectionGroup: () => ({ get: async () => ({ docs: [project] }) }),
            runTransaction: async (callback: (tx: any) => Promise<void>) => callback({
                get: async () => ({ exists: true, updateTime: timestamp(11) }),
                update: vi.fn(),
            }),
        };

        const result = await migrateNewScheduleRuntimeProjects({ db, bucket, apply: true });
        expect(result).toMatchObject({ changed: 0, skipped: 1, failed: 0 });
        expect(deletes).toHaveLength(1);
        expect(deletes[0]).not.toBe(oldPath);
        expect(files.has(oldPath)).toBe(true);
    });
});
