import { describe, expect, it } from 'vitest';
import { buildOptimizeCommonRules } from '../utils/ai/optimizeCore';

describe('optimizeCore common rules', () => {
  it('uses the default break requirement when no custom duration is provided', () => {
    const rules = buildOptimizeCommonRules('full');

    expect(rules).toContain('Lunch breaks: non-straight shifts cannot exceed 5 consecutive driving hours without lunch.');
    expect(rules).toContain('Use 45min (9 slots) as the default lunch length');
  });

  it('uses configured break duration and changeoff settings in the shared rules', () => {
    const rules = buildOptimizeCommonRules('refine', {
      breakDurationMinutes: 60,
      northChangeoffMinutes: 12,
      southChangeoffMinutes: 9,
    });

    expect(rules).toContain('Use 60min (12 slots) as the default lunch length');
    expect(rules).toContain('remove 12 minutes leaving the zone');
    expect(rules).toContain('remove 9 minutes leaving the zone');
  });
});
