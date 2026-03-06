import { describe, expect, it } from 'vitest';
import { getContrastingTextColor } from '../utils/config/routeColors';

describe('getContrastingTextColor', () => {
  it('returns black text for light route backgrounds', () => {
    expect(getContrastingTextColor('#F58220')).toBe('black');
    expect(getContrastingTextColor('#B2D235')).toBe('black');
  });

  it('returns white text for dark route backgrounds', () => {
    expect(getContrastingTextColor('#681757')).toBe('white');
    expect(getContrastingTextColor('#000000')).toBe('white');
  });
});
