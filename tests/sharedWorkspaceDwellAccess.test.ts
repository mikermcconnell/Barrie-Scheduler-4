import { describe, expect, it } from 'vitest';
import {
  canReadOperatorDwell,
  redactOperatorDwellEvidence,
} from '../functions/src/sharedWorkspaceData';

describe('shared performance dwell access', () => {
  const token = (schedulerAdmin = false) => ({ schedulerAdmin }) as never;

  it('requires admin/internal access unless the feature is explicitly allowed', () => {
    expect(canReadOperatorDwell({ accessLevel: 'planner' }, token())).toBe(false);
    expect(canReadOperatorDwell({ accessLevel: 'admin' }, token())).toBe(true);
    expect(canReadOperatorDwell({ accessLevel: 'internal' }, token())).toBe(true);
    expect(canReadOperatorDwell({ accessLevel: 'planner', workspaceOverrides: { operationsOperatorDwell: true } }, token())).toBe(true);
    expect(canReadOperatorDwell({ accessLevel: 'internal', workspaceOverrides: { operationsOperatorDwell: false } }, token())).toBe(false);
    expect(canReadOperatorDwell(null, token(true))).toBe(true);
  });

  it('removes operator and cascade evidence while preserving general performance data', () => {
    const summary = {
      metadata: { dateRange: { start: '2026-07-01', end: '2026-07-01' } },
      dailySummaries: [{
        date: '2026-07-01',
        byOperatorDwell: { incidents: [{ operatorId: 'OP1' }] },
        byCascade: { cascades: [{ operatorId: 'OP1' }] },
        byRoute: [{ routeId: '10' }],
      }],
    };

    const redacted = redactOperatorDwellEvidence(summary) as typeof summary;
    expect(redacted.dailySummaries[0].byOperatorDwell).toBeUndefined();
    expect(redacted.dailySummaries[0].byCascade).toBeUndefined();
    expect(redacted.dailySummaries[0].byRoute).toEqual([{ routeId: '10' }]);
  });
});
