// Calendar Service — GTFS service day resolution
// Ported from BTTP src/services/calendarService.js

import type { CalendarEntry, CalendarDate, DayOfWeek, ServiceCalendar } from './types';

const DAYS: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseGTFSDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.length !== 8) return null;
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

export function formatGTFSDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function getDayOfWeek(date: Date): DayOfWeek {
  return DAYS[date.getDay()];
}

function isDateInRange(date: Date, calendar: CalendarEntry): boolean {
  const start = parseGTFSDate(calendar.startDate);
  const end = parseGTFSDate(calendar.endDate);
  if (!start || !end) return false;
  return date >= start && date <= end;
}

/**
 * Build a lookup map of active services by date.
 * Pre-computes which services run on which dates for fast lookup.
 */
export function buildServiceCalendar(
  calendar: CalendarEntry[],
  calendarDates: CalendarDate[],
  daysAhead = 30,
  referenceDate?: Date
): ServiceCalendar {
  const serviceCalendar: ServiceCalendar = {};
  const today = referenceDate ? new Date(referenceDate.getTime()) : new Date();
  today.setHours(0, 0, 0, 0);

  // Pre-index calendar_dates by date for faster lookup
  const exceptions: Record<string, CalendarDate[]> = {};
  for (const cd of calendarDates) {
    if (!exceptions[cd.date]) {
      exceptions[cd.date] = [];
    }
    exceptions[cd.date].push(cd);
  }

  for (let i = 0; i < daysAhead; i++) {
    const date = new Date(today.getTime());
    date.setDate(date.getDate() + i);
    const dateStr = formatGTFSDate(date);
    const dayOfWeek = getDayOfWeek(date);

    const activeServices = new Set<string>();

    // Check regular calendar entries
    for (const cal of calendar) {
      if (isDateInRange(date, cal) && cal[dayOfWeek]) {
        activeServices.add(cal.serviceId);
      }
    }

    // Apply exceptions for this date
    const dayExceptions = exceptions[dateStr] || [];
    for (const ex of dayExceptions) {
      if (ex.exceptionType === 1) {
        activeServices.add(ex.serviceId);
      } else if (ex.exceptionType === 2) {
        activeServices.delete(ex.serviceId);
      }
    }

    serviceCalendar[dateStr] = activeServices;
  }

  return serviceCalendar;
}

/** Get active services for a specific date */
export function getActiveServicesForDate(serviceCalendar: ServiceCalendar, date: Date): Set<string> {
  const dateStr = formatGTFSDate(date);
  return serviceCalendar[dateStr] || new Set<string>();
}

/** Check if a specific service is active on a date */
export function isServiceActive(serviceCalendar: ServiceCalendar, serviceId: string, date: Date): boolean {
  const activeServices = getActiveServicesForDate(serviceCalendar, date);
  return activeServices.has(serviceId);
}

/** Find the next date when any service is active */
export function findNextServiceDate(serviceCalendar: ServiceCalendar, fromDate: Date, maxDays = 7): Date | null {
  const date = new Date(fromDate.getTime());
  for (let i = 0; i < maxDays; i++) {
    const services = getActiveServicesForDate(serviceCalendar, date);
    if (services.size > 0) {
      return new Date(date.getTime());
    }
    date.setDate(date.getDate() + 1);
  }
  return null;
}
