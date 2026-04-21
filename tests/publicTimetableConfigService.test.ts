import { describe, expect, it } from 'vitest';

import {
  buildDefaultPublicTimetableConfig,
  getPublicTimetableConfigErrorMessage,
} from '../utils/reports/publicTimetableConfigService';

describe('publicTimetableConfigService helpers', () => {
  it('builds a default brochure config payload', () => {
    const config = buildDefaultPublicTimetableConfig();

    expect(config.version).toBe(0);
    expect(config.updatedBy).toBe('system');
    expect(config.fareRows.length).toBeGreaterThan(0);
    expect(config.legendItems.length).toBeGreaterThan(0);
    expect(config.contacts.length).toBeGreaterThan(0);
  });

  it('returns a permission-specific save message', () => {
    expect(
      getPublicTimetableConfigErrorMessage({ code: 'permission-denied' }, 'save')
    ).toContain('do not have permission');
  });

  it('returns a fallback warning for load failures', () => {
    expect(
      getPublicTimetableConfigErrorMessage(new Error('boom'), 'load')
    ).toContain('Showing built-in defaults instead');
  });
});
