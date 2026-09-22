import { describe, expect, it } from 'vitest';
import { placeParkingLabels } from '../utils/parking/parkingMapLabels';

describe('parking map label layout', () => {
  it.each([[900, 440], [350, 300], [1200, 700]])('separates colocated lots within a %s x %s viewport', (width, height) => {
    const anchors = Array.from({ length: 10 }, (_, i) => ({ id: String(i), x: width / 2, y: height / 2 }));
    const result = placeParkingLabels(anchors, width, height, '9');
    expect(result.placements[0].id).toBe('9');
    expect(result.placements.length + result.hiddenCount).toBe(10);
    for (const label of result.placements) {
      expect(label.left).toBeGreaterThanOrEqual(0);
      expect(label.top).toBeGreaterThanOrEqual(0);
      expect(label.left + result.labelWidth).toBeLessThanOrEqual(width);
      expect(label.top + result.labelHeight).toBeLessThanOrEqual(height);
      expect(label.x).toBe(width / 2);
      expect(label.y).toBe(height / 2);
      expect(label.left + result.labelWidth <= width - 48 || label.top + result.labelHeight <= height - 145).toBe(true);
      for (const other of result.placements.filter(p => p.id !== label.id)) {
        expect(label.left >= other.left + result.labelWidth || other.left >= label.left + result.labelWidth || label.top >= other.top + result.labelHeight || other.top >= label.top + result.labelHeight).toBe(true);
      }
    }
  });
  it('ignores offscreen lots and handles an empty or tiny canvas', () => {
    expect(placeParkingLabels([{ id: 'off', x: -100, y: 100 }], 400, 400).placements).toEqual([]);
    expect(placeParkingLabels([], 0, 0).hiddenCount).toBe(0);
    expect(placeParkingLabels([{ id: 'a', x: 20, y: 20 }], 40, 40).hiddenCount).toBe(1);
  });
});
