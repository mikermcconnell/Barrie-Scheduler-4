import type { ConnectionLibrary } from '../connections/connectionTypes';
import { getConnectionsForStop, type ConnectionMatch } from '../connections/connectionUtils';
import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import { getDayTypeLabel, getDayTypeSuffix, parseBlockId } from '../config/routeNameParser';
import { matchStopToHub, getPlatformForRoute } from '../platform/platformConfig';
import { validateRouteTable, type MasterRouteTable, type MasterTrip } from '../parsers/masterScheduleParser';
import { TimeUtils } from '../timeUtils';
import { compareBlockIds } from './scheduleEditorUtils';
import { createTripLineageId } from './tripLineage';

export type AddTripBlockMode = 'new' | 'reference' | 'existing';
export type AddTripStartPreset =
  | 'plus-30'
  | 'minus-30'
  | 'plus-60'
  | 'minus-60'
  | 'midpoint'
  | 'target-headway'
  | 'copy-previous'
  | 'copy-next'
  | 'first-trip'
  | 'last-trip'
  | 'manual';

export interface AddTripModalContext {
  referenceTrip: MasterTrip;
  nextTrip: MasterTrip | null;
  targetTable: MasterRouteTable;
  allSchedules: MasterRouteTable[];
  routeBaseName: string;
  connectionLibrary?: ConnectionLibrary | null;
}

export interface AddTripResult {
  startTime: number;
  tripCount: number;
  blockMode: AddTripBlockMode;
  blockId: string;
  targetDirection: 'North' | 'South';
  targetRouteName: string;
  startStopName: string;
  endStopName: string;
}

export interface AddTripBlockChoice {
  blockId: string;
  label: string;
  mode: AddTripBlockMode;
  tripCount: number;
}

export interface AddTripPresetOption {
  preset: AddTripStartPreset;
  label: string;
  startTime: number | null;
}

export interface AddTripPreviewItem {
  index: number;
  direction: 'North' | 'South';
  routeName: string;
  blockId: string;
  startTime: number;
  endTime: number;
  startStopName: string;
  endStopName: string;
  startStopIndex: number;
  endStopIndex: number;
  travelTime: number;
  recoveryTime: number;
  cycleTime: number;
  templateTripId: string | null;
  hasOverlap: boolean;
  gapBeforeMinutes: number | null;
  gapAfterMinutes: number | null;
  connectionMatches: ConnectionMatch[];
  platformLabel: string | null;
}

export interface AddTripImpactSummary {
  gapBeforeMinutes: number | null;
  gapAfterMinutes: number | null;
  targetHeadwayMinutes: number | null;
  headwayDeltaMinutes: number | null;
  templateTravelTimeMinutes: number;
  templateRecoveryTimeMinutes: number;
  templateCycleTimeMinutes: number;
  cycleDeltaMinutes: number | null;
  peakVehiclesBefore: number;
  peakVehiclesAfter: number;
  peakVehicleDelta: number;
  blockCountBefore: number;
  blockCountAfter: number;
  blockCountDelta: number;
  isPartial: boolean;
  partialLabel: string;
  blockMode: AddTripBlockMode;
}

export interface AddTripPlanningBuildResult {
  routeNumber: string;
  dayTypeLabel: string;
  routeSuffix: string;
  availableDirections: Array<'North' | 'South'>;
  selectedTargetTable: MasterRouteTable;
  templateTrip: MasterTrip | null;
  nearbyTrips: { previous: MasterTrip | null; next: MasterTrip | null };
  blockChoices: AddTripBlockChoice[];
  newBlockId: string;
  presetOptions: AddTripPresetOption[];
  previewItems: AddTripPreviewItem[];
  impact: AddTripImpactSummary;
  selectedConnections: ConnectionMatch[];
  routePlatformHints: string[];
  selectedStartStopName: string;
  selectedEndStopName: string;
}

const routeNumberFromBase = (routeBaseName: string): string => routeBaseName.trim().split(' ')[0] || routeBaseName.trim();

export const stripScheduleDecorators = (routeName: string): string => routeName
  .replace(/\s*\((North|South)\)/gi, '')
  .trim();

const getScheduleRouteTables = (context: AddTripModalContext): { northTable: MasterRouteTable | null; southTable: MasterRouteTable | null } => {
  const northTable = context.allSchedules.find(table => table.routeName === `${context.routeBaseName} (North)`) ?? null;
  const southTable = context.allSchedules.find(table => table.routeName === `${context.routeBaseName} (South)`) ?? null;
  return { northTable, southTable };
};

const getTripMinute = (trip: MasterTrip, stopName: string): number | null => {
  const stopMinute = (trip.stopMinutes as Record<string, number | string> | undefined)?.[stopName];
  if (typeof stopMinute === 'number' && Number.isFinite(stopMinute)) return stopMinute;

  const arrival = (trip.arrivalTimes as Record<string, string | number> | undefined)?.[stopName];
  if (arrival !== undefined && arrival !== null && arrival !== '') {
    const parsedArrival = TimeUtils.toMinutes(arrival);
    if (parsedArrival !== null) return parsedArrival;
  }

  const departure = (trip.stops as Record<string, string | number> | undefined)?.[stopName];
  if (departure !== undefined && departure !== null && departure !== '') {
    return TimeUtils.toMinutes(departure);
  }

  return null;
};

const getTemplateTimeline = (trip: MasterTrip, stopNames: string[]): number[] => {
  const explicit = stopNames.map(stop => getTripMinute(trip, stop));
  if (explicit.every(value => typeof value === 'number' && Number.isFinite(value))) {
    const normalized: number[] = [];
    let offset = 0;
    let previous: number | null = null;
    explicit.forEach(value => {
      let next = value as number + offset;
      if (previous !== null && next < previous - 720) {
        offset += 1440;
        next = (value as number) + offset;
      }
      normalized.push(next);
      previous = next;
    });
    return normalized;
  }

  const start = trip.startTime;
  const fallbackTravel = Math.max(0, trip.travelTime || (trip.endTime - trip.startTime));
  const step = stopNames.length > 1 ? fallbackTravel / (stopNames.length - 1) : fallbackTravel;
  return stopNames.map((_, index) => Math.round(start + (step * index)));
};

const resolveStopRange = (
  table: MasterRouteTable,
  startStopName: string,
  endStopName: string,
  fallbackStartIndex: number,
  fallbackEndIndex: number
): { startIndex: number; endIndex: number; startStopName: string; endStopName: string } => {
  const startIndex = table.stops.indexOf(startStopName);
  const endIndex = table.stops.indexOf(endStopName);
  const resolvedStart = startIndex >= 0 ? startIndex : fallbackStartIndex;
  const resolvedEnd = endIndex >= 0 ? endIndex : fallbackEndIndex;
  const start = Math.max(0, Math.min(table.stops.length - 1, resolvedStart));
  const end = Math.max(start, Math.min(table.stops.length - 1, resolvedEnd));
  return {
    startIndex: start,
    endIndex: end,
    startStopName: table.stops[start] ?? startStopName,
    endStopName: table.stops[end] ?? endStopName
  };
};

const getBlockCounts = (schedules: MasterRouteTable[]): Map<string, number> => {
  const counts = new Map<string, number>();
  schedules.forEach(table => {
    table.trips.forEach(trip => counts.set(trip.blockId, (counts.get(trip.blockId) || 0) + 1));
  });
  return counts;
};

const collectBlockChoices = (context: AddTripModalContext): { choices: AddTripBlockChoice[]; newBlockId: string } => {
  const routePrefix = routeNumberFromBase(context.routeBaseName);
  const daySuffix = getDayTypeSuffix(context.targetTable.routeName);
  const existingBlockNums: number[] = [];
  const blockCounts = getBlockCounts(context.allSchedules);

  context.allSchedules.forEach(table => {
    if (!table.routeName.startsWith(routePrefix)) return;
    if (getDayTypeSuffix(table.routeName) !== daySuffix) return;
    table.trips.forEach(trip => {
      const parsed = parseBlockId(trip.blockId);
      if (!parsed) return;
      if (parsed.routeNumber !== routePrefix) return;
      if (parsed.daySuffix && parsed.daySuffix !== daySuffix) return;
      existingBlockNums.push(parsed.number);
    });
  });

  const maxNum = existingBlockNums.length > 0 ? Math.max(...existingBlockNums) : 0;
  const newBlockId = `${routePrefix}-${daySuffix}-${maxNum + 1}`;
  const existingChoices = Array.from(new Set(
    context.allSchedules
      .flatMap(table => table.trips)
      .filter(trip => {
        const parsed = parseBlockId(trip.blockId);
        return !!parsed && parsed.routeNumber === routePrefix && (!parsed.daySuffix || parsed.daySuffix === daySuffix);
      })
      .map(trip => trip.blockId)
  )).sort(compareBlockIds).map(blockId => ({
    blockId,
    label: `${blockId} (${blockCounts.get(blockId) || 1} trip${(blockCounts.get(blockId) || 1) === 1 ? '' : 's'})`,
    mode: 'existing' as const,
    tripCount: blockCounts.get(blockId) || 1
  }));

  return {
    newBlockId,
    choices: [
      { blockId: newBlockId, label: `New block ${newBlockId}`, mode: 'new', tripCount: 0 },
      { blockId: context.referenceTrip.blockId, label: `Continue reference block ${context.referenceTrip.blockId}`, mode: 'reference', tripCount: blockCounts.get(context.referenceTrip.blockId) || 1 },
      ...existingChoices.filter(choice => choice.blockId !== context.referenceTrip.blockId)
    ]
  };
};

const getDirectionTrips = (table: MasterRouteTable, selectedDirection: 'North' | 'South'): MasterTrip[] => (
  [...table.trips]
    .filter(trip => trip.direction === selectedDirection)
    .sort((a, b) => getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime))
);

const getNearbyTrips = (trips: MasterTrip[], referenceTime: number): { previous: MasterTrip | null; next: MasterTrip | null } => {
  const previous = [...trips].filter(trip => getOperationalSortTime(trip.startTime) <= getOperationalSortTime(referenceTime)).pop() ?? null;
  const next = trips.find(trip => getOperationalSortTime(trip.startTime) > getOperationalSortTime(referenceTime)) ?? null;
  return { previous, next };
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : (sorted[mid] ?? null);
};

const getTargetHeadway = (trips: MasterTrip[]): number | null => {
  if (trips.length < 2) return null;
  const headways: number[] = [];
  for (let i = 1; i < trips.length; i++) {
    headways.push(getOperationalSortTime(trips[i].startTime) - getOperationalSortTime(trips[i - 1].startTime));
  }
  return median(headways);
};
const getPresetStartTimes = (
  trips: MasterTrip[],
  nearbyTrips: { previous: MasterTrip | null; next: MasterTrip | null },
  templateTrip: MasterTrip | null,
  anchorTime: number,
  currentStartTime: number
): AddTripPresetOption[] => {
  const targetHeadway = getTargetHeadway(trips);
  const firstTrip = trips[0] ?? null;
  const lastTrip = trips[trips.length - 1] ?? null;
  const midpoint = nearbyTrips.previous && nearbyTrips.next
    ? Math.round((nearbyTrips.previous.startTime + nearbyTrips.next.startTime) / 2)
    : nearbyTrips.previous
      ? nearbyTrips.previous.endTime
        : nearbyTrips.next
        ? nearbyTrips.next.startTime
        : (templateTrip?.startTime ?? currentStartTime);

  const copyPrevious = (() => {
    if (nearbyTrips.previous) {
      const idx = trips.findIndex(trip => trip.id === nearbyTrips.previous?.id);
      if (idx > 0) {
        return nearbyTrips.previous.startTime + (nearbyTrips.previous.startTime - trips[idx - 1].startTime);
      }
      return nearbyTrips.previous.startTime + (targetHeadway ?? Math.max(nearbyTrips.previous.travelTime, 30));
    }
    return templateTrip?.startTime ?? currentStartTime;
  })();

  const copyNext = (() => {
    if (nearbyTrips.next) {
      const idx = trips.findIndex(trip => trip.id === nearbyTrips.next?.id);
      if (idx >= 0 && idx < trips.length - 1) {
        return nearbyTrips.next.startTime - (trips[idx + 1].startTime - nearbyTrips.next.startTime);
      }
      return nearbyTrips.next.startTime - (targetHeadway ?? Math.max(nearbyTrips.next.travelTime, 30));
    }
    return templateTrip?.startTime ?? currentStartTime;
  })();

  return [
    { preset: 'plus-30', label: `+30 min (${TimeUtils.fromMinutes(anchorTime + 30)})`, startTime: anchorTime + 30 },
    { preset: 'minus-30', label: `-30 min (${TimeUtils.fromMinutes(anchorTime - 30)})`, startTime: anchorTime - 30 },
    { preset: 'plus-60', label: `+60 min (${TimeUtils.fromMinutes(anchorTime + 60)})`, startTime: anchorTime + 60 },
    { preset: 'minus-60', label: `-60 min (${TimeUtils.fromMinutes(anchorTime - 60)})`, startTime: anchorTime - 60 },
    { preset: 'midpoint', label: `Midpoint ${TimeUtils.fromMinutes(midpoint)}`, startTime: midpoint },
    { preset: 'target-headway', label: `Target headway ${targetHeadway !== null ? `${targetHeadway} min` : 'auto'}`, startTime: targetHeadway !== null && nearbyTrips.previous ? nearbyTrips.previous.startTime + targetHeadway : midpoint },
    { preset: 'copy-previous', label: `Copy previous pattern ${TimeUtils.fromMinutes(copyPrevious)}`, startTime: copyPrevious },
    { preset: 'copy-next', label: `Copy next pattern ${TimeUtils.fromMinutes(copyNext)}`, startTime: copyNext },
    { preset: 'first-trip', label: `First trip ${firstTrip ? TimeUtils.fromMinutes(firstTrip.startTime) : '-'}`, startTime: firstTrip?.startTime ?? null },
    { preset: 'last-trip', label: `Last trip ${lastTrip ? TimeUtils.fromMinutes(lastTrip.startTime) : '-'}`, startTime: lastTrip?.startTime ?? null },
    { preset: 'manual', label: 'Custom time', startTime: templateTrip?.startTime ?? currentStartTime }
  ];
};

const getPlatformHint = (routeNumber: string, table: MasterRouteTable, stopName: string): string | null => {
  const stopId = table.stopIds?.[stopName];
  const hub = matchStopToHub(stopName, stopId);
  if (!hub) return null;
  const platform = getPlatformForRoute(hub, routeNumber, stopId);
  return platform ? `${hub.name}: ${platform.platformId}` : `${hub.name}: no explicit platform match`;
};

const getConnectionMatches = (
  library: ConnectionLibrary | null | undefined,
  stopCode: string | undefined,
  tripTime: number | null,
  dayType: 'Weekday' | 'Saturday' | 'Sunday'
): ConnectionMatch[] => {
  if (!library || !stopCode || tripTime === null) return [];
  return getConnectionsForStop(stopCode, tripTime, library, dayType);
};

const getMergedConnectionMatches = (
  library: ConnectionLibrary | null | undefined,
  selectedTargetTable: MasterRouteTable,
  startStopName: string,
  endStopName: string,
  startTime: number,
  endTime: number,
  dayType: 'Weekday' | 'Saturday' | 'Sunday'
): ConnectionMatch[] => {
  const startStopCode = selectedTargetTable.stopIds?.[startStopName];
  const endStopCode = selectedTargetTable.stopIds?.[endStopName];

  const matches = [
    ...getConnectionMatches(library, startStopCode, startTime, dayType),
    ...getConnectionMatches(library, endStopCode, endTime, dayType)
  ];

  const seen = new Set<string>();
  return matches.filter(match => {
    const key = `${match.targetId}:${match.eventType}:${match.targetTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getTemplate = (
  directionTrips: MasterTrip[],
  selectedStartTime: number,
  selectedTargetTable: MasterRouteTable,
  selectedDirection: 'North' | 'South'
): MasterTrip | null => {
  if (directionTrips.length === 0) return null;
  const nearby = getNearbyTrips(directionTrips, selectedStartTime);
  if (nearby.previous && nearby.next) {
    const prevDelta = Math.abs(getOperationalSortTime(selectedStartTime) - getOperationalSortTime(nearby.previous.startTime));
    const nextDelta = Math.abs(getOperationalSortTime(nearby.next.startTime) - getOperationalSortTime(selectedStartTime));
    return prevDelta <= nextDelta ? nearby.previous : nearby.next;
  }
  return nearby.previous ?? nearby.next ?? selectedTargetTable.trips.find(trip => trip.direction === selectedDirection) ?? directionTrips[0] ?? null;
};

const getFullRouteRange = (selectedTargetTable: MasterRouteTable) => ({
  startIndex: 0,
  endIndex: Math.max(0, selectedTargetTable.stops.length - 1)
});

const calculatePeakVehicles = (schedules: MasterRouteTable[]): number => {
  const events: Array<{ time: number; delta: number }> = [];
  const blockWindows = new Map<string, { start: number; end: number }>();
  schedules.forEach(table => {
    table.trips.forEach(trip => {
      const start = getOperationalSortTime(trip.startTime);
      const end = getOperationalSortTime(trip.endTime + Math.max(0, trip.recoveryTime || 0));
      const existing = blockWindows.get(trip.blockId);
      if (!existing) blockWindows.set(trip.blockId, { start, end });
      else {
        existing.start = Math.min(existing.start, start);
        existing.end = Math.max(existing.end, end);
      }
    });
  });
  blockWindows.forEach(window => {
    events.push({ time: window.start, delta: 1 });
    events.push({ time: window.end, delta: -1 });
  });
  events.sort((a, b) => (a.time === b.time ? a.delta - b.delta : a.time - b.time));
  let active = 0;
  let peak = 0;
  events.forEach(event => {
    active += event.delta;
    peak = Math.max(peak, active);
  });
  return peak;
};

const buildPreview = (
  context: AddTripModalContext,
  selectedTargetTable: MasterRouteTable,
  direction: 'North' | 'South',
  startTime: number,
  stopSelection: { startStopName: string; endStopName: string },
  blockId: string,
  index: number,
  dayType: 'Weekday' | 'Saturday' | 'Sunday'
): AddTripPreviewItem => {
  const directionTrips = getDirectionTrips(selectedTargetTable, direction);
  const templateTrip = getTemplate(directionTrips, startTime, selectedTargetTable, direction)
    ?? context.referenceTrip;
  const fullRouteRange = getFullRouteRange(selectedTargetTable);
  const resolvedRange = resolveStopRange(
    selectedTargetTable,
    stopSelection.startStopName,
    stopSelection.endStopName,
    templateTrip?.startStopIndex ?? 0,
    templateTrip?.endStopIndex ?? Math.max(0, selectedTargetTable.stops.length - 1)
  );
  const stopNames = selectedTargetTable.stops.slice(resolvedRange.startIndex, resolvedRange.endIndex + 1);
  const template = templateTrip ?? selectedTargetTable.trips.find(trip => trip.direction === direction) ?? null;
  const templateTimeline = template ? getTemplateTimeline(template, stopNames.length > 0 ? stopNames : selectedTargetTable.stops) : [];
  const baseTimeline = templateTimeline.length > 0 ? templateTimeline : stopNames.map((_, stopIndex) => startTime + (stopIndex * 10));
  const delta = startTime - (baseTimeline[0] ?? startTime);
  const shiftedTimeline = baseTimeline.map(value => value + delta);
  const firstStopTime = shiftedTimeline[0] ?? startTime;
  const lastStopTime = shiftedTimeline[shiftedTimeline.length - 1] ?? startTime;
  const fullRoute = resolvedRange.startIndex === fullRouteRange.startIndex && resolvedRange.endIndex === fullRouteRange.endIndex;
  const recoveryTime = template ? (fullRoute ? (template.recoveryTime || 0) : 0) : 0;
  const travelTime = Math.max(0, lastStopTime - firstStopTime);
  const cycleTime = travelTime + recoveryTime;
  const startStopName = stopNames[0] ?? resolvedRange.startStopName;
  const endStopName = stopNames[stopNames.length - 1] ?? resolvedRange.endStopName;
  const connectionMatches = getMergedConnectionMatches(
    context.connectionLibrary,
    selectedTargetTable,
    startStopName,
    endStopName,
    firstStopTime,
    firstStopTime + travelTime,
    dayType
  );
  const platformHints = [
    getPlatformHint(routeNumberFromBase(context.routeBaseName), selectedTargetTable, startStopName),
    endStopName !== startStopName
      ? getPlatformHint(routeNumberFromBase(context.routeBaseName), selectedTargetTable, endStopName)
      : null
  ].filter((value): value is string => !!value);
  const platformLabel = platformHints.length > 0 ? Array.from(new Set(platformHints)).join(' · ') : null;
  const hasOverlap = false;

  return {
    index,
    direction,
    routeName: selectedTargetTable.routeName,
    blockId,
    startTime: firstStopTime,
    endTime: lastStopTime,
    startStopName,
    endStopName,
    startStopIndex: resolvedRange.startIndex,
    endStopIndex: resolvedRange.endIndex,
    travelTime,
    recoveryTime,
    cycleTime,
    templateTripId: template?.id ?? null,
    hasOverlap,
    gapBeforeMinutes: null,
    gapAfterMinutes: null,
    connectionMatches,
    platformLabel
  };
};
export const buildAddTripPresets = (
  context: AddTripModalContext,
  selectedDirection: 'North' | 'South',
  startTime: number
): AddTripPresetOption[] => {
  const { northTable, southTable } = getScheduleRouteTables(context);
  const selectedTargetTable = selectedDirection === 'North' ? (northTable ?? context.targetTable) : (southTable ?? context.targetTable);
  const trips = getDirectionTrips(selectedTargetTable, selectedDirection);
  const nearbyTrips = getNearbyTrips(trips, startTime);
  const templateTrip = getTemplate(trips, startTime, selectedTargetTable, selectedDirection);
  return getPresetStartTimes(trips, nearbyTrips, templateTrip, context.referenceTrip.startTime, startTime);
};

export const buildAddTripSuggestions = (
  context: AddTripModalContext,
  selectedDirection: 'North' | 'South',
  startTime: number,
  tripCount: number,
  blockMode: AddTripBlockMode,
  selectedBlockId: string,
  stopSelection: { startStopName: string; endStopName: string }
): AddTripPlanningBuildResult => {
  const { northTable, southTable } = getScheduleRouteTables(context);
  const availableDirections: Array<'North' | 'South'> = [];
  if (northTable || context.targetTable.routeName.includes('(North)') || context.referenceTrip.direction === 'North') availableDirections.push('North');
  if (southTable || context.targetTable.routeName.includes('(South)') || context.referenceTrip.direction === 'South') availableDirections.push('South');
  if (availableDirections.length === 0) availableDirections.push(context.referenceTrip.direction || 'North');

  const routeNumber = routeNumberFromBase(context.routeBaseName);
  const dayTypeLabel = getDayTypeLabel(context.targetTable.routeName);
  const routeSuffix = getDayTypeSuffix(context.targetTable.routeName);
  const selectedTargetTable = selectedDirection === 'North' ? (northTable ?? context.targetTable) : (southTable ?? context.targetTable);
  const directionTrips = getDirectionTrips(selectedTargetTable, selectedDirection);
  const nearbyTrips = getNearbyTrips(directionTrips, startTime);
  const templateTrip = getTemplate(directionTrips, startTime, selectedTargetTable, selectedDirection);
  const presetOptions = getPresetStartTimes(directionTrips, nearbyTrips, templateTrip, context.referenceTrip.startTime, startTime);
  const { choices: blockChoices, newBlockId } = collectBlockChoices(context);
  const resolvedRange = resolveStopRange(
    selectedTargetTable,
    stopSelection.startStopName,
    stopSelection.endStopName,
    templateTrip?.startStopIndex ?? 0,
    templateTrip?.endStopIndex ?? Math.max(0, selectedTargetTable.stops.length - 1)
  );
  const selectedStartStopName = resolvedRange.startStopName;
  const selectedEndStopName = resolvedRange.endStopName;
  const isBidirectional = !!northTable && !!southTable;
  const blockId = blockMode === 'new' ? newBlockId : blockMode === 'reference' ? context.referenceTrip.blockId : (selectedBlockId || newBlockId);

  const previewItems: AddTripPreviewItem[] = [];
  let currentStart = startTime;
  let currentDirection = selectedDirection;

  for (let i = 0; i < tripCount; i++) {
    const targetDirection = isBidirectional ? currentDirection : selectedDirection;
    const targetTable = targetDirection === 'North' ? (northTable ?? context.targetTable) : (southTable ?? context.targetTable);
    const preview = buildPreview(
      context,
      targetTable,
      targetDirection,
      currentStart,
      { startStopName: selectedStartStopName, endStopName: selectedEndStopName },
      blockId,
      i + 1,
      dayTypeLabel
    );
    previewItems.push(preview);
    currentStart = preview.endTime + preview.recoveryTime;
    if (isBidirectional) currentDirection = currentDirection === 'North' ? 'South' : 'North';
  }

  previewItems.forEach(item => {
    const targetTable = item.direction === 'North' ? (northTable ?? context.targetTable) : (southTable ?? context.targetTable);
    const baselineTrips = getDirectionTrips(targetTable, item.direction).map(trip => ({
      id: trip.id,
      startTime: trip.startTime,
      endTime: trip.endTime
    }));
    const previewTrips = previewItems
      .filter(candidate => candidate.routeName === item.routeName)
      .map(candidate => ({
        id: `preview-${candidate.index}`,
        startTime: candidate.startTime,
        endTime: candidate.endTime
      }));
    const combinedTrips = [...baselineTrips, ...previewTrips]
      .sort((a, b) => getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime));
    const itemIndex = combinedTrips.findIndex(candidate => candidate.id === `preview-${item.index}`);
    const previous = itemIndex > 0 ? combinedTrips[itemIndex - 1] : null;
    const next = itemIndex >= 0 && itemIndex < combinedTrips.length - 1 ? combinedTrips[itemIndex + 1] : null;

    item.gapBeforeMinutes = previous ? item.startTime - previous.endTime : null;
    item.gapAfterMinutes = next ? next.startTime - item.endTime : null;
    item.hasOverlap = combinedTrips.some(candidate => (
      candidate.id !== `preview-${item.index}`
      && item.startTime < candidate.endTime
      && item.endTime > candidate.startTime
    ));
  });

  const firstPreview = previewItems[0] ?? null;
  const lastPreview = previewItems[previewItems.length - 1] ?? null;
  const targetHeadway = getTargetHeadway(directionTrips);
  const templateCycleTime = templateTrip
    ? (templateTrip.cycleTime || (templateTrip.endTime - templateTrip.startTime + (templateTrip.recoveryTime || 0)))
    : null;
  const cycleDeltaMinutes = templateCycleTime !== null && firstPreview ? firstPreview.cycleTime - templateCycleTime : null;
  const beforePeak = calculatePeakVehicles(context.allSchedules);
  const hypotheticalSchedules = JSON.parse(JSON.stringify(context.allSchedules)) as MasterRouteTable[];
  previewItems.forEach(item => {
    const targetTable = hypotheticalSchedules.find(table => table.routeName === item.routeName);
    if (!targetTable) return;
    targetTable.trips.push({
      ...JSON.parse(JSON.stringify(context.referenceTrip)),
      id: `preview-${item.index}-${Date.now()}`,
      rowId: Date.now() + item.index,
      blockId,
      direction: item.direction,
      tripNumber: item.index,
      startTime: item.startTime,
      endTime: item.endTime,
      recoveryTime: item.recoveryTime,
      travelTime: item.travelTime,
      cycleTime: item.cycleTime,
      stops: {},
      arrivalTimes: undefined,
      stopMinutes: undefined,
      startStopIndex: item.startStopIndex > 0 ? item.startStopIndex : undefined,
      endStopIndex: item.endStopIndex < Math.max(0, targetTable.stops.length - 1) ? item.endStopIndex : undefined
    } as MasterTrip);
  });
  const afterPeak = calculatePeakVehicles(hypotheticalSchedules);
  const beforeBlockCount = new Set(context.allSchedules.flatMap(table => table.trips.map(trip => trip.blockId))).size;
  const afterBlockCount = new Set(hypotheticalSchedules.flatMap(table => table.trips.map(trip => trip.blockId))).size;

  const impact: AddTripImpactSummary = {
    gapBeforeMinutes: firstPreview?.gapBeforeMinutes ?? null,
    gapAfterMinutes: lastPreview?.gapAfterMinutes ?? null,
    targetHeadwayMinutes: targetHeadway,
    headwayDeltaMinutes: firstPreview && firstPreview.gapBeforeMinutes !== null && targetHeadway !== null ? firstPreview.gapBeforeMinutes - targetHeadway : null,
    templateTravelTimeMinutes: templateTrip?.travelTime ?? (firstPreview?.travelTime ?? 0),
    templateRecoveryTimeMinutes: templateTrip?.recoveryTime ?? (firstPreview?.recoveryTime ?? 0),
    templateCycleTimeMinutes: templateTrip?.cycleTime ?? (templateTrip ? Math.max(0, templateTrip.endTime - templateTrip.startTime) : 0),
    cycleDeltaMinutes,
    peakVehiclesBefore: beforePeak,
    peakVehiclesAfter: afterPeak,
    peakVehicleDelta: afterPeak - beforePeak,
    blockCountBefore: beforeBlockCount,
    blockCountAfter: afterBlockCount,
    blockCountDelta: afterBlockCount - beforeBlockCount,
    isPartial: selectedStartStopName !== selectedTargetTable.stops[0] || selectedEndStopName !== selectedTargetTable.stops[selectedTargetTable.stops.length - 1],
    partialLabel: selectedStartStopName === selectedTargetTable.stops[0] && selectedEndStopName === selectedTargetTable.stops[selectedTargetTable.stops.length - 1]
      ? 'Full trip'
      : `${selectedStartStopName} → ${selectedEndStopName}`,
    blockMode
  };

  const selectedConnections = firstPreview?.connectionMatches ?? [];
  const routePlatformHints = [...new Set(previewItems.flatMap(item => item.platformLabel ? [item.platformLabel] : []))];

  return {
    routeNumber,
    dayTypeLabel,
    routeSuffix,
    availableDirections,
    selectedTargetTable,
    templateTrip,
    nearbyTrips,
    blockChoices,
    newBlockId,
    presetOptions,
    previewItems,
    impact,
    selectedConnections,
    routePlatformHints,
    selectedStartStopName,
    selectedEndStopName
  };
};

const copyTripTiming = (templateTrip: MasterTrip, selectedStops: string[], startTime: number): {
  stops: Record<string, string>;
  arrivalTimes: Record<string, string>;
  stopMinutes: Record<string, number>;
  endTime: number;
} => {
  const timeline = getTemplateTimeline(templateTrip, selectedStops);
  const shift = startTime - (timeline[0] ?? startTime);
  const stops: Record<string, string> = {};
  const arrivalTimes: Record<string, string> = {};
  const stopMinutes: Record<string, number> = {};
  selectedStops.forEach((stopName, index) => {
    const departure = (timeline[index] ?? startTime) + shift;
    const arrivalSource = (templateTrip.arrivalTimes as Record<string, string | number> | undefined)?.[stopName];
    const arrivalMinute = arrivalSource !== undefined && arrivalSource !== null && arrivalSource !== ''
      ? TimeUtils.toMinutes(arrivalSource)
      : getTripMinute(templateTrip, stopName);
    stops[stopName] = TimeUtils.fromMinutes(departure);
    arrivalTimes[stopName] = TimeUtils.fromMinutes((arrivalMinute ?? (timeline[index] ?? startTime)) + shift);
    stopMinutes[stopName] = departure;
  });
  return { stops, arrivalTimes, stopMinutes, endTime: stopMinutes[selectedStops[selectedStops.length - 1] ?? selectedStops[0]] };
};

const renumberTripsWithinBlocks = (schedules: MasterRouteTable[]): void => {
  const byBlock = new Map<string, MasterTrip[]>();
  schedules.forEach(table => {
    table.trips.forEach(trip => {
      const trips = byBlock.get(trip.blockId) ?? [];
      trips.push(trip);
      byBlock.set(trip.blockId, trips);
    });
  });
  byBlock.forEach(trips => {
    trips.sort((a, b) => {
      const timeDiff = getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime);
      if (timeDiff !== 0) return timeDiff;
      const dirDiff = `${a.direction}`.localeCompare(`${b.direction}`);
      if (dirDiff !== 0) return dirDiff;
      return `${a.id}`.localeCompare(`${b.id}`);
    });
    trips.forEach((trip, index) => { trip.tripNumber = index + 1; });
  });
};

export const applyAddTripResultToSchedules = (
  schedules: MasterRouteTable[],
  context: AddTripModalContext,
  result: AddTripResult
): { schedules: MasterRouteTable[]; createdTripIds: string[] } => {
  const newSchedules = JSON.parse(JSON.stringify(schedules)) as MasterRouteTable[];
  const { northTable, southTable } = getScheduleRouteTables({ ...context, allSchedules: newSchedules });
  const isBidirectional = !!northTable && !!southTable;
  const createdTripIds: string[] = [];
  const blockId = result.blockMode === 'new' ? result.blockId : result.blockMode === 'reference' ? context.referenceTrip.blockId : result.blockId;
  let currentDirection = result.targetDirection;
  let currentStart = result.startTime;

  for (let i = 0; i < result.tripCount; i++) {
    const targetDirection = isBidirectional ? currentDirection : result.targetDirection;
    const targetRouteName = isBidirectional ? `${context.routeBaseName} (${targetDirection})` : result.targetRouteName;
    const targetTable = newSchedules.find(table => table.routeName === targetRouteName) ?? context.targetTable;
    const trips = getDirectionTrips(targetTable, targetDirection);
    const templateTrip = getTemplate(trips, currentStart, targetTable, targetDirection) ?? context.referenceTrip;
    const fullRouteRange = getFullRouteRange(targetTable);
    const range = resolveStopRange(
      targetTable,
      result.startStopName,
      result.endStopName,
      templateTrip.startStopIndex ?? 0,
      templateTrip.endStopIndex ?? Math.max(0, targetTable.stops.length - 1)
    );
    const selectedStops = targetTable.stops.slice(range.startIndex, range.endIndex + 1);
    const timing = copyTripTiming(templateTrip, selectedStops.length > 0 ? selectedStops : targetTable.stops, currentStart);
    const endTime = timing.endTime;
    const isFullRoute = range.startIndex === fullRouteRange.startIndex && range.endIndex === fullRouteRange.endIndex;
    const recoveryTime = isFullRoute ? (templateTrip.recoveryTime || 0) : 0;
    const travelTime = Math.max(0, endTime - currentStart);
    const cycleTime = travelTime + recoveryTime;

    const newTrip: MasterTrip = {
      ...JSON.parse(JSON.stringify(templateTrip)),
      id: `trip_${Date.now()}_${Math.floor(Math.random() * 10000)}_${i}`,
      lineageId: createTripLineageId(),
      rowId: Date.now() + i,
      blockId,
      direction: targetDirection,
      tripNumber: 0,
      startTime: currentStart,
      endTime,
      travelTime,
      recoveryTime,
      cycleTime,
      stops: timing.stops,
      arrivalTimes: timing.arrivalTimes,
      stopMinutes: timing.stopMinutes,
      startStopIndex: range.startIndex > fullRouteRange.startIndex ? range.startIndex : undefined,
      endStopIndex: range.endIndex < fullRouteRange.endIndex ? range.endIndex : undefined,
      endTimeIncludesRecovery: false
    };

    targetTable.trips.push(newTrip);
    targetTable.trips.sort((a, b) => getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime));
    createdTripIds.push(newTrip.id);
    currentStart = endTime + recoveryTime;
    if (isBidirectional) currentDirection = currentDirection === 'North' ? 'South' : 'North';
  }

  renumberTripsWithinBlocks(newSchedules);
  newSchedules.forEach(table => {
    table.trips.sort((a, b) => getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime));
    validateRouteTable(table);
  });

  return { schedules: newSchedules, createdTripIds };
};
