import { describe, expect, it } from 'vitest';
import { RIDERSHIP_TREND_FILENAME_PATTERN } from '../utils/ridership-trends/types';

describe('RIDERSHIP_TREND_FILENAME_PATTERN', () => {
  it('accepts timestamp names, with or without the generation UUID', () => {
    expect(RIDERSHIP_TREND_FILENAME_PATTERN.test('1760000000000.json')).toBe(true);
    expect(RIDERSHIP_TREND_FILENAME_PATTERN.test('1760000000000-3f2b9c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b.json')).toBe(true);
  });

  it('rejects anything that could reach outside the projection folder', () => {
    expect(RIDERSHIP_TREND_FILENAME_PATTERN.test('../1760000000000.json')).toBe(false);
    expect(RIDERSHIP_TREND_FILENAME_PATTERN.test('1760000000000-evil/x.json')).toBe(false);
    expect(RIDERSHIP_TREND_FILENAME_PATTERN.test('1760000000000-history-rebuild.json')).toBe(false);
  });
});
