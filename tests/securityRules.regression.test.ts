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
    expect(firestoreRules).toMatch(/allow get: if isTeamMember\(teamId\) \|\| isWorkspacePermissionManager\(\) \|\| canReadTeamForInviteJoin\(teamId\);/);
    expect(firestoreRules).toMatch(/allow list: if isWorkspacePermissionManager\(\);/);
  });

  it('allows team owners and admins to update team settings', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/teams\/\{teamId\} \{[\s\S]*allow update, delete: if request\.auth != null &&[\s\S]*\(isTeamOwnerOrAdmin\(teamId\) \|\| isWorkspacePermissionManager\(\)\);/);
  });

  it('restricts master schedule writes to team managers instead of all team members', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/masterSchedules\/\{scheduleId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'workspaceFixedRoute'\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| isWorkspacePermissionManager\(\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/masterSchedules\/\{allPaths=\*\*\} \{[\s\S]*allow read: if isTeamMember\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\);/);
  });

  it('restricts Fleet Plan writes to team managers and reads to users with Fleet Plan access', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/fleetPlan\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsFleetPlan'\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| isWorkspacePermissionManager\(\);[\s\S]*match \/versions\/\{versionId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsFleetPlan'\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| isWorkspacePermissionManager\(\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/fleetPlan\/\{allPaths=\*\*\} \{[\s\S]*allow read: if isTeamMember\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\);/);
  });

  it('gates Route Planner 2 saved route concepts by workspace access', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/routePlanner2Projects\/\{projectId\} \{[\s\S]*allow read, write: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\);[\s\S]*match \/scenarios\/\{scenarioId\} \{[\s\S]*allow read, write: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\);/);
  });

  it('gates Transit App Data and OD Matrix by workspace access', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/transitAppData\/\{docId\} \{[\s\S]*allow read, write: if canAccessWorkspace\(teamId, 'analyticsTransitApp'\);/);
    expect(firestoreRules).toMatch(/match \/odMatrixData\/\{docId\} \{[\s\S]*allow read, write: if canAccessWorkspace\(teamId, 'analyticsOdMatrix'\);/);
    expect(firestoreRules).toMatch(/accessLevel == 'transit-app-only' &&[\s\S]*feature == 'analyticsTransitApp'/);
    expect(firestoreRules).toMatch(/accessLevel == 'external-planner' &&[\s\S]*feature == 'analyticsTransitApp'/);
    expect(firestoreRules).not.toMatch(/accessLevel == 'external-planner' &&[\s\S]*feature in \[[\s\S]*workspaceFixedRoute/);
    expect(firestoreRules).not.toMatch(/accessLevel == 'none' &&[\s\S]*feature/);
  });

  it('keeps old owner and admin member docs working when accessLevel is missing', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/member\.data\.accessLevel is string[\s\S]*member\.data\.role == 'owner' \|\| member\.data\.role == 'admin'[\s\S]*'internal'[\s\S]*'planner'/);
  });

  it('requires a Firebase custom claim for global workspace permission management', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/function isWorkspacePermissionManager\(\) \{[\s\S]*request\.auth\.token\.schedulerAdmin == true/);
    expect(firestoreRules).not.toMatch(/currentUserAccessLevel\(\) == 'admin'/);
    expect(firestoreRules).not.toMatch(/currentUserAccessLevel\(\) == 'internal'/);
    expect(firestoreRules).not.toMatch(/currentUserTeamRole\(\) == 'owner'/);
    expect(firestoreRules).not.toMatch(/currentUserTeamRole\(\) == 'admin'/);
  });

  it('lets global permission managers update member workspace overrides without broader member edits', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(
      /isWorkspacePermissionManager\(\) &&[\s\S]*affectedKeys\(\)\.hasOnly\(\['accessLevel', 'workspaceOverrides'\]\)/
    );
  });

  it('requires invite validation for self-creating a team membership', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/canCreateSelfFromInvite\(teamId, memberId\)/);
    expect(firestoreRules).not.toMatch(/allow create: if request\.auth != null &&[\s\S]*request\.auth\.uid == memberId \|\|/);
  });
});
