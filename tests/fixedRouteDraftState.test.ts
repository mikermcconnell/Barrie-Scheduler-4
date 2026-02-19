import { describe, expect, it } from 'vitest';
import {
    buildOpenDraftEditorState,
    getRemainingDraftsAfterBulkDelete,
} from '../utils/workspaces/fixedRouteDraftState';
import type { DraftSchedule } from '../utils/schedule/scheduleTypes';

function buildDraft(id: string): DraftSchedule {
    return {
        id,
        name: `Draft ${id}`,
        routeNumber: '10',
        dayType: 'Weekday',
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user-1',
    };
}

describe('fixedRouteDraftState', () => {
    it('buildOpenDraftEditorState sets a concrete current draft id', () => {
        const content = {
            routeNumber: '10',
            dayType: 'Weekday',
            northTable: { routeName: '10 North', stops: [], trips: [] },
            southTable: { routeName: '10 South', stops: [], trips: [] },
        } as any;

        const state = buildOpenDraftEditorState('draft-42', content);

        expect(state.currentEditorDraftId).toBe('draft-42');
        expect(state.initialContent).toBe(content);
    });

    it('retains only drafts that failed to delete', () => {
        const drafts = [buildDraft('a'), buildDraft('b'), buildDraft('c')];
        const deletedIds = new Set(['a', 'c']);

        const remaining = getRemainingDraftsAfterBulkDelete(drafts, deletedIds);

        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('b');
    });
});
