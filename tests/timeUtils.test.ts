/**
 * Time Utilities Tests
 *
 * CRITICAL: These tests protect against the recurring "post-midnight parsing" bug.
 * This bug has occurred MULTIPLE times where times after midnight (12:30 AM, 1:00 AM, etc.)
 * were not being parsed correctly from Excel data.
 *
 * Root cause: Excel represents times as fractions of a day:
 * - 0.5 = 12:00 PM (noon)
 * - 0.99 = 11:45 PM
 * - 1.02 = 12:30 AM (the "1" represents the next day, 0.02 is the time fraction)
 *
 * The bug was: values between 1.0 and 2.0 were multiplied by 24*60 directly
 * instead of extracting the fractional part first.
 */

import { describe, it, expect } from 'vitest';
import { toMinutes, fromMinutes } from '../utils/timeUtils';
import { parseTimeToMinutes } from '../utils/parsers/masterScheduleParserV2';

describe('toMinutes - Excel decimal time parsing', () => {
    describe('Standard times (before midnight)', () => {
        it('parses midnight (0.0) as 0 minutes', () => {
            expect(toMinutes(0.0)).toBe(0);
        });

        it('parses 6:00 AM (0.25) as 360 minutes', () => {
            expect(toMinutes(0.25)).toBe(360);
        });

        it('parses 12:00 PM noon (0.5) as 720 minutes', () => {
            expect(toMinutes(0.5)).toBe(720);
        });

        it('parses 6:00 PM (0.75) as 1080 minutes', () => {
            expect(toMinutes(0.75)).toBe(1080);
        });

        it('parses 11:00 PM (0.958) as ~1380 minutes', () => {
            const result = toMinutes(0.9583333);
            expect(result).toBeGreaterThanOrEqual(1379);
            expect(result).toBeLessThanOrEqual(1381);
        });
    });

    describe('CRITICAL: Post-midnight times (Excel values >= 1.0)', () => {
        // Post-midnight Excel decimals preserve the day offset (wholeDays * 1440 + fractionalMinutes).
        // Downstream consumers use >= 1440 to detect post-midnight trips for correct sorting
        // and midnight-rollover logic. See masterScheduleParserV2.ts, parserAdapter.ts, etc.

        it('parses 12:30 AM (1.02083) as ~1470 minutes (1440 + 30)', () => {
            const result = toMinutes(1.02083333);
            expect(result).toBeGreaterThanOrEqual(1469);
            expect(result).toBeLessThanOrEqual(1471);
        });

        it('parses 1:00 AM (1.04167) as ~1500 minutes (1440 + 60)', () => {
            const result = toMinutes(1.04166667);
            expect(result).toBeGreaterThanOrEqual(1499);
            expect(result).toBeLessThanOrEqual(1501);
        });

        it('parses 2:00 AM (1.08333) as ~1560 minutes (1440 + 120)', () => {
            const result = toMinutes(1.08333333);
            expect(result).toBeGreaterThanOrEqual(1559);
            expect(result).toBeLessThanOrEqual(1561);
        });

        it('rejects pure integer dates (no time component)', () => {
            expect(toMinutes(1.0)).toBeNull();
            expect(toMinutes(2.0)).toBeNull();
            expect(toMinutes(45000.0)).toBeNull(); // Excel date serial
        });

        it('handles dates with times — preserves day offset', () => {
            // 45000.5 = day 45000 + 0.5 (noon) → 45000*1440 + 720
            const result = toMinutes(45000.5);
            expect(result).not.toBeNull();
            expect(result! % 1440).toBe(720); // within-day portion is noon
        });
    });

    describe('String time parsing', () => {
        it('parses "12:30 AM" as 30 minutes', () => {
            expect(toMinutes('12:30 AM')).toBe(30);
        });

        it('parses "1:00 AM" as 60 minutes', () => {
            expect(toMinutes('1:00 AM')).toBe(60);
        });

        it('parses "12:00 PM" as 720 minutes', () => {
            expect(toMinutes('12:00 PM')).toBe(720);
        });

        it('parses "11:30 PM" as 1410 minutes', () => {
            expect(toMinutes('11:30 PM')).toBe(1410);
        });

        it('parses lowercase "am/pm"', () => {
            expect(toMinutes('1:00 am')).toBe(60);
            expect(toMinutes('1:00 pm')).toBe(780);
        });

        it('rejects invalid strings', () => {
            expect(toMinutes('Route')).toBeNull();
            expect(toMinutes('Block')).toBeNull();
            expect(toMinutes('')).toBeNull();
        });
    });

    describe('Edge cases that caused previous bugs', () => {
        it('does not treat small integers as times', () => {
            // Block IDs, stop IDs should not be parsed as times
            expect(toMinutes(5)).toBeNull();
            expect(toMinutes(10)).toBeNull();
            expect(toMinutes(99)).toBeNull();
        });

        it('treats bare number strings as raw minutes (for recovery times)', () => {
            // timeUtils.ts intentionally treats bare numbers as raw minutes
            // This is used for recovery time parsing (e.g., "5" = 5 min recovery)
            // Note: masterScheduleParser.ts has stricter parsing that rejects these
            expect(toMinutes('8')).toBe(8);
            expect(toMinutes('15')).toBe(15);
        });
    });
});

describe('fromMinutes - Time formatting', () => {
    it('formats 0 minutes as 12:00 AM', () => {
        expect(fromMinutes(0)).toBe('12:00 AM');
    });

    it('formats 30 minutes as 12:30 AM', () => {
        expect(fromMinutes(30)).toBe('12:30 AM');
    });

    it('formats 720 minutes as 12:00 PM', () => {
        expect(fromMinutes(720)).toBe('12:00 PM');
    });

    it('formats 1410 minutes as 11:30 PM', () => {
        expect(fromMinutes(1410)).toBe('11:30 PM');
    });

    it('wraps times > 1440 minutes (24 hours)', () => {
        expect(fromMinutes(1470)).toBe('12:30 AM'); // 1470 - 1440 = 30
    });

    it('handles negative minutes', () => {
        expect(fromMinutes(-30)).toBe('11:30 PM'); // -30 + 1440 = 1410
    });
});

describe('parseTimeToMinutes (V2 Parser) - Post-midnight parsing', () => {
    describe('CRITICAL: Post-midnight Excel decimal times', () => {
        // Same as toMinutes: day offset is preserved (1440 + fractional minutes).
        it('parses 12:30 AM (1.02083) as ~1470 minutes (1440 + 30)', () => {
            const result = parseTimeToMinutes(1.02083333);
            expect(result).toBeGreaterThanOrEqual(1469);
            expect(result).toBeLessThanOrEqual(1471);
        });

        it('parses 1:00 AM (1.04167) as ~1500 minutes (1440 + 60)', () => {
            const result = parseTimeToMinutes(1.04166667);
            expect(result).toBeGreaterThanOrEqual(1499);
            expect(result).toBeLessThanOrEqual(1501);
        });

        it('parses 2:00 AM (1.08333) as ~1560 minutes (1440 + 120)', () => {
            const result = parseTimeToMinutes(1.08333333);
            expect(result).toBeGreaterThanOrEqual(1559);
            expect(result).toBeLessThanOrEqual(1561);
        });

        it('parses early morning time 12:07 AM (0.00486) as ~7 minutes', () => {
            // 0.00486 * 24 * 60 = 7 minutes (interline time threshold)
            const result = parseTimeToMinutes(0.00486111);
            expect(result).toBeGreaterThanOrEqual(6);
            expect(result).toBeLessThanOrEqual(8);
        });

        it('rejects phantom times like 12:01 AM (0.0007) as residual data', () => {
            // Very small decimals (< 0.004 = ~6 min) are rejected as likely errors
            expect(parseTimeToMinutes(0.0007)).toBeNull(); // 12:01 AM
            expect(parseTimeToMinutes(0.002)).toBeNull();  // ~3 minutes
        });
    });

    describe('Standard times', () => {
        it('parses noon (0.5) as 720 minutes', () => {
            expect(parseTimeToMinutes(0.5)).toBe(720);
        });

        it('parses 6:00 PM (0.75) as 1080 minutes', () => {
            expect(parseTimeToMinutes(0.75)).toBe(1080);
        });

        it('parses string "12:30 AM" as 30 minutes', () => {
            expect(parseTimeToMinutes('12:30 AM')).toBe(30);
        });

        it('parses string "1:00 AM" as 60 minutes', () => {
            expect(parseTimeToMinutes('1:00 AM')).toBe(60);
        });
    });

    describe('Edge cases', () => {
        it('rejects small integers (block IDs)', () => {
            expect(parseTimeToMinutes(5)).toBeNull();
            expect(parseTimeToMinutes(99)).toBeNull();
        });

        it('rejects pure integer dates', () => {
            expect(parseTimeToMinutes(1.0)).toBeNull();
            expect(parseTimeToMinutes(45000)).toBeNull();
        });
    });
});
