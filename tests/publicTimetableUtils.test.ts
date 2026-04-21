import { describe, expect, it } from 'vitest';

import {
  deduplicateStopsForBrochure,
  formatBrochureStopName,
  formatCompactTime,
  getBrochureDayKey,
  getBrochureDayLabel,
} from '../utils/reports/publicTimetableUtils';

describe('public timetable utils', () => {
  it('keeps the last duplicate stop occurrence for brochure display', () => {
    const result = deduplicateStopsForBrochure([
      'Park Place',
      'Downtown (Arrive)',
      'Downtown (2)',
      'Georgian College',
    ]);

    expect(result.displayStops).toEqual([
      'Park Place',
      'Downtown (Arrive)',
      'Downtown',
      'Georgian College',
    ]);
    expect(result.stopMapping).toEqual([
      'Park Place',
      'Downtown (Arrive)',
      'Downtown (2)',
      'Georgian College',
    ]);
  });

  it('formats brochure stop labels for first and last stops', () => {
    expect(formatBrochureStopName('Park Place', 0, 3)).toBe('Park Place (Depart)');
    expect(formatBrochureStopName('Downtown', 1, 3)).toBe('Downtown');
    expect(formatBrochureStopName('Georgian College', 2, 3)).toBe('Georgian College (Arrive)');
  });

  it('converts times to compact 24-hour display', () => {
    expect(formatCompactTime('6:05 PM')).toBe('18:05');
    expect(formatCompactTime('12:00 AM')).toBe('0:00');
    expect(formatCompactTime(undefined)).toBe('-');
  });

  it('maps brochure day labels and keys consistently', () => {
    expect(getBrochureDayKey('Weekday')).toBe('weekday');
    expect(getBrochureDayKey('Saturday')).toBe('saturday');
    expect(getBrochureDayKey('Sunday')).toBe('sunday');
    expect(getBrochureDayLabel('Sunday')).toBe('Sunday & Holidays');
    expect(getBrochureDayLabel('Weekday')).toBe('Weekday');
  });
});
