import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const firestoreRules = readFileSync('firestore.rules', 'utf8');

describe('Council Intelligence Firestore rules', () => {
    it('allows entitled reads but restricts writes to team management or scoped support', () => {
        expect(firestoreRules).toMatch(
            /match \/councilIntelligence\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsCouncilIntelligence'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow write: if isTeamOwnerOrAdmin\(teamId\) \|\| canSupportWriteTeamData\(teamId\);[\s\S]*match \/\{nestedDoc=\*\*\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsCouncilIntelligence'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow write: if isTeamOwnerOrAdmin\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/,
        );
    });
});
