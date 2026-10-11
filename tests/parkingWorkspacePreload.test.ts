import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadParkingWorkspaceData: vi.fn(),
    fetchBarriePublicParkingLocations: vi.fn(),
}));

vi.mock('../utils/parking/parkingService', () => ({
    loadParkingWorkspaceData: mocks.loadParkingWorkspaceData,
}));
vi.mock('../utils/parking/publicParkingLocations', () => ({
    fetchBarriePublicParkingLocations: mocks.fetchBarriePublicParkingLocations,
}));

import {
    getBarriePublicParkingLocations,
    preloadParkingWorkspaceData,
    resetParkingWorkspacePreloadForTests,
    takeParkingWorkspaceData,
} from '../utils/parking/parkingWorkspacePreload';

const preloaded = { settings: { source: 'preload' }, summary: { months: [] as unknown[] }, revenueSummary: { datasets: [] as unknown[] } };
const fresh = { settings: { source: 'fresh' }, summary: null as unknown, revenueSummary: null as unknown };

describe('parking workspace preload', () => {
    beforeEach(() => {
        resetParkingWorkspacePreloadForTests();
        mocks.loadParkingWorkspaceData.mockReset().mockImplementation(async (_teamId: string, scope: string) => (
            scope === 'lot-data' && mocks.loadParkingWorkspaceData.mock.calls.length === 1 ? preloaded : fresh
        ));
        mocks.fetchBarriePublicParkingLocations.mockReset().mockResolvedValue([{ id: 'lot-1' }]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('hands the preloaded lot data to the first workspace load only', async () => {
        preloadParkingWorkspaceData('team-1');

        await expect(takeParkingWorkspaceData('team-1', 'lot-data')).resolves.toBe(preloaded);
        expect(mocks.loadParkingWorkspaceData).toHaveBeenCalledTimes(1);
        expect(mocks.loadParkingWorkspaceData).toHaveBeenCalledWith('team-1', 'lot-data');

        await expect(takeParkingWorkspaceData('team-1', 'lot-data')).resolves.toBe(fresh);
        expect(mocks.loadParkingWorkspaceData).toHaveBeenCalledTimes(2);
    });

    it('serves Plate Monitor from the preload without revenue data', async () => {
        preloadParkingWorkspaceData('team-1');

        await expect(takeParkingWorkspaceData('team-1', 'plate-monitor')).resolves.toEqual({
            ...preloaded,
            revenueSummary: null,
        });
        expect(mocks.loadParkingWorkspaceData).toHaveBeenCalledTimes(1);
    });

    it('loads fresh data for a different team, an expired preload, or a failed preload', async () => {
        preloadParkingWorkspaceData('team-1');
        await expect(takeParkingWorkspaceData('team-2', 'lot-data')).resolves.toBe(fresh);
        expect(mocks.loadParkingWorkspaceData).toHaveBeenLastCalledWith('team-2', 'lot-data');

        vi.useFakeTimers();
        mocks.loadParkingWorkspaceData.mockClear();
        preloadParkingWorkspaceData('team-1');
        vi.advanceTimersByTime(31 * 60 * 1000);
        await takeParkingWorkspaceData('team-1', 'lot-data');
        expect(mocks.loadParkingWorkspaceData).toHaveBeenCalledTimes(2);

        mocks.loadParkingWorkspaceData.mockReset()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(fresh);
        preloadParkingWorkspaceData('team-1');
        await expect(takeParkingWorkspaceData('team-1', 'lot-data')).resolves.toBe(fresh);
    });

    it('fetches city lot locations once per session and retries after a failure', async () => {
        mocks.fetchBarriePublicParkingLocations.mockRejectedValueOnce(new Error('offline'));
        await expect(getBarriePublicParkingLocations()).rejects.toThrow('offline');

        await expect(getBarriePublicParkingLocations()).resolves.toEqual([{ id: 'lot-1' }]);
        await getBarriePublicParkingLocations();
        expect(mocks.fetchBarriePublicParkingLocations).toHaveBeenCalledTimes(2);
    });
});
