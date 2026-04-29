import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(path: string) {
  return readFileSync(path, 'utf8');
}

describe('security rules regression checks', () => {
  it('does not use users/{uid}.teamId as a team authorization fallback', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).not.toMatch(/get\([^)]*\/users\/\$\(request\.auth\.uid\)\)\.data\.teamId == teamId/);
    expect(storageRules).not.toMatch(/get\([^)]*\/users\/\$\(request\.auth\.uid\)\)\.data\.teamId == teamId/);
  });

  it('does not leave team documents publicly readable', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    expect(firestoreRules).not.toContain('allow read: if true;');
  });

  it('restricts master schedule writes to team managers instead of all team members', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/masterSchedules\/\{scheduleId\} \{[\s\S]*allow read: if isTeamMember\(teamId\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| isWorkspacePermissionManager\(\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/masterSchedules\/\{allPaths=\*\*\} \{[\s\S]*allow read: if isTeamMember\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\);/);
  });

  it('restricts Fleet Plan writes to team managers and keeps versions readable by members', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/fleetPlan\/\{docId\} \{[\s\S]*allow read: if isTeamMember\(teamId\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| isWorkspacePermissionManager\(\);[\s\S]*match \/versions\/\{versionId\} \{[\s\S]*allow read: if isTeamMember\(teamId\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| isWorkspacePermissionManager\(\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/fleetPlan\/\{allPaths=\*\*\} \{[\s\S]*allow read: if isTeamMember\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\);/);
  });
});
