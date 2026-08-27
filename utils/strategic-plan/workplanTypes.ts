export const STRATEGIC_WORKPLAN_SCHEMA_VERSION = 1 as const;

export type StrategicWorkplanOwnership = 'Staff' | 'Consultant' | 'Joint' | 'Unassigned';

export type StrategicWorkplanStatus =
    | 'unconfirmed'
    | 'not-started'
    | 'in-progress'
    | 'at-risk'
    | 'blocked'
    | 'complete';

export type StrategicWorkplanSegmentType =
    | 'task'
    | 'draft-deliverable'
    | 'review'
    | 'final-deliverable'
    | 'project-initiation'
    | 'project-team-meeting'
    | 'working-session'
    | 'council-presentation'
    | 'engagement-event';

export interface StrategicWorkplanSegment {
    id: string;
    type: StrategicWorkplanSegmentType;
    label: string;
    startDate: string;
    endDate: string;
    datePrecision: 'week';
}

export interface StrategicWorkplanTask {
    id: string;
    wbs: string;
    phaseId: string;
    phaseName: string;
    chapter: string | null;
    title: string;
    ownership: StrategicWorkplanOwnership;
    startDate: string | null;
    endDate: string | null;
    status: StrategicWorkplanStatus;
    progress: number;
    dependencies: string[];
    notes: string;
    segments: StrategicWorkplanSegment[];
}

export interface StrategicWorkplanSource {
    title: string;
    organization: string;
    proposalDate: string;
    fileName: string;
    schedulePages: string;
    importedAt: string;
    datePrecision: 'week';
    note: string;
}

export interface StrategicWorkplanDocument {
    schemaVersion: typeof STRATEGIC_WORKPLAN_SCHEMA_VERSION;
    teamId: string;
    revision: number;
    name: string;
    scheduleStart: string;
    scheduleEnd: string;
    source: StrategicWorkplanSource;
    tasks: StrategicWorkplanTask[];
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
}

export const STRATEGIC_WORKPLAN_STATUSES: ReadonlyArray<{
    value: StrategicWorkplanStatus;
    label: string;
}> = [
    { value: 'unconfirmed', label: 'Unconfirmed' },
    { value: 'not-started', label: 'Not started' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'at-risk', label: 'At risk' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'complete', label: 'Complete' },
];
