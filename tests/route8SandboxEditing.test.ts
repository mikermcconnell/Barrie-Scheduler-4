import { describe, expect, it } from 'vitest';
import { getRoute8BranchSchedules, resetRoute8BranchToSource, updateRoute8BranchSchedules } from '../utils/route8-sandbox/route8SandboxEditing';
import { createRoute8SandboxContentFixture } from './route8SandboxFixtures';

describe('route8SandboxEditing', () => {
    it('returns copied schedules for a branch', () => {
        const content = createRoute8SandboxContentFixture();
        const schedules = getRoute8BranchSchedules(content, '8A');

        expect(schedules).toHaveLength(2);
        expect(schedules[0]?.routeName).toContain('8A');
    });

    it('updates only the working branch schedules', () => {
        const content = createRoute8SandboxContentFixture();
        const schedules = getRoute8BranchSchedules(content, '8A');
        schedules[0]!.trips[0]!.blockId = '999';

        const updated = updateRoute8BranchSchedules(content, '8A', schedules);

        expect(updated.workingCopies['8A'].northTable.trips[0]!.blockId).toBe('999');
        expect(updated.sourceCopies['8A'].northTable.trips[0]!.blockId).toBe('801');
        expect(updated.workingCopies['8B'].northTable.trips[0]!.blockId).toBe('801');
    });

    it('resets a branch back to its copied source', () => {
        const content = createRoute8SandboxContentFixture();
        content.workingCopies['8B'].southTable.trips[0]!.blockId = 'changed';

        const reset = resetRoute8BranchToSource(content, '8B');

        expect(reset.workingCopies['8B'].southTable.trips[0]!.blockId).toBe('801');
    });
});
