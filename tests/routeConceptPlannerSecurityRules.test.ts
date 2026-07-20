import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Route Concept Planner security rules', () => {
    it('uses its isolated collection and workspace permission at every level', () => {
        const rules = readFileSync('firestore.rules', 'utf8');
        const block = rules.match(/match \/routeConceptPlannerProjects\/\{projectId\} \{([\s\S]*?)\/\/ Future team-scoped collections/)?.[1] ?? '';

        expect(block).toContain("canAccessWorkspace(teamId, 'analyticsRouteConceptPlanner')");
        expect(block).toMatch(/match \/alternatives\/\{alternativeId\}/);
        expect(block).toMatch(/match \/patterns\/\{patternId\}/);
        expect(block).toContain('isValidRouteConceptProjectCreate(teamId, projectId)');
        expect(block).toContain('isValidRouteConceptProjectUpdate(teamId, projectId)');
        expect(block).toContain('allow delete: if false;');
        expect(block).not.toContain('analyticsRoutePlanner2');
    });

    it('enforces schema, identity, monotonic revisions, and coupled child writes', () => {
        const rules = readFileSync('firestore.rules', 'utf8');

        expect(rules).toMatch(/data\.schemaVersion == 1 && data\.revision == 1/);
        expect(rules).toMatch(/data\.status in \['local-saved', 'archived'\]/);
        expect(rules).toMatch(/data\.revision == resource\.data\.revision \+ 1/);
        expect(rules).toMatch(/data\.id == projectId && data\.teamId == teamId/);
        expect(rules).toMatch(/data\.updatedBy == request\.auth\.uid/);
        expect(rules).toMatch(/function isRouteConceptChildDeleteCoupled\(teamId, projectId\)/);
        expect(rules).toMatch(/getAfter\(rootPath\)\.data\.revision == get\(rootPath\)\.data\.revision \+ 1/);
        expect(rules).toMatch(/alternativeId in root\.data\.alternativeOrder/);
        expect(rules).toMatch(/patternId in alternative\.data\.payload\.patternOrder/);
        expect(rules).toContain('isValidRouteConceptAlternativePayload(data.payload, alternativeId)');
        expect(rules).toContain('isValidRouteConceptPatternPayload(data.payload, patternId)');
    });
});
