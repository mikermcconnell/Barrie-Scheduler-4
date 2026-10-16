import { describe, expect, it } from 'vitest';
import { isPrimaryDeveloperEmail, validateSupportAccessInput } from '../functions/src/developerSupportAccess';

describe('developer support callable validation', () => {
  it('accepts a valid team-scoped edit request', () => {
    expect(validateSupportAccessInput({
      action: 'start',
      userId: 'admin-1',
      teamId: 'team-1',
      mode: 'edit',
      reason: 'Correct an import issue',
      durationMinutes: 30,
    }, 'admin-1')).toEqual({
      action: 'start',
      teamId: 'team-1',
      mode: 'edit',
      reason: 'Correct an import issue',
      durationMinutes: 30,
    });
  });

  it('rejects attempts to manage another administrator session', () => {
    expect(() => validateSupportAccessInput({
      action: 'stop',
      userId: 'admin-2',
    }, 'admin-1')).toThrow(/signed-in administrator/i);
  });

  it('records a default reason for edits and rejects durations over one hour', () => {
    expect(validateSupportAccessInput({
      action: 'start',
      teamId: 'team-1',
      mode: 'edit',
      reason: '',
      durationMinutes: 30,
    }, 'admin-1')).toMatchObject({ mode: 'edit', reason: 'Developer edit' });

    expect(() => validateSupportAccessInput({
      action: 'start',
      teamId: 'team-1',
      mode: 'inspect',
      durationMinutes: 61,
    }, 'admin-1')).toThrow(/cannot exceed 60/i);
  });

  it('limits edit sessions to the primary developer email', () => {
    expect(isPrimaryDeveloperEmail('mike.mcconnell@barrie.ca')).toBe(true);
    expect(isPrimaryDeveloperEmail(' Mike.McConnell@Barrie.ca ')).toBe(true);
    expect(isPrimaryDeveloperEmail('codex.dev.1773337749574@example.com')).toBe(false);
    expect(isPrimaryDeveloperEmail(undefined)).toBe(false);
  });
});
