import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(path: string) {
  return readFileSync(path, 'utf8');
}

describe('security rules regression checks', () => {
  it('grants scheduler administrators all workspaces only when they belong to the team', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/function canAccessWorkspace\(teamId, feature\) \{[\s\S]*isTeamMember\(teamId\) &&[\s\S]*isSchedulerAdmin\(\)/);
    expect(storageRules).toMatch(/function canAccessWorkspace\(teamId, feature\) \{[\s\S]*isTeamMember\(teamId\) &&[\s\S]*isSchedulerAdmin\(\)/);
  });

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

  it('requires Operations workspace access to read raw performance files', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/performanceData\/\{allPaths=\*\*\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'workspaceOperations'\) \|\| canSupportReadTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/accessLevel == 'admin' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(firestoreRules).toMatch(/accessLevel == 'planner' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(firestoreRules).toMatch(/accessLevel == 'production' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(storageRules).toMatch(/accessLevel == 'admin' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(storageRules).toMatch(/accessLevel == 'planner' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(storageRules).toMatch(/accessLevel == 'production' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(storageRules).not.toMatch(/accessLevel == 'external-planner' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(storageRules).not.toMatch(/accessLevel == 'transit-app-only' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
    expect(storageRules).not.toMatch(/accessLevel == 'parking' &&[\s\S]*?feature in \[[^\]]*'workspaceOperations'[^\]]*\]/);
  });

  it('allows own-team managers or scoped developer edit sessions to update team settings', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/teams\/\{teamId\} \{[\s\S]*allow update: if request\.auth != null &&[\s\S]*isTeamOwnerOrAdmin\(teamId\)[\s\S]*canSupportWriteTeamData\(teamId\)[\s\S]*allow delete: if request\.auth != null/);
  });

  it('shares read-only Master Schedule evidence with Strategic Plan while keeping writes manager-only', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/masterSchedules\/\{scheduleId\} \{[\s\S]*canAccessWorkspace\(teamId, 'workspaceFixedRoute'\) \|\|[\s\S]*canAccessWorkspace\(teamId, 'analyticsStrategicPlan'\) \|\|[\s\S]*canReadSharedMasterSchedules\(teamId\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/masterSchedules\/\{allPaths=\*\*\} \{[\s\S]*canAccessWorkspace\(teamId, 'workspaceFixedRoute'\) \|\|[\s\S]*canAccessWorkspace\(teamId, 'analyticsStrategicPlan'\) \|\|[\s\S]*canReadSharedMasterSchedules\(teamId\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/function canReadSharedMasterSchedules\(sourceTeamId\) \{[\s\S]*canAccessWorkspace\(userTeamId\(\), 'workspaceFixedRoute'\) \|\|[\s\S]*canAccessWorkspace\(userTeamId\(\), 'analyticsStrategicPlan'\)[\s\S]*configuredMasterScheduleSource\(userTeamId\(\)\) == sourceTeamId;/);
    expect(storageRules).toMatch(/function canReadSharedMasterSchedules\(sourceTeamId\) \{[\s\S]*canAccessWorkspace\(userTeamId\(\), 'workspaceFixedRoute'\) \|\|[\s\S]*canAccessWorkspace\(userTeamId\(\), 'analyticsStrategicPlan'\)[\s\S]*configuredMasterScheduleSource\(userTeamId\(\)\) == sourceTeamId;/);
  });

  it('shares active Fleet Plan evidence with Strategic Plan while keeping writes manager-only', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/match \/fleetPlan\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsFleetPlan'\) \|\|[\s\S]*canAccessWorkspace\(teamId, 'analyticsStrategicPlan'\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow create, update, delete: if isTeamOwnerOrAdmin\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/fleetPlan\/\{allPaths=\*\*\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsFleetPlan'\) \|\|[\s\S]*canAccessWorkspace\(teamId, 'analyticsStrategicPlan'\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow write: if isTeamManager\(teamId\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/match \/versions\/\{versionId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsFleetPlan'\) \|\| canSupportReadTeamData\(teamId\);/);
  });

  it('keeps the team work plan under Strategic Plan access with validated revision history', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/strategicPlanWorkplans\/\{workplanId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsStrategicPlan'\)[\s\S]*canAccessSharedStrategicWorkplan\(teamId\)[\s\S]*allow create:[\s\S]*workplanId == 'default'[\s\S]*request\.resource\.data\.revision == 1[\s\S]*allow update:[\s\S]*request\.resource\.data\.revision == resource\.data\.revision \+ 1[\s\S]*allow delete: if false;/);
    expect(firestoreRules).toMatch(/match \/versions\/\{versionId\} \{[\s\S]*allow create:[\s\S]*isValidStrategicWorkplanVersion[\s\S]*allow update, delete: if false;/);
    expect(firestoreRules).toMatch(/function isValidStrategicWorkplanCore[\s\S]*data\.tasks is list && data\.tasks\.size\(\) <= 250[\s\S]*data\.updatedBy == request\.auth\.uid;/);
    expect(firestoreRules).toMatch(/function canAccessSharedStrategicWorkplan[\s\S]*configuredStrategicWorkplanSource\(userTeamId\(\)\) == sourceTeamId;/);
    expect(firestoreRules).toMatch(/function isValidStrategicWorkplanVersion[\s\S]*data\.audit\.editedByUid == request\.auth\.uid[\s\S]*data\.audit\.changes is list && data\.audit\.changes\.size\(\) <= 250[\s\S]*root\.data\.tasks == data\.tasks[\s\S]*root\.data\.updatedBy == data\.updatedBy/);
  });

  it('gates Route Planner 2 saved route concepts by workspace access', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/match \/routePlanner2Projects\/\{projectId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow write: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/match \/runtimeSnapshots\/\{snapshotId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\) \|\| canSupportReadTeamData\(teamId\);[\s\S]*allow write: if canAccessWorkspace\(teamId, 'analyticsRoutePlanner2'\) \|\| canSupportWriteTeamData\(teamId\);/);
  });

  it('shares Transit App reads with Strategic Plan while keeping writes under Transit App access', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');
    const transitAppStorageBlock = storageRules.match(
      /match \/teams\/\{teamId\}\/transitAppData\/\{allPaths=\*\*\} \{([\s\S]*?)\n {4}\}/,
    )?.[1] ?? '';

    expect(firestoreRules).toMatch(/match \/transitAppData\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsTransitApp'\) \|\|[\s\S]*canAccessWorkspace\(teamId, 'analyticsStrategicPlan'\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow write: if canAccessWorkspace\(teamId, 'analyticsTransitApp'\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(storageRules).toMatch(/match \/teams\/\{teamId\}\/transitAppData\/\{allPaths=\*\*\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsTransitApp'\) \|\|[\s\S]*canAccessWorkspace\(teamId, 'analyticsStrategicPlan'\) \|\|[\s\S]*canSupportReadTeamData\(teamId\);[\s\S]*allow write: if canAccessWorkspace\(teamId, 'analyticsTransitApp'\) \|\| canSupportWriteTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/accessLevel == 'planner' &&[\s\S]*?feature in \[[^\]]*'analyticsStrategicPlan'[^\]]*\]/);
    expect(storageRules).toMatch(/accessLevel == 'planner' &&[\s\S]*?feature in \[[^\]]*'analyticsStrategicPlan'[^\]]*\]/);
    expect(transitAppStorageBlock).not.toMatch(/allow write: if isTeamMember\(teamId\)/);

    expect(firestoreRules).toMatch(/match \/odMatrixData\/\{docId\} \{[\s\S]*allow read: if canAccessWorkspace\(teamId, 'analyticsOdMatrix'\) \|\| canSupportReadTeamData\(teamId\);/);
    expect(firestoreRules).toMatch(/accessLevel == 'transit-app-only' &&[\s\S]*feature == 'analyticsTransitApp'/);
    expect(firestoreRules).toMatch(/accessLevel == 'external-planner' &&[\s\S]*feature == 'analyticsTransitApp'/);
    expect(firestoreRules).toMatch(/accessLevel == 'parking' &&[\s\S]*feature == 'workspaceParking'/);
    expect(firestoreRules).not.toMatch(/accessLevel == 'external-planner' &&[\s\S]*feature in \[[\s\S]*workspaceFixedRoute/);
    expect(firestoreRules).not.toMatch(/accessLevel == 'none' &&[\s\S]*feature/);
  });

  it('keeps Fare Programs access profiles aligned across client and security rules', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const storageRules = readRepoFile('storage.rules');

    expect(firestoreRules).toMatch(/accessLevel == 'admin' &&[\s\S]*?feature in \[[^\]]*'analyticsFarePrograms'[^\]]*\]/);
    expect(firestoreRules).toMatch(/accessLevel == 'planner' &&[\s\S]*?feature in \[[^\]]*'analyticsFarePrograms'[^\]]*\]/);
    expect(storageRules).toMatch(/accessLevel == 'admin' &&[\s\S]*?feature in \[[^\]]*'analyticsFarePrograms'[^\]]*\]/);
    expect(storageRules).toMatch(/accessLevel == 'planner' &&[\s\S]*?feature in \[[^\]]*'analyticsFarePrograms'[^\]]*\]/);
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

  it('limits collection-group membership enumeration to the caller records', () => {
    const firestoreRules = readRepoFile('firestore.rules');
    const firestoreIndexes = readRepoFile('firestore.indexes.json');

    expect(firestoreRules).toMatch(
      /match \/\{path=\*\*\}\/members\/\{memberId\} \{[\s\S]*allow list: if request\.auth != null &&[\s\S]*resource\.data\.userId == request\.auth\.uid;/,
    );
    expect(firestoreIndexes).toMatch(/"collectionGroup": "members"[\s\S]*"fieldPath": "userId"[\s\S]*"queryScope": "COLLECTION_GROUP"/);
  });

  it('only allows active team pointers backed by an existing membership', () => {
    const firestoreRules = readRepoFile('firestore.rules');

    expect(firestoreRules).toMatch(/allow create, update: if request\.auth != null &&[\s\S]*isValidActiveTeamSelection\(userId\);/);
    expect(firestoreRules).toMatch(/function isValidActiveTeamSelection\(userId\) \{[\s\S]*existsAfter\([\s\S]*teams\/\$\(teamId\)\/members\/\$\(userId\)[\s\S]*\);/);
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
