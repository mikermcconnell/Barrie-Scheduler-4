import { describe, expect, it } from 'vitest';
import { buildOptimizeCommonRules } from '../utils/ai/optimizeCore';

describe('optimizeCore common rules', () => {
  it('uses the default break requirement when no custom duration is provided', () => {
    const rules = buildOptimizeCommonRules('full');

    expect(rules).toContain('Breaks: 45min (3 slots) if actual drive time > 7.5h.');
  });

  it('uses configured break duration and changeoff settings in the shared rules', () => {
    const rules = buildOptimizeCommonRules('refine', {
      breakDurationMinutes: 60,
      northChangeoffMinutes: 12,
      southChangeoffMinutes: 9,
    });

    expect(rules).toContain('Breaks: 60min (4 slots) if actual drive time > 7.5h.');
    expect(rules).toContain('remove 12 minutes leaving the zone');
    expect(rules).toContain('remove 9 minutes leaving the zone');
  });
});
