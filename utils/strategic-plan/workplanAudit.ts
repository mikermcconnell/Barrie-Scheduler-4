import type {
    StrategicWorkplanAuditEntry,
    StrategicWorkplanAuditFieldChange,
    StrategicWorkplanAuditTaskChange,
    StrategicWorkplanDocument,
    StrategicWorkplanTask,
} from './workplanTypes';

const AUDITED_FIELDS: ReadonlyArray<{
    key: keyof StrategicWorkplanTask;
    label: string;
}> = [
    { key: 'wbs', label: 'WBS' },
    { key: 'title', label: 'Task name' },
    { key: 'phaseId', label: 'Phase ID' },
    { key: 'phaseName', label: 'Phase' },
    { key: 'chapter', label: 'Chapter' },
    { key: 'ownership', label: 'Ownership' },
    { key: 'startDate', label: 'Start date' },
    { key: 'endDate', label: 'End date' },
    { key: 'status', label: 'Status' },
    { key: 'progress', label: 'Progress' },
    { key: 'dependencies', label: 'Dependencies' },
    { key: 'notes', label: 'Update note' },
    { key: 'segments', label: 'Milestones and review windows' },
];

function truncate(value: string, maximum = 400): string {
    return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function displayValue(key: keyof StrategicWorkplanTask, value: StrategicWorkplanTask[keyof StrategicWorkplanTask]): string {
    if (value === null || value === '') return 'Not set';
    if (key === 'dependencies') return (value as string[]).join(', ') || 'None';
    if (key === 'segments') {
        const segments = value as StrategicWorkplanTask['segments'];
        return segments.length === 0
            ? 'None'
            : truncate(segments.map(segment => `${segment.label} (${segment.type}, ${segment.startDate} to ${segment.endDate})`).join('; '));
    }
    if (key === 'notes') return truncate(String(value), 400) || 'Not set';
    if (key === 'progress') return `${value}%`;
    return truncate(String(value));
}

function fieldChanges(before: StrategicWorkplanTask, after: StrategicWorkplanTask): StrategicWorkplanAuditFieldChange[] {
    return AUDITED_FIELDS.flatMap(({ key, label }) => {
        if (JSON.stringify(before[key]) === JSON.stringify(after[key])) return [];
        return [{
            field: label,
            before: displayValue(key, before[key]),
            after: displayValue(key, after[key]),
        }];
    });
}

export function buildStrategicWorkplanAudit(
    before: StrategicWorkplanDocument | null,
    after: StrategicWorkplanDocument,
    editor: { uid: string; name: string },
    editedAt: string,
): StrategicWorkplanAuditEntry {
    const beforeById = new Map((before?.tasks ?? []).map(task => [task.id, task]));
    const afterById = new Map(after.tasks.map(task => [task.id, task]));
    const changes: StrategicWorkplanAuditTaskChange[] = [];

    after.tasks.forEach(task => {
        const previous = beforeById.get(task.id);
        if (!previous) {
            changes.push({
                kind: 'added',
                taskId: task.id,
                wbs: task.wbs,
                title: task.title,
                fields: [{ field: 'Task', before: 'Not present', after: 'Added' }],
            });
            return;
        }
        const fields = fieldChanges(previous, task);
        if (fields.length > 0) {
            changes.push({ kind: 'updated', taskId: task.id, wbs: task.wbs, title: task.title, fields });
        }
    });

    before?.tasks.forEach(task => {
        if (!afterById.has(task.id)) {
            changes.push({
                kind: 'deleted',
                taskId: task.id,
                wbs: task.wbs,
                title: task.title,
                fields: [{ field: 'Task', before: 'Present', after: 'Deleted' }],
            });
        }
    });

    const fieldCount = changes.reduce((total, change) => total + change.fields.length, 0);
    const isInitialPublication = before?.revision === 0 && after.revision === 1;
    const summary = before === null
        ? `Published proposal baseline with ${after.tasks.length} tasks.`
        : isInitialPublication && changes.length === 0
            ? `Published proposal baseline with ${after.tasks.length} tasks.`
            : isInitialPublication
                ? `Published proposal baseline with ${after.tasks.length} tasks and changed ${changes.length} task${changes.length === 1 ? '' : 's'} across ${fieldCount} field${fieldCount === 1 ? '' : 's'}.`
        : changes.length === 0
            ? 'Saved a new revision with no task-field changes.'
            : `Changed ${changes.length} task${changes.length === 1 ? '' : 's'} across ${fieldCount} field${fieldCount === 1 ? '' : 's'}.`;

    return {
        editedByUid: editor.uid,
        editedByName: truncate(editor.name.trim() || 'Project team member', 160),
        editedAt,
        summary,
        changes,
    };
}
