import { describe, expect, it } from 'vitest';
import { buildFeatureFlags, getFeatureOverrideEnvVar } from '../utils/features';

describe('feature flags', () => {
  it('keeps features enabled by default outside demo mode', () => {
    const flags = buildFeatureFlags({});

    expect(flags.demoMode).toBe(false);
    expect(flags.analyticsRoutePlanner).toBe(true);
    expect(flags.analyticsNetworkConnections).toBe(true);
    expect(flags.fixedAnalytics).toBe(true);
  });

  it('hides demo-tagged features in demo mode', () => {
    const flags = buildFeatureFlags({
      VITE_DEMO_MODE: 'true',
    });

    expect(flags.demoMode).toBe(true);
    expect(flags.analyticsOdMatrix).toBe(false);
    expect(flags.analyticsCorridorSpeed).toBe(false);
    expect(flags.analyticsCorridorHeadway).toBe(false);
    expect(flags.analyticsRoutePlanner).toBe(false);
    expect(flags.analyticsNetworkConnections).toBe(false);
    expect(flags.operationsImportHealth).toBe(false);
    expect(flags.operationsLoadProfiles).toBe(false);
    expect(flags.operationsOperatorDwell).toBe(false);
    expect(flags.analyticsTransitApp).toBe(true);
  });

  it('allows explicit per-feature overrides in demo mode', () => {
    const flags = buildFeatureFlags({
      VITE_DEMO_MODE: '1',
      [getFeatureOverrideEnvVar('analyticsRoutePlanner')]: 'true',
      [getFeatureOverrideEnvVar('fixedAnalytics')]: 'false',
    });

    expect(flags.analyticsRoutePlanner).toBe(true);
    expect(flags.fixedAnalytics).toBe(false);
  });
});
