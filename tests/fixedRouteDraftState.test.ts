import { describe, expect, it } from 'vitest';
import {
    buildOpenDraftEditorState,
    buildInitialSiblingEditorState,
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

        const updatedAt = new Date('2026-03-11T10:00:00Z');
        const state = buildOpenDraftEditorState({ id: 'draft-42', name: 'Existing Draft', updatedAt }, content);

        expect(state.currentEditorDraftId).toBe('draft-42');
        expect(state.currentEditorDraftName).toBe('Existing Draft');
        expect(state.currentEditorDraftUpdatedAt).toBe(updatedAt);
        expect(state.initialContent).toBe(content);
    });

    it('aligns the initial sibling selection with the sorted draft that has content', () => {
        const state = buildInitialSiblingEditorState([
            {
                id: 'route-20',
                name: 'Route 20',
                routeNumber: '20',
                dayType: 'Weekday',
                content: {
                    northTable: { routeName: '20 (Weekday) (North)', stops: [], stopIds: {}, trips: [] },
                    southTable: { routeName: '20 (Weekday) (South)', stops: [], stopIds: {}, trips: [] },
                    metadata: { routeNumber: '20', dayType: 'Weekday', uploadedAt: '2026-03-11T10:00:00Z' }
                }
            },
            {
                id: 'route-5',
                name: 'Route 5',
                routeNumber: '5',
                dayType: 'Weekday',
                content: {
                    northTable: { routeName: '5 (Weekday) (North)', stops: [], stopIds: {}, trips: [] },
                    southTable: { routeName: '5 (Weekday) (South)', stops: [], stopIds: {}, trips: [] },
                    metadata: { routeNumber: '5', dayType: 'Weekday', uploadedAt: '2026-03-11T10:00:00Z' }
                }
            }
        ]);

        expect(state).not.toBeNull();
        expect(state?.currentEditorDraftId).toBe('route-5');
        expect(state?.initialContent.metadata?.routeNumber).toBe('5');
        expect(state?.siblingDrafts.map(draft => draft.id)).toEqual(['route-5', 'route-20']);
    });

    it('retains only drafts that failed to delete', () => {
        const drafts = [buildDraft('a'), buildDraft('b'), buildDraft('c')];
        const deletedIds = new Set(['a', 'c']);

        const remaining = getRemainingDraftsAfterBulkDelete(drafts, deletedIds);

        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('b');
    });
});
