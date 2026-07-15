import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('schedule review security rules', () => {
  it('gates team review metadata by Fixed Route access and manager-only decisions', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const reviewRules = rules.match(
      /match \/scheduleReviews\/\{reviewId\} \{([\s\S]*?)\/\/ Platform configuration/
    )?.[1] ?? '';

    expect(reviewRules).toMatch(/allow read: if canAccessWorkspace\(teamId, 'workspaceFixedRoute'\)/);
    expect(reviewRules).toMatch(/allow create:[\s\S]*isValidScheduleReviewCreate\(teamId, reviewId\)/);
    expect(reviewRules).toMatch(/allow update: if \(isTeamOwnerOrAdmin\(teamId\) \|\| canSupportWriteTeamData\(teamId\)\)/);
    expect(rules).toMatch(/data\.status == 'ready_for_review'/);
    expect(rules).toMatch(/affectedKeys\(\)\.hasOnly\(\[[\s\S]*'status'[\s\S]*'reviewedBy'[\s\S]*'reviewedAt'[\s\S]*'updatedAt'/);
    expect(rules).toMatch(/data\.plannerNote\.size\(\) <= 2000/);
    expect(rules).toMatch(/data\.payloadBytes <= 10 \* 1024 \* 1024/);
  });

  it('keeps review JSON immutable for members and preserves scoped support access', () => {
    const rules = readFileSync('storage.rules', 'utf8');
    const reviewRules = rules.match(
      /match \/teams\/\{teamId\}\/scheduleReviews\/\{reviewId\}\/\{creatorId\}\/schedule\.json \{([\s\S]*?)\/\/ Team route map images/
    )?.[1] ?? '';

    expect(reviewRules).toMatch(/allow read: if canAccessWorkspace\(teamId, 'workspaceFixedRoute'\)/);
    expect(reviewRules).toMatch(/allow create:[\s\S]*request\.auth\.uid == creatorId/);
    expect(reviewRules).toMatch(/request\.resource\.contentType == 'application\/json'/);
    expect(reviewRules).toMatch(/request\.resource\.size <= 10 \* 1024 \* 1024/);
    expect(reviewRules).toMatch(/allow update: if false;/);
    expect(reviewRules).toMatch(/!firestore\.exists\([\s\S]*scheduleReviews\/\$\(reviewId\)/);
    expect(reviewRules).not.toMatch(/allow (update|write): if canAccessWorkspace/);
  });
});
