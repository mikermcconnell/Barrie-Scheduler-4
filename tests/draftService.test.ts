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

import { saveDraft } from '../utils/services/draftService';

describe('draftService.saveDraft', () => {
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

    collectionMock.mockReturnValue({ path: 'users/user-1/draftSchedules' });
    docMock.mockImplementation((_parent: unknown, id?: string) => ({
      id: id ?? 'generated-draft',
      path: id ? `users/user-1/draftSchedules/${id}` : 'users/user-1/draftSchedules/generated-draft',
    }));
    storageRefMock.mockImplementation((_storage: unknown, path: string) => ({ path }));
    uploadBytesMock.mockResolvedValue(undefined);
    setDocMock.mockResolvedValue(undefined);
    deleteObjectMock.mockResolvedValue(undefined);
  });

  it('looks up and deletes the previous storage blob on updates without a provided storagePath', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        storagePath: 'users/user-1/draftSchedules/draft-1_old.json',
      }),
    });

    await saveDraft('user-1', {
      id: 'draft-1',
      name: 'Draft 1',
      routeNumber: '10',
      dayType: 'Weekday',
      status: 'draft',
      createdBy: 'user-1',
      content: {
        northTable: { routeName: '10 (Weekday) (North)', stops: [], stopIds: {}, trips: [] },
        southTable: { routeName: '10 (Weekday) (South)', stops: [], stopIds: {}, trips: [] },
        metadata: { routeNumber: '10', dayType: 'Weekday', uploadedAt: '2026-03-11T10:00:00Z' },
      },
    } as any);

    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(deleteObjectMock).toHaveBeenCalledWith({
      path: 'users/user-1/draftSchedules/draft-1_old.json',
    });
  });
});
