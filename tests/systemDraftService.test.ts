import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectionMock,
  docMock,
  setDocMock,
  getDocMock,
  getDocsMock,
  deleteDocMock,
  queryMock,
  orderByMock,
  serverTimestampMock,
  storageRefMock,
  uploadBytesMock,
  getDownloadUrlMock,
  deleteObjectMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  docMock: vi.fn(),
  setDocMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  deleteDocMock: vi.fn(),
  queryMock: vi.fn(),
  orderByMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
  storageRefMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  getDownloadUrlMock: vi.fn(),
  deleteObjectMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: docMock,
  setDoc: setDocMock,
  getDoc: getDocMock,
  getDocs: getDocsMock,
  deleteDoc: deleteDocMock,
  query: queryMock,
  orderBy: orderByMock,
  serverTimestamp: serverTimestampMock,
  Timestamp: class {},
}));

vi.mock('firebase/storage', () => ({
  ref: storageRefMock,
  uploadBytes: uploadBytesMock,
  getDownloadURL: getDownloadUrlMock,
  deleteObject: deleteObjectMock,
}));

vi.mock('../utils/firebase', () => ({
  db: { name: 'db' },
  storage: { name: 'storage' },
}));

vi.mock('../utils/services/dataService', () => ({
  downloadFileContent: vi.fn(),
}));

import { deleteSystemDraft, saveSystemDraft } from '../utils/services/systemDraftService';

describe('systemDraftService', () => {
  beforeEach(() => {
    collectionMock.mockReset();
    docMock.mockReset();
    setDocMock.mockReset();
    getDocMock.mockReset();
    getDocsMock.mockReset();
    deleteDocMock.mockReset();
    queryMock.mockReset();
    orderByMock.mockReset();
    serverTimestampMock.mockClear();
    storageRefMock.mockReset();
    uploadBytesMock.mockReset();
    getDownloadUrlMock.mockReset();
    deleteObjectMock.mockReset();

    collectionMock.mockReturnValue({ path: 'users/user-1/systemDrafts' });
    docMock.mockImplementation((_parent: unknown, id?: string) => ({
      id: id ?? 'generated-system-draft',
      path: id ? `users/user-1/systemDrafts/${id}` : 'users/user-1/systemDrafts/generated-system-draft',
    }));
    storageRefMock.mockImplementation((_storage: unknown, path: string) => ({ path }));
    uploadBytesMock.mockResolvedValue(undefined);
    setDocMock.mockResolvedValue(undefined);
    deleteObjectMock.mockResolvedValue(undefined);
    deleteDocMock.mockResolvedValue(undefined);
  });

  it('uses the current Firestore storage path on updates even if a stale path is provided', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        storagePath: 'users/user-1/systemDrafts/system-draft-1_current.json',
      }),
    });

    await saveSystemDraft('user-1', {
      id: 'system-draft-1',
      name: 'Weekday System QA',
      dayType: 'Weekday',
      routes: [
        {
          routeNumber: '10',
          northTable: { routeName: '10 (Weekday) (North)', stops: [], stopIds: {}, trips: [] },
          southTable: { routeName: '10 (Weekday) (South)', stops: [], stopIds: {}, trips: [] },
        },
      ],
      status: 'draft',
      createdBy: 'user-1',
      storagePath: 'users/user-1/systemDrafts/system-draft-1_stale.json',
    } as any);

    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(deleteObjectMock).toHaveBeenCalledWith({
      path: 'users/user-1/systemDrafts/system-draft-1_current.json',
    });
  });

  it('does not warn when cleanup sees an already-missing storage object', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        storagePath: 'users/user-1/systemDrafts/system-draft-1_current.json',
      }),
    });
    deleteObjectMock.mockRejectedValueOnce({ code: 'storage/object-not-found' });

    await expect(saveSystemDraft('user-1', {
      id: 'system-draft-1',
      name: 'Weekday System QA',
      dayType: 'Weekday',
      routes: [
        {
          routeNumber: '10',
          northTable: { routeName: '10 (Weekday) (North)', stops: [], stopIds: {}, trips: [] },
          southTable: { routeName: '10 (Weekday) (South)', stops: [], stopIds: {}, trips: [] },
        },
      ],
      status: 'draft',
      createdBy: 'user-1',
    } as any)).resolves.toBe('system-draft-1');

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn when deleting a system draft whose blob is already missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        storagePath: 'users/user-1/systemDrafts/system-draft-1_current.json',
      }),
    });
    deleteObjectMock.mockRejectedValueOnce({ code: 'storage/object-not-found' });

    await deleteSystemDraft('user-1', 'system-draft-1');

    expect(deleteDocMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
