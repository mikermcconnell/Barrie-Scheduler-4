import { describe, expect, it } from 'vitest';
import { buildFeatureFlags, getFeatureOverrideEnvVar, isFeatureUnderConstruction } from '../utils/features';

describe('feature flags', () => {
  it('keeps features enabled by default outside demo mode', () => {
    const flags = buildFeatureFlags({});

    expect(flags.demoMode).toBe(false);
    expect(flags.analyticsRoutePlanner).toBe(true);
    expect(flags.analyticsNetworkConnections).toBe(true);
    expect(flags.fixedAnalytics).toBe(true);
  });

  it('keeps demo-tagged features visible in demo mode', () => {
    const flags = buildFeatureFlags({
      VITE_DEMO_MODE: 'true',
    });

    expect(flags.demoMode).toBe(true);
    expect(flags.analyticsOdMatrix).toBe(true);
    expect(flags.analyticsCorridorSpeed).toBe(true);
    expect(flags.analyticsCorridorHeadway).toBe(true);
    expect(flags.analyticsRoutePlanner).toBe(true);
    expect(flags.analyticsNetworkConnections).toBe(true);
    expect(flags.operationsImportHealth).toBe(true);
    expect(flags.operationsLoadProfiles).toBe(true);
    expect(flags.operationsOperatorDwell).toBe(true);
    expect(flags.analyticsTransitApp).toBe(true);
  });

  it('allows explicit per-feature overrides in demo mode', () => {
    const flags = buildFeatureFlags({
      VITE_DEMO_MODE: '1',
      [getFeatureOverrideEnvVar('analyticsRoutePlanner')]: 'false',
      [getFeatureOverrideEnvVar('fixedAnalytics')]: 'false',
    });

    expect(flags.analyticsRoutePlanner).toBe(false);
    expect(flags.fixedAnalytics).toBe(false);
  });

  it('marks demo-tagged features as under construction in demo mode', () => {
    const flags = buildFeatureFlags({
      VITE_DEMO_MODE: 'true',
    });

    expect(isFeatureUnderConstruction('analyticsOdMatrix', flags)).toBe(true);
    expect(isFeatureUnderConstruction('operationsLoadProfiles', flags)).toBe(true);
    expect(isFeatureUnderConstruction('analyticsTransitApp', flags)).toBe(false);
  });
});
