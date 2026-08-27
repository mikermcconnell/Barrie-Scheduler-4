import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('operations-planning security rules', () => {
  it('gates scenario metadata by Fixed Route access and separates planner and manager transitions', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const scenarioRules = rules.match(
      /match \/operationsPlanningScenarios\/\{scenarioId\} \{([\s\S]*?)\/\/ Team-authored detour notices/
    )?.[1] ?? '';

    expect(scenarioRules).toMatch(/allow read: if canAccessWorkspace\(teamId, 'workspaceFixedRoute'\)/);
    expect(scenarioRules).toMatch(/allow create:[\s\S]*isValidOperationsPlanningCreate\(teamId, scenarioId\)/);
    expect(scenarioRules).toMatch(/isValidOperationsPlanningDraftRevision\(teamId, scenarioId\)/);
    expect(scenarioRules).toMatch(/isValidOperationsPlanningSubmit\(\)/);
    expect(scenarioRules).toMatch(/isTeamOwnerOrAdmin\(teamId\)[\s\S]*isValidOperationsPlanningApproval\(\)/);
    expect(rules).toMatch(/data\.activeRevision == resource\.data\.activeRevision \+ 1/);
    expect(rules).toMatch(/data\.status == 'approved'[\s\S]*data\.contractualBlockerCount == 0/);
    expect(rules).toMatch(/data\.sourceIsStale == false && data\.integrityBlockerCount == 0/);
    expect(rules).toMatch(/data\.createdAt == resource\.data\.createdAt && data\.createdBy == resource\.data\.createdBy/);
  });

  it('keeps revision JSON immutable for all ordinary members, including managers', () => {
    const rules = readFileSync('storage.rules', 'utf8');
    const revisionRules = rules.match(
      /match \/teams\/\{teamId\}\/operationsPlanningScenarios\/\{scenarioId\}\/versions\/\{revision\}\.json \{([\s\S]*?)\/\/ Team route map images/
    )?.[1] ?? '';

    expect(revisionRules).toMatch(/allow read: if canAccessWorkspace\(teamId, 'workspaceFixedRoute'\)/);
    expect(revisionRules).toMatch(/allow create:[\s\S]*request\.resource\.contentType == 'application\/json'/);
    expect(revisionRules).toMatch(/request\.resource\.size <= 25 \* 1024 \* 1024/);
    expect(revisionRules).toMatch(/request\.resource\.metadata\.savedBy == request\.auth\.uid/);
    expect(revisionRules).toMatch(/metadata\.previousStoragePath ==[\s\S]*\.data\.storagePath/);
    expect(revisionRules).toMatch(/\.data\.status in \['draft', 'submitted'\]/);
    expect(revisionRules).toMatch(/allow update: if false;/);
    expect(revisionRules).toMatch(/allow delete: if canSupportWriteTeamData\(teamId\);/);
    expect(revisionRules).not.toMatch(/allow delete:[\s\S]*(canAccessWorkspace|isTeamManager)/);
  });
});
