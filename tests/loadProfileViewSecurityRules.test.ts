import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Load Profiles view storage boundary', () => {
    it('keeps compact views outside the broadly readable performanceData prefix', () => {
        const rules = fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf8');
        const block = rules.match(
            /match \/teams\/\{teamId\}\/performanceViews\/load-profiles\/\{allPaths=\*\*\} \{([\s\S]*?)\n    \}/,
        )?.[1] ?? '';

        expect(block).toContain('allow read: if canSupportReadTeamData(teamId);');
        expect(block).toContain('allow write: if isTeamManager(teamId) || canSupportWriteTeamData(teamId);');
        expect(block).not.toContain("canAccessWorkspace(teamId, 'workspaceOperations')");
    });

    it('limits performance publishing metadata to team managers', () => {
        const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
        const block = rules.match(
            /match \/performanceData\/\{docId\} \{([\s\S]*?)\n      \}/,
        )?.[1] ?? '';

        expect(block).toContain('allow write: if isTeamOwnerOrAdmin(teamId) || canSupportWriteTeamData(teamId);');
        expect(block).not.toContain('allow write: if isTeamMember(teamId)');
    });
});
