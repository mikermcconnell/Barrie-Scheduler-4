import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDocMock = vi.fn();
const setDocMock = vi.fn();
const uploadBytesMock = vi.fn();
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
        setDoc: (...args: unknown[]) => setDocMock(...args),
        getDoc: (...args: unknown[]) => getDocMock(...args),
        getDocs: vi.fn(),
        deleteDoc: vi.fn(),
        query: vi.fn((...args: unknown[]) => ({ kind: 'query', args })),
        orderBy: vi.fn((...args: unknown[]) => ({ kind: 'orderBy', args })),
        serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
        Timestamp: MockTimestamp,
    };
});

vi.mock('firebase/storage', () => ({
    ref: vi.fn((_: unknown, path: string) => ({ path })),
    uploadBytes: (...args: unknown[]) => uploadBytesMock(...args),
    getDownloadURL: (...args: unknown[]) => getDownloadURLMock(...args),
    deleteObject: (...args: unknown[]) => deleteObjectMock(...args),
}));

describe('newScheduleProjectService', () => {
    beforeEach(() => {
        getDocMock.mockReset();
        setDocMock.mockReset();
        uploadBytesMock.mockReset();
        getDownloadURLMock.mockReset();
        deleteObjectMock.mockReset();
        setDocMock.mockResolvedValue(undefined);
        uploadBytesMock.mockResolvedValue(undefined);
        deleteObjectMock.mockResolvedValue(undefined);
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('deletes the previous storage blob after saving a new heavy snapshot', async () => {
        getDocMock.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ storagePath: 'users/user-1/newScheduleProjects/old.json' }),
        });

        const { saveProject } = await import('../utils/services/newScheduleProjectService');

        await saveProject('user-1', {
            id: 'project-1',
            name: 'Project 1',
            dayType: 'Weekday',
            generatedSchedules: [{ routeName: '10', stops: [], stopIds: {}, trips: [] }],
            isGenerated: true,
        });

        expect(uploadBytesMock).toHaveBeenCalledTimes(1);
        expect(setDocMock).toHaveBeenCalledTimes(1);
        expect(deleteObjectMock).toHaveBeenCalledWith({
            path: 'users/user-1/newScheduleProjects/old.json',
        });
    });

    it('returns null when a stored blob cannot be loaded', async () => {
        getDocMock.mockResolvedValueOnce({
            exists: () => true,
            id: 'project-1',
            data: () => ({
                name: 'Project 1',
                dayType: 'Weekday',
                importMode: 'csv',
                isGenerated: true,
                storagePath: 'users/user-1/newScheduleProjects/project-1.json',
            }),
        });
        getDownloadURLMock.mockResolvedValue('https://example.com/project-1.json');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));

        const { getProject } = await import('../utils/services/newScheduleProjectService');

        await expect(getProject('user-1', 'project-1')).resolves.toBeNull();
    });
});
