import type { DraftBasedOn, DraftSchedule } from '../schedule/scheduleTypes';
import type { MasterScheduleContent } from '../masterScheduleTypes';

export interface EditorDraftSession {
    id: string;
    name?: string;
    updatedAt?: Date;
}

export interface OpenDraftEditorState {
    initialContent: MasterScheduleContent;
    basedOn?: DraftBasedOn;
    currentEditorDraftId: string;
    currentEditorDraftName?: string;
    currentEditorDraftUpdatedAt?: Date;
}

export interface SiblingDraftCandidate {
    id: string;
    name: string;
    routeNumber: string;
    dayType: string;
    tripCount?: number;
    content?: MasterScheduleContent;
    basedOn?: DraftBasedOn;
    updatedAt?: Date;
}

export interface InitialSiblingEditorState extends OpenDraftEditorState {
    siblingDrafts: Array<Pick<SiblingDraftCandidate, 'id' | 'name' | 'routeNumber' | 'dayType' | 'tripCount'>>;
}

export function buildOpenDraftEditorState(
    draft: EditorDraftSession,
    content: MasterScheduleContent,
    basedOn?: DraftBasedOn
): OpenDraftEditorState {
    return {
        initialContent: content,
        basedOn,
        currentEditorDraftId: draft.id,
        currentEditorDraftName: draft.name,
        currentEditorDraftUpdatedAt: draft.updatedAt,
    };
}

export function buildInitialSiblingEditorState(
    drafts: SiblingDraftCandidate[]
): InitialSiblingEditorState | null {
    const sortedDrafts = [...drafts].sort((a, b) => {
        const routeCompare = (a.routeNumber || '').localeCompare(b.routeNumber || '', undefined, { numeric: true });
        if (routeCompare !== 0) return routeCompare;
        const dayOrder: Record<string, number> = { Weekday: 0, Saturday: 1, Sunday: 2 };
        return (dayOrder[a.dayType] || 0) - (dayOrder[b.dayType] || 0);
    });

    const initialDraft = sortedDrafts.find(draft => !!draft.content);
    if (!initialDraft?.content) {
        return null;
    }

    return {
        siblingDrafts: sortedDrafts.map(({ content: _content, basedOn: _basedOn, updatedAt: _updatedAt, ...draft }) => draft),
        initialContent: initialDraft.content,
        basedOn: initialDraft.basedOn,
        currentEditorDraftId: initialDraft.id,
        currentEditorDraftName: initialDraft.name,
        currentEditorDraftUpdatedAt: initialDraft.updatedAt,
    };
}

export function getRemainingDraftsAfterBulkDelete(
    drafts: DraftSchedule[],
    deletedDraftIds: Set<string>
): DraftSchedule[] {
    return drafts.filter(draft => !draft.id || !deletedDraftIds.has(draft.id));
}
