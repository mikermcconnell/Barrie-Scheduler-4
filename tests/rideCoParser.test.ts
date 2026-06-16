// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseRideCo } from '../utils/parsers/csvParsers';

const makeRideCoRows = (): Array<Array<string | number>> => {
  const rows = Array.from({ length: 20 }, () => Array<string | number>(4).fill(''));

  rows[9] = ['', 'Example', 'Shift1', 'Shift2'];
  rows[10] = ['Day', 'All Weekdays', 'All Weekdays', 'Sat'];
  rows[13] = ['Driver (optional)', 'John', 'North', 'South'];
  rows[14] = ['Shift Label', 'example', 'Bus 1A', 'Bus 1B'];
  rows[15] = ['Service Start Time', '9:00 AM', 0.25, 0.59375]; // 6:00, 14:15
  rows[16] = ['Service End Time', '5:00 PM', 0.5555555555555556, 1]; // 13:20, midnight
  rows[17] = ['Break 1 Window Start Time', '11:00 AM', 0.4166666666666667, 0.7916666666666666]; // 10:00, 19:00
  rows[18] = ['Break 1 Window End Time', '11:30 AM', 0.4409722222222222, 0.8159722222222222]; // 10:35, 19:35
  rows[19] = ['Break 1 Duration (min)', 15, '', ''];

  return rows;
};

describe('RideCo shift parser', () => {
  it('parses Excel numeric time fractions as times of day', () => {
    const shifts = parseRideCo(makeRideCoRows());

    expect(shifts).toHaveLength(2);
    expect(shifts[0]).toMatchObject({
      driverName: 'Bus 1A',
      zone: 'North',
      startSlot: 72, // 6:00 on 5-minute grid
      endSlot: 160, // 13:20
      breakStartSlot: 120, // 10:00
      breakDurationSlots: 7, // 35 minutes
      dayType: 'Weekday',
    });
  });

  it('treats Excel numeric midnight as next-day end when it is after the shift start', () => {
    const shifts = parseRideCo(makeRideCoRows());

    expect(shifts[1]).toMatchObject({
      driverName: 'Bus 1B',
      zone: 'South',
      startSlot: 171, // 14:15
      endSlot: 288, // 24:00 / next-day midnight
      breakStartSlot: 228, // 19:00
      breakDurationSlots: 7, // 35 minutes
      dayType: 'Saturday',
    });
  });
});
