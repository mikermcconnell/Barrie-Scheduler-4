import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), runTransaction: vi.fn(), set: vi.fn(), get: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...parts: string[]) => parts.join('/'), getDoc: mocks.getDoc, runTransaction: mocks.runTransaction, serverTimestamp: () => 'server' }));
vi.mock('../utils/firebase', () => ({ db: {} }));
import { createParkingStrategyLocationLink, getParkingStrategyLocations, saveParkingStrategyLocations } from '../utils/parking/parkingStrategyLocationService';
const missing = { exists: () => false, data: (): undefined => undefined };
const existing = (value: unknown) => ({ exists: () => true, data: () => value });

describe('reviewed strategy location links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDoc.mockResolvedValue(missing);
    mocks.get.mockResolvedValue(missing);
    mocks.runTransaction.mockImplementation(async (_db, callback) => callback({ get: mocks.get, set: mocks.set }));
  });
  it('writes separate revisioned source links and supports explicit unmapping', async () => {
    const link = createParkingStrategyLocationLink('Marina', '1', 'physical-lot');
    const saved = await saveParkingStrategyLocations('team', 'user', [link], 0);
    expect(mocks.set).toHaveBeenCalledWith('teams/team/parking/historyLocations', expect.objectContaining({ revision: 1, links: [link] }));
    mocks.get.mockResolvedValue(existing({ schemaVersion: 1, ...saved }));
    expect((await saveParkingStrategyLocations('team', 'user', [], 1)).links).toEqual([]);
  });
  it('rejects stale revisions and non-canonical or duplicate source keys', async () => {
    mocks.get.mockResolvedValue(existing({ schemaVersion: 1, revision: 2, links: [] }));
    await expect(saveParkingStrategyLocations('team', 'user', [], 1)).rejects.toThrow('changed');
    const link = createParkingStrategyLocationLink('Marina', '1', 'lot');
    await expect(saveParkingStrategyLocations('team', 'user', [link, link], 2)).rejects.toThrow('duplicate');
    await expect(saveParkingStrategyLocations('team', 'user', [{ ...link, domain: 'Other' }], 2)).rejects.toThrow('Invalid');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('distinguishes missing settings from malformed data and access errors', async () => {
    expect((await getParkingStrategyLocations('team')).revision).toBe(0);
    mocks.getDoc.mockResolvedValue(existing({ schemaVersion: 9 }));
    await expect(getParkingStrategyLocations('team')).rejects.toThrow('invalid');
    mocks.getDoc.mockRejectedValue(new Error('permission denied'));
    await expect(getParkingStrategyLocations('team')).rejects.toThrow('permission denied');
  });
});
