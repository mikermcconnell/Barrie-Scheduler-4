import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  safeHaversineDistance,
  pointInRing,
  pointInPolygon,
} from '../../utils/routing/geometryUtils';

// Known Barrie coordinates
const TERMINAL = { lat: 44.3891, lon: -79.6903 };       // Downtown Barrie Terminal
const BARRIE_NORTH = { lat: 44.4012, lon: -79.6901 };   // Barrie North Collegiate
const ALLANDALE = { lat: 44.3697, lon: -79.6896 };      // Allandale Waterfront

describe('geometryUtils', () => {
  describe('haversineDistance', () => {
    it('calculates distance between Terminal and Barrie North (~1.3km)', () => {
      const dist = haversineDistance(TERMINAL.lat, TERMINAL.lon, BARRIE_NORTH.lat, BARRIE_NORTH.lon);
      expect(dist).toBeGreaterThan(1200);
      expect(dist).toBeLessThan(1500);
    });

    it('calculates distance between Terminal and Allandale (~2.2km)', () => {
      const dist = haversineDistance(TERMINAL.lat, TERMINAL.lon, ALLANDALE.lat, ALLANDALE.lon);
      expect(dist).toBeGreaterThan(1900);
      expect(dist).toBeLessThan(2500);
    });

    it('returns 0 for same point', () => {
      const dist = haversineDistance(TERMINAL.lat, TERMINAL.lon, TERMINAL.lat, TERMINAL.lon);
      expect(dist).toBe(0);
    });

    it('handles antipodal points (~20,000km)', () => {
      const dist = haversineDistance(0, 0, 0, 180);
      expect(dist).toBeGreaterThan(20_000_000);
      expect(dist).toBeLessThan(20_100_000);
    });
  });

  describe('safeHaversineDistance', () => {
    it('returns Infinity for null inputs', () => {
      expect(safeHaversineDistance(null, -79, 44, -79)).toBe(Infinity);
      expect(safeHaversineDistance(44, null, 44, -79)).toBe(Infinity);
      expect(safeHaversineDistance(44, -79, null, -79)).toBe(Infinity);
      expect(safeHaversineDistance(44, -79, 44, null)).toBe(Infinity);
    });

    it('returns Infinity for undefined inputs', () => {
      expect(safeHaversineDistance(undefined, -79, 44, -79)).toBe(Infinity);
    });

    it('returns actual distance for valid inputs', () => {
      const dist = safeHaversineDistance(TERMINAL.lat, TERMINAL.lon, BARRIE_NORTH.lat, BARRIE_NORTH.lon);
      expect(dist).toBeGreaterThan(1200);
      expect(dist).toBeLessThan(1500);
    });
  });

  describe('pointInRing', () => {
    // Simple square polygon around downtown Barrie (GeoJSON [lng, lat] order)
    const square: [number, number][] = [
      [-79.70, 44.38],  // SW
      [-79.68, 44.38],  // SE
      [-79.68, 44.40],  // NE
      [-79.70, 44.40],  // NW
      [-79.70, 44.38],  // close ring
    ];

    it('point inside polygon returns true', () => {
      expect(pointInRing(44.39, -79.69, square)).toBe(true);
    });

    it('point outside polygon returns false', () => {
      expect(pointInRing(44.50, -79.69, square)).toBe(false);
    });

    it('point far outside returns false', () => {
      expect(pointInRing(43.0, -80.0, square)).toBe(false);
    });
  });

  describe('pointInPolygon', () => {
    const outerRing: [number, number][] = [
      [-79.72, 44.37],
      [-79.66, 44.37],
      [-79.66, 44.41],
      [-79.72, 44.41],
      [-79.72, 44.37],
    ];

    // Hole in the middle
    const hole: [number, number][] = [
      [-79.70, 44.385],
      [-79.68, 44.385],
      [-79.68, 44.395],
      [-79.70, 44.395],
      [-79.70, 44.385],
    ];

    it('point inside outer ring, no holes, returns true', () => {
      expect(pointInPolygon(44.39, -79.69, [outerRing])).toBe(true);
    });

    it('point outside outer ring returns false', () => {
      expect(pointInPolygon(44.50, -79.69, [outerRing])).toBe(false);
    });

    it('point inside hole returns false', () => {
      expect(pointInPolygon(44.39, -79.69, [outerRing, hole])).toBe(false);
    });

    it('point inside outer but outside hole returns true', () => {
      // Point in the outer ring but not in the hole
      expect(pointInPolygon(44.375, -79.69, [outerRing, hole])).toBe(true);
    });

    it('returns false for empty coordinates', () => {
      expect(pointInPolygon(44.39, -79.69, [])).toBe(false);
    });
  });
});
