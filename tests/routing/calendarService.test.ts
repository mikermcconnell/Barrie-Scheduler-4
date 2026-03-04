import { describe, it, expect } from 'vitest';
import {
  formatGTFSDate,
  buildServiceCalendar,
  getActiveServicesForDate,
  isServiceActive,
  findNextServiceDate,
} from '../../utils/routing/calendarService';
import type { CalendarEntry, CalendarDate } from '../../utils/routing/types';

// Monday 2026-01-05
const MONDAY = new Date(2026, 0, 5);
// Saturday 2026-01-10
const SATURDAY = new Date(2026, 0, 10);
// Sunday 2026-01-11
const SUNDAY = new Date(2026, 0, 11);

const WEEKDAY_SERVICE: CalendarEntry = {
  serviceId: 'WKD',
  startDate: '20260101',
  endDate: '20261231',
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
};

const WEEKEND_SERVICE: CalendarEntry = {
  serviceId: 'WKE',
  startDate: '20260101',
  endDate: '20261231',
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: true,
  sunday: true,
};

describe('calendarService', () => {
  describe('formatGTFSDate', () => {
    it('formats date to YYYYMMDD', () => {
      expect(formatGTFSDate(new Date(2026, 0, 5))).toBe('20260105');
      expect(formatGTFSDate(new Date(2026, 11, 25))).toBe('20261225');
    });
  });

  describe('buildServiceCalendar + getActiveServicesForDate', () => {
    it('weekday service is active on Monday', () => {
      const cal = buildServiceCalendar([WEEKDAY_SERVICE], [], 30, MONDAY);
      const services = getActiveServicesForDate(cal, MONDAY);
      expect(services.has('WKD')).toBe(true);
    });

    it('weekday service is inactive on Saturday', () => {
      const cal = buildServiceCalendar([WEEKDAY_SERVICE], [], 30, MONDAY);
      const services = getActiveServicesForDate(cal, SATURDAY);
      expect(services.has('WKD')).toBe(false);
    });

    it('weekend service is active on Saturday', () => {
      const cal = buildServiceCalendar([WEEKEND_SERVICE], [], 30, SATURDAY);
      const services = getActiveServicesForDate(cal, SATURDAY);
      expect(services.has('WKE')).toBe(true);
    });

    it('weekend service is inactive on Monday', () => {
      const cal = buildServiceCalendar([WEEKEND_SERVICE], [], 30, MONDAY);
      const services = getActiveServicesForDate(cal, MONDAY);
      expect(services.has('WKE')).toBe(false);
    });

    it('returns both services on appropriate days', () => {
      const cal = buildServiceCalendar([WEEKDAY_SERVICE, WEEKEND_SERVICE], [], 30, MONDAY);
      const monServices = getActiveServicesForDate(cal, MONDAY);
      const satServices = getActiveServicesForDate(cal, SATURDAY);
      expect(monServices.has('WKD')).toBe(true);
      expect(monServices.has('WKE')).toBe(false);
      expect(satServices.has('WKD')).toBe(false);
      expect(satServices.has('WKE')).toBe(true);
    });

    it('returns empty set for date outside range', () => {
      const shortService: CalendarEntry = {
        ...WEEKDAY_SERVICE,
        startDate: '20260101',
        endDate: '20260110',
      };
      // Build starting from Jan 1, service ends Jan 10
      const cal = buildServiceCalendar([shortService], [], 30, new Date(2026, 0, 1));
      // Jan 12 is a Monday but outside range
      const services = getActiveServicesForDate(cal, new Date(2026, 0, 12));
      expect(services.size).toBe(0);
    });
  });

  describe('calendar_dates exceptions', () => {
    it('exception type 1 adds service on a specific date', () => {
      // Holiday special service on a Monday (normally no weekend service)
      const exception: CalendarDate = {
        serviceId: 'HOLIDAY',
        date: '20260105', // Monday
        exceptionType: 1,
      };
      const cal = buildServiceCalendar([], [exception], 30, MONDAY);
      const services = getActiveServicesForDate(cal, MONDAY);
      expect(services.has('HOLIDAY')).toBe(true);
    });

    it('exception type 2 removes service on a specific date', () => {
      // Cancel weekday service on a specific Monday
      const exception: CalendarDate = {
        serviceId: 'WKD',
        date: '20260105', // Monday
        exceptionType: 2,
      };
      const cal = buildServiceCalendar([WEEKDAY_SERVICE], [exception], 30, MONDAY);
      const services = getActiveServicesForDate(cal, MONDAY);
      expect(services.has('WKD')).toBe(false);
    });

    it('exception type 2 only affects the specific date', () => {
      const exception: CalendarDate = {
        serviceId: 'WKD',
        date: '20260105', // Monday Jan 5
        exceptionType: 2,
      };
      const cal = buildServiceCalendar([WEEKDAY_SERVICE], [exception], 30, MONDAY);
      // Jan 5 cancelled
      expect(getActiveServicesForDate(cal, MONDAY).has('WKD')).toBe(false);
      // Jan 6 (Tuesday) still active
      const tuesday = new Date(2026, 0, 6);
      expect(getActiveServicesForDate(cal, tuesday).has('WKD')).toBe(true);
    });
  });

  describe('isServiceActive', () => {
    it('returns true for active service', () => {
      const cal = buildServiceCalendar([WEEKDAY_SERVICE], [], 30, MONDAY);
      expect(isServiceActive(cal, 'WKD', MONDAY)).toBe(true);
    });

    it('returns false for inactive service', () => {
      const cal = buildServiceCalendar([WEEKDAY_SERVICE], [], 30, MONDAY);
      expect(isServiceActive(cal, 'WKD', SATURDAY)).toBe(false);
    });
  });

  describe('findNextServiceDate', () => {
    it('finds next service date when starting on a no-service day', () => {
      // Only weekday service, starting search from Sunday
      const cal = buildServiceCalendar([WEEKDAY_SERVICE], [], 30, SUNDAY);
      const next = findNextServiceDate(cal, SUNDAY);
      // Next Monday is Jan 12
      expect(next).not.toBeNull();
      expect(next!.getDay()).toBe(1); // Monday
    });

    it('returns null when no service found within maxDays', () => {
      const cal = buildServiceCalendar([], [], 30, MONDAY);
      const next = findNextServiceDate(cal, MONDAY, 7);
      expect(next).toBeNull();
    });
  });
});
