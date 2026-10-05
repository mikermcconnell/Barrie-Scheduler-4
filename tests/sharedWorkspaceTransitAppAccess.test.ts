import { describe, expect, it } from 'vitest';
import {
  canReadFleetPlanEvidence,
  canReadStrategicPlanRidership,
  canReadTransitAppEvidence,
} from '../functions/src/sharedWorkspaceData';

describe('shared Transit App evidence access', () => {
  const token = (schedulerAdmin = false) => ({ schedulerAdmin }) as never;

  it('allows either Transit App or Strategic Plan access', () => {
    expect(canReadTransitAppEvidence({ accessLevel: 'transit-app-only' }, token())).toBe(true);
    expect(canReadTransitAppEvidence({ accessLevel: 'planner' }, token())).toBe(true);
    expect(canReadTransitAppEvidence({
      accessLevel: 'none',
      workspaceOverrides: { analyticsStrategicPlan: true },
    }, token())).toBe(true);
    expect(canReadTransitAppEvidence({
      accessLevel: 'none',
      workspaceOverrides: { analyticsTransitApp: true },
    }, token())).toBe(true);
  });

  it('denies members with neither feature and honors explicit blocks', () => {
    expect(canReadTransitAppEvidence({ accessLevel: 'none' }, token())).toBe(false);
    expect(canReadTransitAppEvidence({
      accessLevel: 'planner',
      workspaceOverrides: {
        analyticsTransitApp: false,
        analyticsStrategicPlan: false,
      },
    }, token())).toBe(false);
    expect(canReadTransitAppEvidence(null, token())).toBe(false);
    expect(canReadTransitAppEvidence(null, token(true))).toBe(true);
  });
});

describe('shared Strategic Plan evidence access', () => {
  const token = (schedulerAdmin = false) => ({ schedulerAdmin }) as never;

  it('allows Strategic Plan-only members to read Fleet Plan and annual ridership evidence', () => {
    const strategicPlanOnly = {
      accessLevel: 'none',
      workspaceOverrides: { analyticsStrategicPlan: true },
    };
    expect(canReadFleetPlanEvidence(strategicPlanOnly, token())).toBe(true);
    expect(canReadStrategicPlanRidership(strategicPlanOnly, token())).toBe(true);
    expect(canReadFleetPlanEvidence({ accessLevel: 'planner' }, token())).toBe(true);
  });

  it('keeps evidence unavailable without Fleet Plan or Strategic Plan access', () => {
    const noAccess = { accessLevel: 'none' };
    expect(canReadFleetPlanEvidence(noAccess, token())).toBe(false);
    expect(canReadStrategicPlanRidership(noAccess, token())).toBe(false);
    expect(canReadFleetPlanEvidence(null, token(true))).toBe(true);
    expect(canReadStrategicPlanRidership(null, token(true))).toBe(true);
  });
});
