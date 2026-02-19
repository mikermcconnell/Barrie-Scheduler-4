import type { DraftBasedOn, DraftSchedule } from '../schedule/scheduleTypes';
import type { MasterScheduleContent } from '../masterScheduleTypes';

export interface OpenDraftEditorState {
    initialContent: MasterScheduleContent;
    basedOn?: DraftBasedOn;
    currentEditorDraftId: string;
}

export function buildOpenDraftEditorState(
    draftId: string,
    content: MasterScheduleContent,
    basedOn?: DraftBasedOn
): OpenDraftEditorState {
    return {
        initialContent: content,
        basedOn,
        currentEditorDraftId: draftId,
    };
}

export function getRemainingDraftsAfterBulkDelete(
    drafts: DraftSchedule[],
    deletedDraftIds: Set<string>
): DraftSchedule[] {
    return drafts.filter(draft => !draft.id || !deletedDraftIds.has(draft.id));
}
