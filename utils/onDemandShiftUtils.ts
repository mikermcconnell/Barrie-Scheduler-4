import type { Shift } from './demandTypes';

export type OnDemandDayType = 'Weekday' | 'Saturday' | 'Sunday';

const DAY_PREFIX_PATTERN = /^(Weekday|Saturday|Sunday)::/;

function createShiftSeed(index: number): string {
  return `shift-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function stripDayPrefix(id: string): string {
  return id.replace(DAY_PREFIX_PATTERN, '');
}

export function getShiftDayType(shift: Shift, fallbackDayType: OnDemandDayType = 'Weekday'): OnDemandDayType {
  return shift.dayType ?? fallbackDayType;
}

export function createScopedShiftId(dayType: OnDemandDayType, rawId?: string, index = 0): string {
  const baseId = stripDayPrefix((rawId || '').trim()) || createShiftSeed(index);
  return `${dayType}::${baseId}`;
}

export function normalizeOnDemandShifts(
  shifts: Shift[],
  fallbackDayType: OnDemandDayType = 'Weekday'
): Shift[] {
  const seenIds = new Set<string>();

  return shifts.map((shift, index) => {
    const dayType = getShiftDayType(shift, fallbackDayType);
    const baseScopedId = createScopedShiftId(dayType, shift.id, index);
    let scopedId = baseScopedId;
    let duplicateIndex = 1;

    while (seenIds.has(scopedId)) {
      scopedId = `${baseScopedId}-${duplicateIndex++}`;
    }

    seenIds.add(scopedId);

    return {
      ...shift,
      id: scopedId,
      dayType,
    };
  });
}

export function filterShiftsByDay(shifts: Shift[], dayType: OnDemandDayType): Shift[] {
  return shifts.filter(shift => getShiftDayType(shift) === dayType);
}

export function removeShiftFromDay(shifts: Shift[], shiftId: string, dayType: OnDemandDayType): Shift[] {
  return shifts.filter(shift => !(shift.id === shiftId && getShiftDayType(shift) === dayType));
}

export function updateShiftInDay(shifts: Shift[], updatedShift: Shift, dayType: OnDemandDayType): Shift[] {
  return shifts.map(shift => {
    if (shift.id !== updatedShift.id) return shift;
    if (getShiftDayType(shift) !== dayType) return shift;
    return {
      ...updatedShift,
      dayType,
      id: createScopedShiftId(dayType, updatedShift.id),
    };
  });
}
