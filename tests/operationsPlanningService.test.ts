import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningSourceManifest, ProposalAssessment } from '../utils/run-cutting/types';

const {
  collectionMock,
  docMock,
  getDocMock,
  getDocsMock,
  limitMock,
  orderByMock,
  queryMock,
  runTransactionMock,
  serverTimestampMock,
  transactionGetMock,
  transactionSetMock,
  transactionUpdateMock,
  storageRefMock,
  uploadBytesMock,
  getBytesMock,
  deleteObjectMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  docMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  limitMock: vi.fn(),
  orderByMock: vi.fn(),
  queryMock: vi.fn(),
  runTransactionMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
  transactionGetMock: vi.fn(),
  transactionSetMock: vi.fn(),
  transactionUpdateMock: vi.fn(),
  storageRefMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  getBytesMock: vi.fn(),
  deleteObjectMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: docMock,
  getDoc: getDocMock,
  getDocs: getDocsMock,
  limit: limitMock,
  orderBy: orderByMock,
  query: queryMock,
  runTransaction: runTransactionMock,
  serverTimestamp: serverTimestampMock,
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
  approveOperationsPlanningScenario,
  createOperationsPlanningScenario,
  loadOperationsPlanningScenarioRevision,
  saveOperationsPlanningRevision,
  submitOperationsPlanningScenario,
} from '../utils/services/operationsPlanningService';

const manifest: PlanningSourceManifest = {
  fingerprint: 'manifest-fingerprint',
  items: [{
    sourceTeamId: 'team-1',
    routeIdentity: '10-Weekday',
    routeNumber: '10',
    dayType: 'Weekday',
    version: 4,
    storagePath: 'teams/team-1/masterSchedules/10-Weekday_v4.json',
    contentFingerprint: 'content-fingerprint',
    blockMembershipFingerprint: 'block-fingerprint',
    pinnedAt: '2026-08-27T13:00:00.000Z',
  }],
};

const assessment = (category?: 'integrity' | 'contractual'): ProposalAssessment => ({
  proposal: null,
  dailyRunMetrics: [],
  weeklyRosterMetrics: [],
  findings: category ? [{
    id: 'finding-1',
    category,
    severity: 'error',
    code: `${category}-blocker`,
    message: 'Resolve this issue.',
  }] : [],
  approvalReady: !category,
});

const baseInput = () => ({
  teamId: 'team-1',
  userId: 'planner-1',
  name: 'September system cut',
  sourceManifest: manifest,
  ruleProfile: { id: 'rules-1' } as any,
  operationsMatrix: { entries: [] as never[] },
  assessment: assessment(),
  sourceIsStale: false,
});

const rootData = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  teamId: 'team-1',
  name: 'September system cut',
  status: 'draft',
  activeRevision: 1,
  storagePath: 'teams/team-1/operationsPlanningScenarios/scenario-1/versions/1.json',
  payloadBytes: 100,
  sourceManifestFingerprint: manifest.fingerprint,
  sourceIsStale: false,
  sourceCheckedAt: new Date('2026-08-27T13:00:00Z'),
  integrityBlockerCount: 0,
  contractualBlockerCount: 0,
  warningCount: 0,
  createdAt: new Date('2026-08-27T13:00:00Z'),
  createdBy: 'planner-1',
  updatedAt: new Date('2026-08-27T13:00:00Z'),
  updatedBy: 'planner-1',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  collectionMock.mockReturnValue({ path: 'teams/team-1/operationsPlanningScenarios' });
  docMock.mockImplementation((...args: unknown[]) => ({
    id: args.length === 1 ? 'scenario-1' : String(args.at(-1)),
    path: args.length === 1
      ? 'teams/team-1/operationsPlanningScenarios/scenario-1'
      : args.slice(1).map(String).join('/'),
  }));
  storageRefMock.mockImplementation((_storage: unknown, path: string) => ({ path }));
  uploadBytesMock.mockResolvedValue(undefined);
  deleteObjectMock.mockResolvedValue(undefined);
  runTransactionMock.mockImplementation(async (_db: unknown, callback: (transaction: {
    get: typeof transactionGetMock;
    set: typeof transactionSetMock;
    update: typeof transactionUpdateMock;
  }) => Promise<unknown>) => callback({
    get: transactionGetMock,
    set: transactionSetMock,
    update: transactionUpdateMock,
  }));
});

describe('operationsPlanningService', () => {
  it('creates revision 1 in immutable team storage before the metadata pointer', async () => {
    transactionGetMock.mockResolvedValueOnce({ exists: () => false });

    const saved = await createOperationsPlanningScenario(baseInput());

    const expectedPath = 'teams/team-1/operationsPlanningScenarios/scenario-1/versions/1.json';
    expect(uploadBytesMock).toHaveBeenCalledWith(
      { path: expectedPath },
      expect.anything(),
      {
        contentType: 'application/json',
        customMetadata: {
          teamId: 'team-1', scenarioId: 'scenario-1', revision: '1',
          savedBy: 'planner-1', previousStoragePath: '',
        },
      },
    );
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'scenario-1' }),
      expect.objectContaining({
        teamId: 'team-1',
        activeRevision: 1,
        status: 'draft',
        storagePath: expectedPath,
        createdBy: 'planner-1',
        integrityBlockerCount: 0,
      }),
    );
    expect(saved.metadata.activeRevision).toBe(1);
    expect(saved.payload.sourceManifest.fingerprint).toBe(manifest.fingerprint);
  });

  it('rejects a stale expected revision before uploading', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => rootData({ activeRevision: 3 }),
    });

    await expect(saveOperationsPlanningRevision({
      ...baseInput(), scenarioId: 'scenario-1', expectedRevision: 2,
    })).rejects.toThrow('updated by someone else');
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('saves a new immutable revision and resets a submitted scenario to draft', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => rootData({ status: 'submitted' }),
    });
    transactionGetMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => rootData({ status: 'submitted' }),
    });

    const saved = await saveOperationsPlanningRevision({
      ...baseInput(), scenarioId: 'scenario-1', expectedRevision: 1,
    });

    expect(uploadBytesMock).toHaveBeenCalledWith(
      { path: 'teams/team-1/operationsPlanningScenarios/scenario-1/versions/2.json' },
      expect.anything(),
      {
        contentType: 'application/json',
        customMetadata: {
          teamId: 'team-1', scenarioId: 'scenario-1', revision: '2',
          savedBy: 'planner-1',
          previousStoragePath: 'teams/team-1/operationsPlanningScenarios/scenario-1/versions/1.json',
        },
      },
    );
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ activeRevision: 2, status: 'draft' }),
    );
    expect(saved.metadata.status).toBe('draft');
  });

  it('refuses submission when the saved active revision is stale or has integrity blockers', async () => {
    transactionGetMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => rootData({ sourceIsStale: true }),
    });

    await expect(submitOperationsPlanningScenario({
      teamId: 'team-1', scenarioId: 'scenario-1', userId: 'planner-1', expectedRevision: 1,
    })).rejects.toThrow('Refresh the source schedules');
    expect(transactionUpdateMock).not.toHaveBeenCalled();
  });

  it('allows submission with contractual findings but blocks approval until they are resolved', async () => {
    transactionGetMock
      .mockResolvedValueOnce({ exists: () => true, data: () => rootData({ contractualBlockerCount: 1 }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => rootData({ status: 'submitted', contractualBlockerCount: 1 }) });

    await submitOperationsPlanningScenario({
      teamId: 'team-1', scenarioId: 'scenario-1', userId: 'planner-1', expectedRevision: 1,
    });
    expect(transactionUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'submitted', submittedBy: 'planner-1' }),
    );

    await expect(approveOperationsPlanningScenario({
      teamId: 'team-1', scenarioId: 'scenario-1', userId: 'manager-1', expectedRevision: 1,
    })).rejects.toThrow('contractual blockers');
  });

  it('rejects a storage payload whose immutable identity differs from metadata', async () => {
    const metadata = {
      id: 'scenario-1',
      ...rootData(),
    } as any;
    const mismatched = {
      schemaVersion: 1,
      kind: 'operations-planning-scenario-revision',
      teamId: 'other-team',
      scenarioId: 'scenario-1',
      revision: 1,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(mismatched));
    metadata.payloadBytes = bytes.byteLength;
    getBytesMock.mockResolvedValueOnce(bytes);

    await expect(loadOperationsPlanningScenarioRevision(metadata)).rejects.toThrow(
      'does not match its metadata',
    );
  });

  it('derives blocker counts from proposal findings instead of caller-supplied metadata', async () => {
    transactionGetMock.mockResolvedValueOnce({ exists: () => false });

    await createOperationsPlanningScenario({
      ...baseInput(), assessment: assessment('integrity'),
    });

    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ integrityBlockerCount: 1, contractualBlockerCount: 0 }),
    );
  });
});
