import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({ path: 'teams/team-1/performanceData/metadata' })),
    getDoc: firebaseMocks.getDoc,
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    deleteObject: vi.fn(),
    getBytes: vi.fn(),
}));

vi.mock('../utils/firebase', () => ({ db: {}, storage: {} }));
vi.mock('../utils/sharedWorkspaceDataClient', () => ({ requestSharedWorkspaceData: vi.fn() }));
vi.mock('../utils/performanceSnapshotService', () => ({ saveMonthlySnapshots: vi.fn() }));

import { getPerformanceMetadata } from '../utils/performanceDataService';

describe('performance metadata read failures', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('propagates Firestore failures instead of reporting that metadata is missing', async () => {
        const failure = new Error('permission denied');
        firebaseMocks.getDoc.mockRejectedValueOnce(failure);

        await expect(getPerformanceMetadata('team-1')).rejects.toBe(failure);
    });

    it('returns null only when the metadata document genuinely does not exist', async () => {
        firebaseMocks.getDoc.mockResolvedValueOnce({ exists: () => false });

        await expect(getPerformanceMetadata('team-1')).resolves.toBeNull();
    });

    it('returns the active Ridership Trends projection pointer', async () => {
        firebaseMocks.getDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({
                ridershipTrendStoragePath: 'teams/team-1/performanceViews/ridership-trends/123.json',
            }),
        });

        await expect(getPerformanceMetadata('team-1')).resolves.toMatchObject({
            ridershipTrendStoragePath: 'teams/team-1/performanceViews/ridership-trends/123.json',
        });
    });
});
