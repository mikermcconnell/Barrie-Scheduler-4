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

  it('allows own-team managers or scoped developer edit sessions to update team settings', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/teams\/\{teamId\} \{[\s\S]*allow update: if request\.auth != null &&[\s\S]*isTeamOwnerOrAdmin\(teamId\)[\s\S]*canSupportWriteTeamData\(teamId\)[\s\S]*allow delete: if request\.auth != null/);
  });

  it('restricts master schedule writes to team managers instead of all team members', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/masterSchedules\/\{scheduleId\} \{[\s\S]*canReadSharedMasterSchedules\(teamId\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/masterSchedules\/\{allPaths=\*\*\} \{[\s\S]*canReadSharedMasterSchedules\(teamId\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
  });

  it('restricts Fleet Plan writes to team managers and reads to users with Fleet Plan access', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/fleetPlan\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsFleetPlan'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/fleetPlan\/\{allPaths=\*\*\} \{[\s\S]*allow read: if isTeamMember\(teamId\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
  });

  it('gates Route Planner 2 saved route concepts by workspace access', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/routePlanner2Projects\/\{projectId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow write: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\) \|\| canSupportWriteTeamData\(teamId\);/);
  });

  it('gates Transit App Data and OD Matrix by workspace access', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/transitAppData\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsTransitApp'\) \|\| canSupportReadTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/match \/odMatrixData\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsOdMatrix'\) \|\| canSupportReadTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/accessLevel == 'transit-app-only' &&[\s\S]*feature == 'analyticsTransitApp'/);
    expect(firestoreRules).toMatch(/accessLevel == 'external-planner' &&[\s\S]*feature == 'analyticsTransitApp'/);
    expect(firestoreRules).toMatch(/accessLevel == 'parking' &&[\s\S]*feature == 'workspaceParking'/);
    expect(firestoreRules).not.toMatch(/accessLevel == 'external-planner' &&[\s\S]*feature in \[[\s\S]*workspaceFixedRoute/);
    expect(firestoreRules).not.toMatch(/accessLevel == 'none' &&[\s\S]*feature/);
  });

  it('allows Parking workspace users to import and maintain Parking data', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/parking\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'workspaceParking'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow create, update, delete: if canAccessWorkspace\(teamId, 'workspaceParking'\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/parking\/\{allPaths=\*\*\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'workspaceParking'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow write: if canAccessWorkspace\(teamId, 'workspaceParking'\) \|\| canSupportWriteTeamData\(teamId\);/);
  });

  it('keeps old owner and admin member docs working when accessLevel is missing', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/let accessLevel = member\.data\.get\('accessLevel', null\);/);
    expect(firestoreRules).toMatch(/member\.data\.get\('role', 'member'\) == 'owner'[\s\S]*member\.data\.get\('role', 'member'\) == 'admin'[\s\S]*'internal'[\s\S]*'planner'/);
  });

  it('reads optional workspace overrides safely in Firestore rules', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/\.get\('workspaceOverrides', \{\}\)[\s\S]*\.get\(feature, null\)/);
    expect(firestoreRules).not.toMatch(/\.data\.workspaceOverrides\[feature\]/);
  });

  it('requires a Firebase custom claim for global workspace permission management', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/function isSchedulerAdmin\(\) \{[\s\S]*request\.auth\.token\.get\('schedulerAdmin', false\) == true/);
    expect(storageRules).toMatch(/function isSchedulerAdmin\(\) \{[\s\S]*request\.auth\.token\.get\('schedulerAdmin', false\) == true/);
    expect(firestoreRules).not.toMatch(/request\.auth\.token\.(schedulerAdmin|admin|globalAdmin) == true/);
    expect(storageRules).not.toMatch(/request\.auth\.token\.(schedulerAdmin|admin|globalAdmin) == true/);
    expect(firestoreRules).not.toMatch(/currentUserAccessLevel\(\) == 'admin'/);
    expect(firestoreRules).not.toMatch(/currentUserAccessLevel\(\) == 'internal'/);
    expect(firestoreRules).not.toMatch(/currentUserTeamRole\(\) == 'owner'/);
    expect(firestoreRules).not.toMatch(/currentUserTeamRole\(\) == 'admin'/);
  });

  it('requires a scoped edit session for cross-team member workspace overrides', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(
      /canSupportWriteTeamData\(teamId\) &&[\s\S]*affectedKeys\(\)\.hasOnly\(\['accessLevel', 'workspaceOverrides'\]\)/
    );
  });

  it('requires invite validation for self-creating a team membership', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const memberRules = firestoreRules.match(
      /match \/members\/\{memberId\} \{([\s\S]*?)\/\/ Master Schedules/
    )?.[1] ?? '';
    const memberCreateRule = memberRules.match(/allow create:([\s\S]*?);/)?.[1] ?? '';

    expect(memberCreateRule).toMatch(/canCreateSelfFromInvite\(teamId, memberId\)/);
    expect(memberCreateRule).not.toMatch(/request\.auth\.uid == memberId \|\|/);
  });

  it('requires an expiring, team-scoped scheduler-admin support session', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');
    const callable = readRepoFile('functions/src/developerSupportAccess.ts');
    const clientService = readRepoFile('utils/services/developerSupportSessionService.ts');

    expect(firestoreRules).toMatch(/match \/developerSupportSessions\/\{adminUid\}[\s\S]*request\.auth\.uid == adminUid/);
    expect(firestoreRules).toMatch(/match \/developerSupportSessions\/\{adminUid\}[\s\S]*allow create, update, delete: if false;/);
    expect(firestoreRules).toMatch(/function canSupportWriteTeamData\(teamId\)[\s\S]*supportSession\(\)\.data\.mode == 'edit'/);
    expect(storageRules).toMatch(/function canSupportWriteTeamData\(teamId\)[\s\S]*supportSession\(\)\.data\.mode == 'edit'/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/routeMaps\/[\s\S]*canSupportReadTeamData\(teamId\)[\s\S]*canSupportWriteTeamData\(teamId\)/);
    expect(callable).toMatch(/request\.auth\?\.token\.schedulerAdmin !== true/);
    expect(callable).toMatch(/durationMinutes > MAX_DURATION_MINUTES/);
    expect(callable).toMatch(/transaction\.get\(teamRef\)/);
    expect(clientService).toMatch(/httpsCallable\(getFunctions\(app\), 'developerSupportAccess'\)/);
  });

  it('keeps cross-team data-source links under scoped developer edit control', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/isTeamOwnerOrAdmin\(teamId\)[\s\S]*affectedKeys\(\)\.hasAny\(\['dataSourceTeamIds'\]\)[\s\S]*canSupportWriteTeamData\(teamId\)/);
  });

  it('keeps support audit entries append-only and attributed to the caller', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const callable = readRepoFile('functions/src/developerSupportAccess.ts');

    expect(firestoreRules).toMatch(/match \/developerSupportAudit\/\{auditId\}[\s\S]*allow get, list: if isSchedulerAdmin\(\);[\s\S]*allow create, update, delete: if false;/);
    expect(callable).toMatch(/transaction\.set\(auditRef,[\s\S]*action: 'stop'/);
    expect(callable).toMatch(/action: 'start',[\s\S]*adminUid: uid/);
    expect(callable).toMatch(/transaction\.delete\(sessionRef\)/);
  });

  it('enforces the File Manager upload size limit in Storage rules', () => {
    const storageRules = readRepoFile('storage.rules');

    expect(storageRules).toMatch(/match \/users\/\{userId\}\/files\/[\s\S]*request\.resource\.size > 0[\s\S]*request\.resource\.size <= 25 \* 1024 \* 1024/);
    expect(storageRules).toMatch(/allPaths\.matches\('\.\*\\\\\.\[cC\]\[sS\]\[vV\]/);
  });

  it('validates trusted File Manager attribution and avoids recursive owner-write bypasses', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/function isValidUploadedFileCreate\(userId\)[\s\S]*members\/\$\(userId\)[\s\S]*request\.auth\.token\.get\('email', ''\)/);
    expect(firestoreRules).not.toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
    expect(storageRules).not.toMatch(/match \/users\/\{userId\}\/\{allPaths=\*\*\}/);
  });
});
