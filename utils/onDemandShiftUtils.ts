import type { Shift } from './demandTypes';

export type OnDemandDayType = 'Weekday' | 'Saturday' | 'Sunday';

const DAY_PREFIX_PATTERN = /^(Weekday|Saturday|Sunday)::/;

function createShiftSeed(index: number): string {
  return `shift-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function stripDayPrefix(id: string): string {
  return id.replace(DAY_PREFIX_PATTERN, '');
}

function normalizeShiftReferenceId(
  shiftId: string | undefined,
  dayType: OnDemandDayType,
  selfId: string,
): string | undefined {
  const trimmed = (shiftId || '').trim();
  if (!trimmed) return undefined;

  const scopedId = createScopedShiftId(dayType, trimmed);
  return scopedId === selfId ? undefined : scopedId;
}

function normalizeShiftForDay(shift: Shift, dayType: OnDemandDayType, index = 0): Shift {
  const scopedId = createScopedShiftId(dayType, shift.id, index);

  return {
    ...shift,
    id: scopedId,
    dayType,
    handoffFromShiftId: normalizeShiftReferenceId(shift.handoffFromShiftId, dayType, scopedId),
    handoffToShiftId: normalizeShiftReferenceId(shift.handoffToShiftId, dayType, scopedId),
  };
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

  const normalized = shifts.map((shift, index) => {
    const dayType = getShiftDayType(shift, fallbackDayType);
    const baseScopedId = createScopedShiftId(dayType, shift.id, index);
    let scopedId = baseScopedId;
    let duplicateIndex = 1;

    while (seenIds.has(scopedId)) {
      scopedId = `${baseScopedId}-${duplicateIndex++}`;
    }

    seenIds.add(scopedId);

    return {
      ...normalizeShiftForDay(shift, dayType, index),
      id: scopedId,
      dayType,
    };
  });

  const validIds = new Set(normalized.map((shift) => shift.id));

  return normalized.map((shift) => ({
    ...shift,
    handoffFromShiftId: shift.handoffFromShiftId && validIds.has(shift.handoffFromShiftId)
      ? shift.handoffFromShiftId
      : undefined,
    handoffToShiftId: shift.handoffToShiftId && validIds.has(shift.handoffToShiftId)
      ? shift.handoffToShiftId
      : undefined,
  }));
}

export function filterShiftsByDay(shifts: Shift[], dayType: OnDemandDayType): Shift[] {
  return shifts.filter(shift => getShiftDayType(shift) === dayType);
}

export function removeShiftFromDay(shifts: Shift[], shiftId: string, dayType: OnDemandDayType): Shift[] {
  return shifts
    .filter(shift => !(shift.id === shiftId && getShiftDayType(shift) === dayType))
    .map((shift) => {
      if (getShiftDayType(shift) !== dayType) {
        return shift;
      }

      return {
        ...shift,
        handoffFromShiftId: shift.handoffFromShiftId === shiftId ? undefined : shift.handoffFromShiftId,
        handoffToShiftId: shift.handoffToShiftId === shiftId ? undefined : shift.handoffToShiftId,
      };
    });
}

export function updateShiftInDay(shifts: Shift[], updatedShift: Shift, dayType: OnDemandDayType): Shift[] {
  const normalizedUpdatedShift = normalizeShiftForDay(updatedShift, dayType);

  return shifts.map(shift => {
    if (shift.id !== updatedShift.id) return shift;
    if (getShiftDayType(shift) !== dayType) return shift;
    return normalizedUpdatedShift;
  });
}

export function syncShiftHandoffInDay(
  shifts: Shift[],
  updatedShift: Shift,
  dayType: OnDemandDayType,
): Shift[] {
  const normalizedUpdatedShift = normalizeShiftForDay(updatedShift, dayType);
  const dayShiftIds = new Set(
    shifts
      .filter((shift) => getShiftDayType(shift) === dayType)
      .map((shift) => createScopedShiftId(dayType, shift.id)),
  );

  const handoffFromShiftId = normalizedUpdatedShift.handoffFromShiftId && dayShiftIds.has(normalizedUpdatedShift.handoffFromShiftId)
    ? normalizedUpdatedShift.handoffFromShiftId
    : undefined;
  const handoffToShiftId = normalizedUpdatedShift.handoffToShiftId && dayShiftIds.has(normalizedUpdatedShift.handoffToShiftId)
    ? normalizedUpdatedShift.handoffToShiftId
    : undefined;

  return shifts.map((shift) => {
    if (getShiftDayType(shift) !== dayType) {
      return shift;
    }

    const normalizedShift = shift.id === normalizedUpdatedShift.id
      ? {
          ...normalizedUpdatedShift,
          handoffFromShiftId,
          handoffToShiftId,
        }
      : normalizeShiftForDay(shift, dayType);

    let nextShift: Shift = { ...normalizedShift };

    if (nextShift.id !== handoffFromShiftId && nextShift.handoffToShiftId === normalizedUpdatedShift.id) {
      nextShift = { ...nextShift, handoffToShiftId: undefined };
    }

    if (nextShift.id !== handoffToShiftId && nextShift.handoffFromShiftId === normalizedUpdatedShift.id) {
      nextShift = { ...nextShift, handoffFromShiftId: undefined };
    }

    if (handoffFromShiftId) {
      if (nextShift.id === handoffFromShiftId) {
        nextShift = { ...nextShift, handoffToShiftId: normalizedUpdatedShift.id };
      } else if (nextShift.id !== normalizedUpdatedShift.id && nextShift.handoffFromShiftId === handoffFromShiftId) {
        nextShift = { ...nextShift, handoffFromShiftId: undefined };
      }
    }

    if (handoffToShiftId) {
      if (nextShift.id === handoffToShiftId) {
        nextShift = { ...nextShift, handoffFromShiftId: normalizedUpdatedShift.id };
      } else if (nextShift.id !== normalizedUpdatedShift.id && nextShift.handoffToShiftId === handoffToShiftId) {
        nextShift = { ...nextShift, handoffToShiftId: undefined };
      }
    }

    return nextShift;
  });
}
