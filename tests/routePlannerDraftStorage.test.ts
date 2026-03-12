import { describe, expect, it } from 'vitest';
import {
    getRoutePlannerDraftStorageKey,
    parseRoutePlannerDraft,
    serializeRoutePlannerDraft,
} from '../utils/route-planner/routePlannerDraftStorage';
import { createDraftRouteProject } from '../utils/route-planner/routePlannerDrafts';

describe('routePlannerDraftStorage', () => {
    it('builds a stable storage key by mode and team', () => {
        expect(getRoutePlannerDraftStorageKey('route-concept', 'team-1')).toBe(
            'scheduler4:route-planner:draft:route-concept:team-1'
        );
    });

    it('serializes and parses a route project draft', () => {
        const project = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');

        const parsed = parseRoutePlannerDraft(serializeRoutePlannerDraft(project));

        expect(parsed).not.toBeNull();
        expect(parsed?.name).toBe(project.name);
        expect(parsed?.createdAt).toBeInstanceOf(Date);
        expect(parsed?.updatedAt).toBeInstanceOf(Date);
        expect(parsed?.scenarios[0]?.name).toBe(project.scenarios[0]?.name);
    });

    it('returns null for invalid draft payloads', () => {
        expect(parseRoutePlannerDraft('{"bad":true}')).toBeNull();
    });
});
