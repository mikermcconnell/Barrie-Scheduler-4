import { describe, it, expect } from 'vitest';
import { parseTimeToSeconds } from '../../utils/routing/gtfsAdapter';

describe('gtfsAdapter', () => {
  describe('parseTimeToSeconds', () => {
    it('parses standard HH:MM:SS time', () => {
      expect(parseTimeToSeconds('06:30:00')).toBe(6 * 3600 + 30 * 60);
      expect(parseTimeToSeconds('12:00:00')).toBe(12 * 3600);
      expect(parseTimeToSeconds('23:59:59')).toBe(23 * 3600 + 59 * 60 + 59);
    });

    it('parses HH:MM without seconds', () => {
      expect(parseTimeToSeconds('06:30')).toBe(6 * 3600 + 30 * 60);
      expect(parseTimeToSeconds('08:45')).toBe(8 * 3600 + 45 * 60);
    });

    it('handles post-midnight times (HH >= 24)', () => {
      // 25:10:00 = 1:10 AM next day = 90600 seconds
      expect(parseTimeToSeconds('25:10:00')).toBe(25 * 3600 + 10 * 60);
      // 24:00:00 = midnight next day
      expect(parseTimeToSeconds('24:00:00')).toBe(24 * 3600);
      // 26:30:00 = 2:30 AM next day
      expect(parseTimeToSeconds('26:30:00')).toBe(26 * 3600 + 30 * 60);
    });

    it('handles midnight exactly', () => {
      expect(parseTimeToSeconds('00:00:00')).toBe(0);
    });

    it('handles whitespace', () => {
      expect(parseTimeToSeconds('  06:30:00  ')).toBe(6 * 3600 + 30 * 60);
    });
  });
});
