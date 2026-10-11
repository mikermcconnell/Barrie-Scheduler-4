import { describe, expect, it } from 'vitest';
import {
  normalizeSpecializedLocationName,
  parseCommonLocationLines,
  parseMonthlySpecializedLines,
} from '../utils/specialized-transit/parser';

describe('Specialized Transit PDF parser', () => {
  it('reads the exact monthly total and prior-year comparison', () => {
    expect(parseMonthlySpecializedLines([
      'August 2026 % of August 2025',
      '% of 2025 Specialized',
      'Month 2026 Trips Ridership',
      'August 2840 96%',
      'Specialized Transit Ridership',
    ])).toEqual({ reportMonth: '2026-08', reportedTrips: 2840, priorYearPercent: 96 });
  });

  it('deduplicates booking rows and returns only aggregate demand', () => {
    const result = parseCommonLocationLines([
      'Ridership By Common Location',
      'Pickup in : City Hall And Dropoff in : N / A',
      '2026-08-01 08:15 101 1703109001 BARRIE BARRIE',
      '2026-08-01 08:15 101 1703109001 BARRIE BARRIE',
      'Pickup in: Library And Dropoff in : City Hall',
      '2026-08-02 14:30 101 1703109002 BARRIE BARRIE',
      'Pickup in : Library And Dropoff in : City Hall',
      '2026-08-03 14:30 202 1703109003 BARRIE BARRIE',
      'Grand Totals : 3',
    ]);

    expect(result.reportMonth).toBe('2026-08');
    expect(result.commonLocationBookings).toBe(3);
    expect(result.serviceDateRange).toEqual({ start: '2026-08-01', end: '2026-08-03' });
    expect(result.dailyTotals).toEqual({ '2026-08-01': 1, '2026-08-02': 1, '2026-08-03': 1 });
    expect(result.recurringDemand).toEqual(expect.objectContaining({
      distinctClientIds: 2,
      medianBookingsPerClient: 1.5,
    }));
    expect(Object.values(result.locations).map(location => location.displayName).sort()).toEqual(['City Hall', 'Library']);
    expect(JSON.stringify(result)).not.toMatch(/"clientId"|"bookingId"|170310900|"101"|"202"/i);
  });

  it('normalizes harmless PDF spacing but rejects conflicting booking details', () => {
    expect(normalizeSpecializedLocationName('  ST . MARY\'S   SENIOR RESIDENCE  ')).toBe("ST. MARY'S SENIOR RESIDENCE");
    expect(() => parseCommonLocationLines([
      'Ridership By Common Location',
      'Pickup in : City Hall And Dropoff in : Library',
      '2026-08-01 08:15 101 1703109001 BARRIE BARRIE',
      'Pickup in : City Hall And Dropoff in : Mall',
      '2026-08-01 08:15 101 1703109001 BARRIE BARRIE',
    ])).toThrow(/conflicting trip details/i);
  });
});
