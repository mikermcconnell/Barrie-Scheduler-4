import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canReadRidershipTrend } from '../functions/src/sharedWorkspaceData';

const storageRules = readFileSync('storage.rules', 'utf8');
const sharedWorkspaceSource = readFileSync('functions/src/sharedWorkspaceData.ts', 'utf8');

describe('Ridership Trends backend access', () => {
    const decoded = (schedulerAdmin = false) => ({ schedulerAdmin }) as never;
    const member = (accessLevel: string, override?: boolean) => ({
        accessLevel,
        workspaceOverrides: override === undefined ? {} : { analyticsRidershipTrend: override },
    }) as never;

    it('defaults to planning roles and honors an explicit override', () => {
        expect(canReadRidershipTrend(member('planner'), decoded())).toBe(true);
        expect(canReadRidershipTrend(member('admin'), decoded())).toBe(true);
        expect(canReadRidershipTrend(member('internal'), decoded())).toBe(true);
        expect(canReadRidershipTrend(member('production'), decoded())).toBe(false);
        expect(canReadRidershipTrend(member('planner', false), decoded())).toBe(false);
        expect(canReadRidershipTrend(member('production', true), decoded())).toBe(true);
    });

    it('keeps the compact Storage view behind its dedicated permission', () => {
        expect(storageRules).toMatch(
            /match \/teams\/\{teamId\}\/performanceViews\/ridership-trends\/\{generation\} \{[\s\S]*?generation[.]matches\('\^\[0-9\]\+\[.]json\$'\)[\s\S]*?canAccessWorkspace\(teamId, 'analyticsRidershipTrend'\)[\s\S]*?canSupportReadTeamData\(teamId\)[\s\S]*?allow write:[\s\S]*?isTeamManager\(teamId\)[\s\S]*?canSupportWriteTeamData\(teamId\)/,
        );
        expect(storageRules).not.toMatch(
            /performanceViews\/ridership-trends[\s\S]{0,300}workspaceOperations/,
        );
    });

    it('shares only a derived On Demand ridership projection through the same access boundary', () => {
        expect(sharedWorkspaceSource).toContain("case 'ridershipTrendTod':");
        expect(sharedWorkspaceSource).toContain("case 'strategicPlanRidershipTod':");
        expect(sharedWorkspaceSource).toContain('return summary ? createTodRidershipProjection(summary) : null;');
        expect(sharedWorkspaceSource).toContain("payload.workspace === 'ridershipTrendTod'");
        expect(sharedWorkspaceSource).toContain("payload.workspace === 'strategicPlanRidershipTod'");
    });
});
