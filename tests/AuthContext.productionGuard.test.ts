import { describe, expect, it } from 'vitest';

import { isBlockedProductionDevEmail } from '../components/contexts/AuthContext';

describe('AuthContext production dev account guard', () => {
  it('blocks Codex dev test accounts on production hosts', () => {
    expect(
      isBlockedProductionDevEmail(
        'codex.dev.1773337907846@example.com',
        'transitscheduler.ca',
      ),
    ).toBe(true);
  });

  it('allows the same dev pattern on localhost only', () => {
    expect(
      isBlockedProductionDevEmail(
        'codex.dev.1773337907846@example.com',
        'localhost',
      ),
    ).toBe(false);
  });

  it('does not block real user emails on production', () => {
    expect(isBlockedProductionDevEmail('planner@example.com', 'transitscheduler.ca')).toBe(
      false,
    );
  });
});
