import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TOD zone security rules', () => {
    it('keeps drafts manager-only and publications immutable', () => {
        const rules = readFileSync('firestore.rules', 'utf8');
        const block = rules.match(/match \/todZoneConfig\/\{configId\} \{([\s\S]*?)\/\/ Shared department parking/)?.[1] ?? '';
        expect(block).toContain('isTeamMember(teamId)');
        expect(block).toContain('isTeamOwnerOrAdmin(teamId)');
        expect(block).toContain("configId == 'default'");
        expect(block).toContain('request.resource.data.revision == resource.data.revision + 1');
        expect(block).toContain('match /versions/{versionId}');
        expect(block).toContain('allow update, delete: if false;');
        expect(rules).toContain('data.polygons.size() <= 80');
        expect(rules).toContain('data.connectionStops.size() <= 1500');
        expect(rules).toContain('data.schemaVersion == 4');
        expect(rules).toContain('data.polygons.size() > 0');
        expect(rules).toContain('(0[1-9]|1[0-2])');
        expect(rules).toContain('root.data.lastPublishedVersionId == versionId');
    });
});
