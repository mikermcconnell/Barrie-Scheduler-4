import { describe, expect, it } from 'vitest';

import { formatRoutePlanner2MapStopLabel } from '../components/Analytics/route-planner-2/RoutePlanner2MapCanvas';

describe('RoutePlanner2MapCanvas stop labels', () => {
  it('formats subtle map labels with travel time and kids count', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      kidsAtStop: 2,
      travelTimeLabel: '6 min',
    })).toBe('6 min · 2 kids');
  });

  it('falls back to kids count when travel time is not estimated', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      kidsAtStop: 1,
      travelTimeLabel: 'Not estimated',
    })).toBe('1 kid');
  });
});
