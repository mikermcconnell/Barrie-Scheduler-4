import { describe, expect, it } from 'vitest';

import { formatRoutePlanner2MapStopLabel } from '../components/Analytics/route-planner-2/RoutePlanner2MapCanvas';

describe('RoutePlanner2MapCanvas stop labels', () => {
  it('formats subtle map labels with arrival and kids count', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      kidsAtStop: 2,
      arrivalLabel: '8:15 AM',
    })).toBe('8:15 AM · 2 kids');
  });

  it('falls back to kids count when arrival time is not set', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      kidsAtStop: 1,
      arrivalLabel: 'Not set',
    })).toBe('1 kid');
  });
});
