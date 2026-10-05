import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
} from 'firebase/firestore';
import {
    deleteObject,
    getBytes,
    ref,
    uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import {
    OPERATIONS_PLANNING_SCHEMA_VERSION,
    type OperationsMatrix,
    type OperationsPlanningScenario,
    type PlanningSourceManifest,
    type ProposalAssessment,
    type RuleProfile,
} from '../run-cutting/types';

export const MAX_OPERATIONS_PLANNING_PAYLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_OPERATIONS_PLANNING_LIST_SIZE = 100;

const SCENARIOS_COLLECTION = 'operationsPlanningScenarios';

export interface OperationsPlanningValidationSummary {
    sourceIsStale: boolean;
    integrityBlockerCount: number;
    contractualBlockerCount: number;
    warningCount: number;
}

export interface OperationsPlanningRevisionPayload {
    schemaVersion: typeof OPERATIONS_PLANNING_SCHEMA_VERSION;
    kind: 'operations-planning-scenario-revision';
    teamId: string;
    scenarioId: string;
    revision: number;
    name: string;
    sourceManifest: PlanningSourceManifest;
    ruleProfile: RuleProfile;
    operationsMatrix: OperationsMatrix;
    assessment: ProposalAssessment | null;
    validation: OperationsPlanningValidationSummary;
    sourceCheckedAt: string;
    savedAt: string;
    savedBy: string;
}

export interface OperationsPlanningScenarioMetadata {
    id: string;
    schemaVersion: typeof OPERATIONS_PLANNING_SCHEMA_VERSION;
    teamId: string;
    name: string;
    status: OperationsPlanningScenario['status'];
    activeRevision: number;
    storagePath: string;
    payloadBytes: number;
    sourceManifestFingerprint: string;
    sourceIsStale: boolean;
    sourceCheckedAt: Date;
    integrityBlockerCount: number;
    contractualBlockerCount: number;
    warningCount: number;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
    submittedAt?: Date;
    submittedBy?: string;
    approvedAt?: Date;
    approvedBy?: string;
}

interface ScenarioRevisionFields {
    name: string;
    sourceManifest: PlanningSourceManifest;
    ruleProfile: RuleProfile;
    operationsMatrix: OperationsMatrix;
    assessment?: ProposalAssessment | null;
    sourceIsStale: boolean;
}

export interface CreateOperationsPlanningScenarioInput extends ScenarioRevisionFields {
    teamId: string;
    userId: string;
}

export interface SaveOperationsPlanningRevisionInput extends CreateOperationsPlanningScenarioInput {
    scenarioId: string;
    expectedRevision: number;
}

export interface OperationsPlanningTransitionInput {
    teamId: string;
    scenarioId: string;
    userId: string;
    expectedRevision: number;
}

export interface SavedOperationsPlanningScenario {
    metadata: OperationsPlanningScenarioMetadata;
    payload: OperationsPlanningRevisionPayload;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const assertDocumentId = (value: string, label: string): string => {
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || normalized.includes('/')) {
        throw new Error(`${label} is invalid.`);
    }
    return normalized;
};

const assertName = (value: string): string => {
    const normalized = value.trim();
    if (!normalized || normalized.length > 160) {
        throw new Error('Scenario name must be between 1 and 160 characters.');
    }
    return normalized;
};

const assertRevision = (value: number, label = 'Revision'): number => {
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
        throw new Error(`${label} is invalid.`);
    }
    return value;
};

const timestampToDate = (value: unknown): Date => {
    if (value instanceof Date) return value;
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(0);
};

const scenarioRef = (teamId: string, scenarioId: string) => (
    doc(db, 'teams', teamId, SCENARIOS_COLLECTION, scenarioId)
);

const buildStoragePath = (teamId: string, scenarioId: string, revision: number): string => (
    `teams/${teamId}/${SCENARIOS_COLLECTION}/${scenarioId}/versions/${revision}.json`
);

const summarizeValidation = (
    assessment: ProposalAssessment | null | undefined,
    sourceIsStale: boolean,
): OperationsPlanningValidationSummary => {
    const findings = assessment?.findings ?? [];
    return {
        sourceIsStale,
        integrityBlockerCount: findings.filter(finding => (
            finding.category === 'integrity' && finding.severity === 'error'
        )).length,
        contractualBlockerCount: findings.filter(finding => (
            finding.category === 'contractual' && finding.severity === 'error'
        )).length,
        warningCount: findings.filter(finding => finding.severity === 'warning').length,
    };
};

const parseMetadata = (id: string, data: Record<string, unknown>): OperationsPlanningScenarioMetadata => ({
    id,
    schemaVersion: OPERATIONS_PLANNING_SCHEMA_VERSION,
    teamId: String(data.teamId ?? ''),
    name: String(data.name ?? ''),
    status: data.status as OperationsPlanningScenario['status'],
    activeRevision: Number(data.activeRevision ?? 0),
    storagePath: String(data.storagePath ?? ''),
    payloadBytes: Number(data.payloadBytes ?? 0),
    sourceManifestFingerprint: String(data.sourceManifestFingerprint ?? ''),
    sourceIsStale: data.sourceIsStale === true,
    sourceCheckedAt: timestampToDate(data.sourceCheckedAt),
    integrityBlockerCount: Number(data.integrityBlockerCount ?? 0),
    contractualBlockerCount: Number(data.contractualBlockerCount ?? 0),
    warningCount: Number(data.warningCount ?? 0),
    createdAt: timestampToDate(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    updatedAt: timestampToDate(data.updatedAt),
    updatedBy: String(data.updatedBy ?? ''),
    ...(data.submittedAt ? { submittedAt: timestampToDate(data.submittedAt) } : {}),
    ...(data.submittedBy ? { submittedBy: String(data.submittedBy) } : {}),
    ...(data.approvedAt ? { approvedAt: timestampToDate(data.approvedAt) } : {}),
    ...(data.approvedBy ? { approvedBy: String(data.approvedBy) } : {}),
});

const assertManifest = (manifest: PlanningSourceManifest): PlanningSourceManifest => {
    if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0 || manifest.items.length > 500) {
        throw new Error('The source manifest must contain between 1 and 500 pinned schedules.');
    }
    if (typeof manifest.fingerprint !== 'string' || !manifest.fingerprint.trim() || manifest.fingerprint.length > 256) {
        throw new Error('The source manifest fingerprint is invalid.');
    }
    return manifest;
};

const buildPayload = (
    teamId: string,
    scenarioId: string,
    revision: number,
    userId: string,
    fields: ScenarioRevisionFields,
): OperationsPlanningRevisionPayload => {
    const now = new Date().toISOString();
    const assessment = fields.assessment ?? null;
    return {
        schemaVersion: OPERATIONS_PLANNING_SCHEMA_VERSION,
        kind: 'operations-planning-scenario-revision',
        teamId,
        scenarioId,
        revision,
        name: assertName(fields.name),
        sourceManifest: assertManifest(fields.sourceManifest),
        ruleProfile: fields.ruleProfile,
        operationsMatrix: fields.operationsMatrix,
        assessment,
        validation: summarizeValidation(assessment, fields.sourceIsStale),
        sourceCheckedAt: now,
        savedAt: now,
        savedBy: userId,
    };
};

const encodePayload = (payload: OperationsPlanningRevisionPayload): Uint8Array => {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_OPERATIONS_PLANNING_PAYLOAD_BYTES) {
        throw new Error('Operations-planning payload exceeds the 25 MB limit.');
    }
    return bytes;
};

const buildUploadMetadata = (
    payload: OperationsPlanningRevisionPayload,
    previousStoragePath: string,
) => ({
    contentType: 'application/json',
    customMetadata: {
        teamId: payload.teamId,
        scenarioId: payload.scenarioId,
        revision: String(payload.revision),
        savedBy: payload.savedBy,
        previousStoragePath,
    },
});

const metadataFieldsFromPayload = (payload: OperationsPlanningRevisionPayload, storagePath: string, payloadBytes: number) => ({
    schemaVersion: OPERATIONS_PLANNING_SCHEMA_VERSION,
    teamId: payload.teamId,
    name: payload.name,
    activeRevision: payload.revision,
    storagePath,
    payloadBytes,
    sourceManifestFingerprint: payload.sourceManifest.fingerprint,
    sourceIsStale: payload.validation.sourceIsStale,
    sourceCheckedAt: serverTimestamp(),
    integrityBlockerCount: payload.validation.integrityBlockerCount,
    contractualBlockerCount: payload.validation.contractualBlockerCount,
    warningCount: payload.validation.warningCount,
    updatedAt: serverTimestamp(),
    updatedBy: payload.savedBy,
});

const localMetadataFromPayload = (
    payload: OperationsPlanningRevisionPayload,
    storagePath: string,
    payloadBytes: number,
    createdAt: Date,
    createdBy: string,
): OperationsPlanningScenarioMetadata => ({
    id: payload.scenarioId,
    schemaVersion: OPERATIONS_PLANNING_SCHEMA_VERSION,
    teamId: payload.teamId,
    name: payload.name,
    status: 'draft',
    activeRevision: payload.revision,
    storagePath,
    payloadBytes,
    sourceManifestFingerprint: payload.sourceManifest.fingerprint,
    ...payload.validation,
    sourceCheckedAt: new Date(payload.sourceCheckedAt),
    createdAt,
    createdBy,
    updatedAt: new Date(payload.savedAt),
    updatedBy: payload.savedBy,
});

export const listOperationsPlanningScenarios = async (
    teamIdInput: string,
    maxResults = 50,
): Promise<OperationsPlanningScenarioMetadata[]> => {
    const teamId = assertDocumentId(teamIdInput, 'Team ID');
    const resultLimit = Math.max(1, Math.min(Math.floor(maxResults), MAX_OPERATIONS_PLANNING_LIST_SIZE));
    const snapshot = await getDocs(query(
        collection(db, 'teams', teamId, SCENARIOS_COLLECTION),
        orderBy('updatedAt', 'desc'),
        limit(resultLimit),
    ));
    return snapshot.docs.map(item => parseMetadata(item.id, item.data()));
};

export const getOperationsPlanningScenario = async (
    teamIdInput: string,
    scenarioIdInput: string,
): Promise<OperationsPlanningScenarioMetadata | null> => {
    const teamId = assertDocumentId(teamIdInput, 'Team ID');
    const scenarioId = assertDocumentId(scenarioIdInput, 'Scenario ID');
    const snapshot = await getDoc(scenarioRef(teamId, scenarioId));
    return snapshot.exists() ? parseMetadata(snapshot.id, snapshot.data()) : null;
};

export const loadOperationsPlanningScenarioRevision = async (
    metadata: OperationsPlanningScenarioMetadata,
): Promise<OperationsPlanningRevisionPayload> => {
    const teamId = assertDocumentId(metadata.teamId, 'Team ID');
    const scenarioId = assertDocumentId(metadata.id, 'Scenario ID');
    const revision = assertRevision(metadata.activeRevision);
    const expectedPath = buildStoragePath(teamId, scenarioId, revision);
    if (revision < 1 || metadata.storagePath !== expectedPath) {
        throw new Error('Operations-planning storage path is invalid.');
    }
    if (!Number.isInteger(metadata.payloadBytes) || metadata.payloadBytes <= 0 || metadata.payloadBytes > MAX_OPERATIONS_PLANNING_PAYLOAD_BYTES) {
        throw new Error('Operations-planning payload size is invalid.');
    }

    const bytes = await getBytes(ref(storage, expectedPath), MAX_OPERATIONS_PLANNING_PAYLOAD_BYTES);
    if (bytes.byteLength !== metadata.payloadBytes) {
        throw new Error('Operations-planning payload size does not match its metadata.');
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isRecord(parsed)) throw new Error('Operations-planning payload is invalid.');
    const payload = parsed as unknown as OperationsPlanningRevisionPayload;
    if (
        payload.schemaVersion !== OPERATIONS_PLANNING_SCHEMA_VERSION
        || payload.kind !== 'operations-planning-scenario-revision'
        || payload.teamId !== teamId
        || payload.scenarioId !== scenarioId
        || payload.revision !== revision
        || payload.name !== metadata.name
        || payload.sourceManifest?.fingerprint !== metadata.sourceManifestFingerprint
        || payload.validation?.sourceIsStale !== metadata.sourceIsStale
        || payload.validation?.integrityBlockerCount !== metadata.integrityBlockerCount
        || payload.validation?.contractualBlockerCount !== metadata.contractualBlockerCount
        || payload.validation?.warningCount !== metadata.warningCount
    ) {
        throw new Error('Operations-planning payload does not match its metadata.');
    }
    return payload;
};

export const createOperationsPlanningScenario = async (
    input: CreateOperationsPlanningScenarioInput,
): Promise<SavedOperationsPlanningScenario> => {
    const teamId = assertDocumentId(input.teamId, 'Team ID');
    const userId = assertDocumentId(input.userId, 'User ID');
    const rootCollection = collection(db, 'teams', teamId, SCENARIOS_COLLECTION);
    const rootRef = doc(rootCollection);
    const scenarioId = assertDocumentId(rootRef.id, 'Scenario ID');
    const payload = buildPayload(teamId, scenarioId, 1, userId, input);
    const bytes = encodePayload(payload);
    const storagePath = buildStoragePath(teamId, scenarioId, 1);
    const payloadRef = ref(storage, storagePath);

    await uploadBytes(payloadRef, bytes, buildUploadMetadata(payload, ''));
    try {
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(rootRef);
            if (snapshot.exists()) throw new Error('Operations-planning scenario already exists.');
            transaction.set(rootRef, {
                ...metadataFieldsFromPayload(payload, storagePath, bytes.byteLength),
                status: 'draft',
                createdAt: serverTimestamp(),
                createdBy: userId,
            });
        });
    } catch (error) {
        try {
            await deleteObject(payloadRef);
        } catch {
            // Preserve the metadata error. Audited support cleanup may remove an orphaned revision.
        }
        throw error;
    }

    const now = new Date(payload.savedAt);
    return {
        metadata: localMetadataFromPayload(payload, storagePath, bytes.byteLength, now, userId),
        payload,
    };
};

export const saveOperationsPlanningRevision = async (
    input: SaveOperationsPlanningRevisionInput,
): Promise<SavedOperationsPlanningScenario> => {
    const teamId = assertDocumentId(input.teamId, 'Team ID');
    const scenarioId = assertDocumentId(input.scenarioId, 'Scenario ID');
    const userId = assertDocumentId(input.userId, 'User ID');
    const expectedRevision = assertRevision(input.expectedRevision, 'Expected revision');
    const nextRevision = expectedRevision + 1;
    const rootRef = scenarioRef(teamId, scenarioId);
    const before = await getDoc(rootRef);
    if (!before.exists()) throw new Error('Operations-planning scenario was not found.');
    const beforeData = before.data();
    if (Number(beforeData.activeRevision) !== expectedRevision) {
        throw new Error('This operations-planning scenario was updated by someone else. Reload it before saving.');
    }
    if (beforeData.status === 'approved') {
        throw new Error('An approved operations-planning scenario is immutable. Create a new scenario to revise it.');
    }

    const payload = buildPayload(teamId, scenarioId, nextRevision, userId, input);
    const bytes = encodePayload(payload);
    const storagePath = buildStoragePath(teamId, scenarioId, nextRevision);
    const payloadRef = ref(storage, storagePath);
    await uploadBytes(payloadRef, bytes, buildUploadMetadata(payload, String(beforeData.storagePath ?? '')));

    let createdAt = timestampToDate(beforeData.createdAt);
    let createdBy = String(beforeData.createdBy ?? userId);
    try {
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(rootRef);
            if (!snapshot.exists() || Number(snapshot.data().activeRevision) !== expectedRevision) {
                throw new Error('This operations-planning scenario was updated by someone else. Reload it before saving.');
            }
            if (snapshot.data().status === 'approved') {
                throw new Error('An approved operations-planning scenario is immutable. Create a new scenario to revise it.');
            }
            createdAt = timestampToDate(snapshot.data().createdAt);
            createdBy = String(snapshot.data().createdBy ?? userId);
            transaction.set(rootRef, {
                ...metadataFieldsFromPayload(payload, storagePath, bytes.byteLength),
                status: 'draft',
                createdAt: snapshot.data().createdAt,
                createdBy,
            });
        });
    } catch (error) {
        try {
            await deleteObject(payloadRef);
        } catch {
            // Preserve the conflict. Audited support cleanup may remove an orphaned revision.
        }
        throw error;
    }

    return {
        metadata: localMetadataFromPayload(payload, storagePath, bytes.byteLength, createdAt, createdBy),
        payload,
    };
};

const transitionScenario = async (
    input: OperationsPlanningTransitionInput,
    transition: 'submit' | 'approve',
): Promise<void> => {
    const teamId = assertDocumentId(input.teamId, 'Team ID');
    const scenarioId = assertDocumentId(input.scenarioId, 'Scenario ID');
    const userId = assertDocumentId(input.userId, 'User ID');
    const expectedRevision = assertRevision(input.expectedRevision, 'Expected revision');

    await runTransaction(db, async transaction => {
        const rootRef = scenarioRef(teamId, scenarioId);
        const snapshot = await transaction.get(rootRef);
        if (!snapshot.exists()) throw new Error('Operations-planning scenario was not found.');
        const data = snapshot.data();
        if (Number(data.activeRevision) !== expectedRevision) {
            throw new Error('This operations-planning scenario was updated by someone else. Reload it before continuing.');
        }
        if (data.sourceIsStale === true || Number(data.integrityBlockerCount) > 0) {
            throw new Error('Refresh the source schedules and resolve integrity blockers before continuing.');
        }

        if (transition === 'submit') {
            if (data.status !== 'draft') throw new Error('Only a draft scenario can be submitted.');
            transaction.update(rootRef, {
                status: 'submitted',
                submittedAt: serverTimestamp(),
                submittedBy: userId,
                updatedAt: serverTimestamp(),
                updatedBy: userId,
            });
            return;
        }

        if (data.status !== 'submitted') throw new Error('Only a submitted scenario can be approved.');
        if (Number(data.contractualBlockerCount) > 0) {
            throw new Error('Resolve contractual blockers before approving this scenario.');
        }
        transaction.update(rootRef, {
            status: 'approved',
            approvedAt: serverTimestamp(),
            approvedBy: userId,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        });
    });
};

export const submitOperationsPlanningScenario = async (
    input: OperationsPlanningTransitionInput,
): Promise<void> => transitionScenario(input, 'submit');

export const approveOperationsPlanningScenario = async (
    input: OperationsPlanningTransitionInput,
): Promise<void> => transitionScenario(input, 'approve');
