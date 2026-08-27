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
import { db } from '../firebase';
import {
    STRATEGIC_WORKPLAN_SCHEMA_VERSION,
    type StrategicWorkplanDocument,
    type StrategicWorkplanSegment,
    type StrategicWorkplanSegmentType,
    type StrategicWorkplanStatus,
    type StrategicWorkplanTask,
    type StrategicWorkplanAuditEntry,
    type StrategicWorkplanAuditTaskChange,
    type StrategicWorkplanVersion,
} from './workplanTypes';
import { buildStrategicWorkplanAudit } from './workplanAudit';
import { createStrategicWorkplanBaseline } from './workplanBaseline';

type StrategicWorkplanErrorCode = 'conflict' | 'invalid' | 'permission' | 'network' | 'unknown';

export type StrategicWorkplanError = Error & { strategicWorkplanCode: StrategicWorkplanErrorCode };

const STATUSES = new Set<StrategicWorkplanStatus>([
    'unconfirmed',
    'not-started',
    'in-progress',
    'at-risk',
    'blocked',
    'complete',
]);

const SEGMENT_TYPES = new Set<StrategicWorkplanSegmentType>([
    'task',
    'draft-deliverable',
    'review',
    'final-deliverable',
    'project-initiation',
    'project-team-meeting',
    'working-session',
    'council-presentation',
    'engagement-event',
]);

function workplanRef(teamId: string) {
    return doc(db, 'teams', teamId, 'strategicPlanWorkplans', 'default');
}

function workplanVersionRef(teamId: string, revision: number) {
    return doc(db, 'teams', teamId, 'strategicPlanWorkplans', 'default', 'versions', String(revision));
}

function workplanError(message: string, code: StrategicWorkplanErrorCode): StrategicWorkplanError {
    return Object.assign(new Error(message), { strategicWorkplanCode: code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = false): string {
    if (typeof value !== 'string') throw workplanError(`${label} must be text.`, 'invalid');
    const normalized = value.trim();
    if (!allowEmpty && !normalized) throw workplanError(`${label} is required.`, 'invalid');
    if (normalized.length > maximum) throw workplanError(`${label} is too long.`, 'invalid');
    return normalized;
}

function optionalIsoDate(value: unknown, label: string): string | null {
    if (value === null || value === '') return null;
    const normalized = boundedString(value, label, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
        throw workplanError(`${label} must use YYYY-MM-DD.`, 'invalid');
    }
    return normalized;
}

function normalizeSegment(value: unknown, taskId: string, index: number): StrategicWorkplanSegment {
    if (!isRecord(value)) throw workplanError('A work-plan segment is invalid.', 'invalid');
    const type = value.type;
    if (typeof type !== 'string' || !SEGMENT_TYPES.has(type as StrategicWorkplanSegmentType)) {
        throw workplanError('A work-plan segment type is invalid.', 'invalid');
    }
    const startDate = optionalIsoDate(value.startDate, 'Segment start date');
    const endDate = optionalIsoDate(value.endDate, 'Segment end date');
    if (!startDate || !endDate || endDate < startDate) {
        throw workplanError('Segment dates are invalid.', 'invalid');
    }

    return {
        id: boundedString(value.id ?? `${taskId}-segment-${index + 1}`, 'Segment ID', 120),
        type: type as StrategicWorkplanSegmentType,
        label: boundedString(value.label, 'Segment label', 120),
        startDate,
        endDate,
        datePrecision: 'week',
    };
}

function normalizeTask(value: unknown, index: number): StrategicWorkplanTask {
    if (!isRecord(value)) throw workplanError(`Task ${index + 1} is invalid.`, 'invalid');
    const status = value.status;
    if (typeof status !== 'string' || !STATUSES.has(status as StrategicWorkplanStatus)) {
        throw workplanError(`Task ${index + 1} has an invalid status.`, 'invalid');
    }
    const progress = Number(value.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
        throw workplanError(`Task ${index + 1} progress must be from 0 to 100.`, 'invalid');
    }
    const ownership = value.ownership;
    if (!['Staff', 'Consultant', 'Joint', 'Unassigned'].includes(String(ownership))) {
        throw workplanError(`Task ${index + 1} has invalid ownership.`, 'invalid');
    }
    const taskId = boundedString(value.id, 'Task ID', 120);
    const startDate = optionalIsoDate(value.startDate, 'Task start date');
    const endDate = optionalIsoDate(value.endDate, 'Task end date');
    if ((startDate && !endDate) || (!startDate && endDate) || (startDate && endDate && endDate < startDate)) {
        throw workplanError(`Task ${index + 1} dates are invalid.`, 'invalid');
    }
    const dependencies = Array.isArray(value.dependencies)
        ? value.dependencies.map((dependency, dependencyIndex) => boundedString(
            dependency,
            `Task ${index + 1} dependency ${dependencyIndex + 1}`,
            120,
        )).filter(Boolean)
        : [];
    if (dependencies.length > 30) throw workplanError('A task cannot have more than 30 dependencies.', 'invalid');
    const segments = Array.isArray(value.segments)
        ? value.segments.map((segment, segmentIndex) => normalizeSegment(segment, taskId, segmentIndex))
        : [];
    if (segments.length > 40) throw workplanError('A task cannot have more than 40 schedule segments.', 'invalid');

    return {
        id: taskId,
        wbs: boundedString(value.wbs, 'WBS', 30),
        phaseId: boundedString(value.phaseId, 'Phase ID', 80),
        phaseName: boundedString(value.phaseName, 'Phase name', 160),
        chapter: value.chapter === null || value.chapter === ''
            ? null
            : boundedString(value.chapter, 'Chapter', 200),
        title: boundedString(value.title, 'Task title', 240),
        ownership: ownership as StrategicWorkplanTask['ownership'],
        startDate,
        endDate,
        status: status as StrategicWorkplanStatus,
        progress: Math.round(progress),
        dependencies: [...new Set(dependencies)],
        notes: boundedString(value.notes ?? '', 'Task notes', 4000, true),
        segments,
    };
}

export function normalizeStrategicWorkplan(value: unknown, expectedTeamId: string): StrategicWorkplanDocument {
    if (!isRecord(value)) throw workplanError('The shared work plan is invalid.', 'invalid');
    if (value.schemaVersion !== STRATEGIC_WORKPLAN_SCHEMA_VERSION) {
        throw workplanError('This work-plan version is not supported.', 'invalid');
    }
    if (value.teamId !== expectedTeamId) throw workplanError('The work plan belongs to another team.', 'invalid');
    if (!Array.isArray(value.tasks) || value.tasks.length > 250) {
        throw workplanError('The work plan must contain no more than 250 tasks.', 'invalid');
    }
    const scheduleStart = optionalIsoDate(value.scheduleStart, 'Schedule start');
    const scheduleEnd = optionalIsoDate(value.scheduleEnd, 'Schedule end');
    if (!scheduleStart || !scheduleEnd || scheduleEnd < scheduleStart) {
        throw workplanError('The work-plan date range is invalid.', 'invalid');
    }
    if (!isRecord(value.source)) throw workplanError('The work-plan source is missing.', 'invalid');

    return {
        schemaVersion: STRATEGIC_WORKPLAN_SCHEMA_VERSION,
        teamId: expectedTeamId,
        revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
        name: boundedString(value.name, 'Work-plan name', 160),
        scheduleStart,
        scheduleEnd,
        source: {
            title: boundedString(value.source.title, 'Source title', 240),
            organization: boundedString(value.source.organization, 'Source organization', 160),
            proposalDate: optionalIsoDate(value.source.proposalDate, 'Source proposal date') ?? '',
            fileName: boundedString(value.source.fileName, 'Source filename', 200),
            schedulePages: boundedString(value.source.schedulePages, 'Source pages', 160),
            importedAt: optionalIsoDate(value.source.importedAt, 'Source import date') ?? '',
            datePrecision: 'week',
            note: boundedString(value.source.note, 'Source note', 800),
        },
        tasks: value.tasks.map((task, index) => normalizeTask(task, index)),
        createdAt: boundedString(value.createdAt, 'Created timestamp', 40),
        createdBy: boundedString(value.createdBy, 'Created by', 128),
        updatedAt: boundedString(value.updatedAt, 'Updated timestamp', 40),
        updatedBy: boundedString(value.updatedBy, 'Updated by', 128),
    };
}

function normalizeFirebaseError(error: unknown, action: 'load' | 'save'): StrategicWorkplanError {
    if (isRecord(error) && typeof error.strategicWorkplanCode === 'string') {
        return error as unknown as StrategicWorkplanError;
    }
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    if (code === 'permission-denied') {
        return workplanError(
            action === 'save'
                ? 'You do not have permission to update this Strategic Plan work plan.'
                : 'You do not have permission to open this Strategic Plan work plan.',
            'permission',
        );
    }
    if (code === 'unavailable' || code === 'deadline-exceeded') {
        return workplanError('The shared work plan could not reach Firebase. Check your connection and try again.', 'network');
    }
    return workplanError(
        action === 'save' ? 'The shared work plan could not be saved.' : 'The shared work plan could not be loaded.',
        'unknown',
    );
}

export async function loadStrategicWorkplan(teamId: string): Promise<StrategicWorkplanDocument | null> {
    try {
        const snapshot = await getDoc(workplanRef(teamId));
        return snapshot.exists() ? normalizeStrategicWorkplan(snapshot.data(), teamId) : null;
    } catch (error) {
        throw normalizeFirebaseError(error, 'load');
    }
}

export async function listStrategicWorkplanVersions(
    teamId: string,
    maximum = 20,
): Promise<StrategicWorkplanVersion[]> {
    try {
        const versions = collection(db, 'teams', teamId, 'strategicPlanWorkplans', 'default', 'versions');
        const snapshot = await getDocs(query(versions, orderBy('revision', 'desc'), limit(Math.min(50, Math.max(1, maximum)))));
        return snapshot.docs.map(version => normalizeStrategicWorkplanVersion(version.data(), teamId));
    } catch (error) {
        throw normalizeFirebaseError(error, 'load');
    }
}

export async function saveStrategicWorkplan(
    teamId: string,
    workplan: StrategicWorkplanDocument,
    userId: string,
    userLabel: string,
): Promise<StrategicWorkplanDocument> {
    try {
        const normalized = normalizeStrategicWorkplan(workplan, teamId);
        const now = new Date().toISOString();

        return await runTransaction(db, async transaction => {
            const reference = workplanRef(teamId);
            const snapshot = await transaction.get(reference);
            const currentRevision = snapshot.exists() ? Number(snapshot.data().revision) || 0 : 0;
            if (currentRevision !== normalized.revision) {
                throw workplanError(
                    'This work plan was updated by someone else. Reload it before saving your changes.',
                    'conflict',
                );
            }

            const existing = snapshot.exists() ? normalizeStrategicWorkplan(snapshot.data(), teamId) : null;
            const nextRevision = currentRevision + 1;
            const saved: StrategicWorkplanDocument = {
                ...normalized,
                revision: nextRevision,
                createdAt: existing?.createdAt ?? normalized.createdAt,
                createdBy: existing?.createdBy ?? userId,
                updatedAt: now,
                updatedBy: userId,
            };
            const auditBefore = existing ?? createStrategicWorkplanBaseline(teamId, normalized.createdBy);
            const audit = buildStrategicWorkplanAudit(auditBefore, saved, { uid: userId, name: userLabel }, now);
            const persisted = { ...saved, updatedAtServer: serverTimestamp() };
            transaction.set(reference, persisted);
            transaction.set(workplanVersionRef(teamId, nextRevision), {
                ...saved,
                audit,
                savedAtServer: serverTimestamp(),
            });
            return saved;
        });
    } catch (error) {
        throw normalizeFirebaseError(error, 'save');
    }
}

function normalizeStrategicWorkplanAudit(
    value: unknown,
    workplan: StrategicWorkplanDocument,
): StrategicWorkplanAuditEntry {
    if (!isRecord(value)) {
        return {
            editedByUid: workplan.updatedBy,
            editedByName: workplan.updatedBy,
            editedAt: workplan.updatedAt,
            summary: `Revision ${workplan.revision} saved before detailed change logging was enabled.`,
            changes: [],
        };
    }
    const rawChanges = Array.isArray(value.changes) ? value.changes.slice(0, 250) : [];
    const changes = rawChanges.flatMap((change, index) => {
        if (!isRecord(change)) return [];
        const kind = change.kind;
        if (kind !== 'added' && kind !== 'updated' && kind !== 'deleted') return [];
        const rawFields = Array.isArray(change.fields) ? change.fields.slice(0, 20) : [];
        const fields = rawFields.flatMap((field, fieldIndex) => {
            if (!isRecord(field)) return [];
            return [{
                field: boundedString(field.field, `Audit field ${index + 1}.${fieldIndex + 1}`, 80),
                before: boundedString(field.before, `Audit before ${index + 1}.${fieldIndex + 1}`, 500, true),
                after: boundedString(field.after, `Audit after ${index + 1}.${fieldIndex + 1}`, 500, true),
            }];
        });
        return [{
            kind: kind as StrategicWorkplanAuditTaskChange['kind'],
            taskId: boundedString(change.taskId, `Audit task ID ${index + 1}`, 120),
            wbs: boundedString(change.wbs, `Audit WBS ${index + 1}`, 30),
            title: boundedString(change.title, `Audit title ${index + 1}`, 240),
            fields,
        }];
    });
    return {
        editedByUid: boundedString(value.editedByUid, 'Audit editor ID', 128),
        editedByName: boundedString(value.editedByName, 'Audit editor name', 160),
        editedAt: boundedString(value.editedAt, 'Audit timestamp', 40),
        summary: boundedString(value.summary, 'Audit summary', 240),
        changes,
    };
}

function normalizeStrategicWorkplanVersion(value: unknown, teamId: string): StrategicWorkplanVersion {
    const workplan = normalizeStrategicWorkplan(value, teamId);
    const audit = isRecord(value) ? normalizeStrategicWorkplanAudit(value.audit, workplan) : normalizeStrategicWorkplanAudit(null, workplan);
    return { ...workplan, audit };
}
