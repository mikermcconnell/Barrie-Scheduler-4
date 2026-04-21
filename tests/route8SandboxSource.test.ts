import { describe, expect, it } from 'vitest';
import { buildRoute8SandboxContentFromMasters, buildRoute8SandboxProjectName } from '../utils/route8-sandbox/route8SandboxSource';
import { createRoute8MasterPairFixture } from './route8SandboxFixtures';

describe('route8SandboxSource', () => {
    it('builds sandbox content with pinned source snapshots and detached working copies', () => {
        const masters = createRoute8MasterPairFixture();
        const content = buildRoute8SandboxContentFromMasters(masters, 'Weekday');

        expect(content.sourceSnapshots['8A'].version).toBe(3);
        expect(content.sourceSnapshots['8B'].version).toBe(5);
        expect(content.workingCopies['8A']).not.toBe(content.sourceCopies['8A']);

        content.workingCopies['8A'].northTable.trips[0]!.blockId = 'changed';
        expect(content.sourceCopies['8A'].northTable.trips[0]!.blockId).toBe('801');
    });

    it('builds a readable project name', () => {
        const name = buildRoute8SandboxProjectName('Saturday', new Date('2026-04-17T12:00:00.000Z'));
        expect(name).toContain('Route 8 Sandbox');
        expect(name).toContain('Saturday');
    });
});
