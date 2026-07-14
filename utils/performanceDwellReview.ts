import type {
  DailySummary,
  DwellCascade,
  DwellExposureSummary,
  DwellIncident,
} from './performanceDataTypes';

export type DwellImpactStatus = 'otp-late' | 'delay-carried' | 'no-later-carryover' | 'unknown';
export type DwellEvidenceConfidence = 'high' | 'partial' | 'limited';

export interface DwellIncidentReviewRow {
  incident: DwellIncident;
  cascade: DwellCascade | null;
  impactStatus: DwellImpactStatus;
  confidence: DwellEvidenceConfidence;
  departureLatenessSeconds: number | null;
}

export interface DwellPatternSummary {
  key: string;
  routeId: string;
  stopName: string;
  tripName: string;
  distinctDays: number;
  incidentCount: number;
  highCount: number;
  avgDwellSeconds: number;
  otpLateDepartures: number;
  operatorCount: number;
  latestDate: string;
}

export interface DwellOperatorContext {
  operatorId: string;
  incidentCount: number;
  highCount: number;
  reportableDwellSeconds: number;
  eligibleTimepointVisits: number | null;
  incidentsPer1kEligibleVisits: number | null;
}

export interface DwellDailyTrendPoint {
  date: string;
  incidents: number;
  high: number;
  eligibleTimepointVisits: number | null;
  incidentsPer1kEligibleVisits: number | null;
}

export interface DwellIncidentReviewModel {
  rows: DwellIncidentReviewRow[];
  patterns: DwellPatternSummary[];
  operatorContext: DwellOperatorContext[];
  dailyTrend: DwellDailyTrendPoint[];
  totalIncidents: number;
  highCount: number;
  reportableDwellMinutes: number;
  otpLateDepartures: number;
  otpCarryoverIncidentCount: number;
  eligibleTimepointVisits: number | null;
  incidentsPer1kEligibleVisits: number | null;
  daysMissingDwellData: string[];
  daysNeedingReimport: string[];
}

const isReportable = (incident: DwellIncident): boolean =>
  incident.severity === 'moderate' || incident.severity === 'high';

const legacyJoinKey = (value: Pick<
  DwellIncident | DwellCascade,
  'date' | 'block' | 'routeId' | 'stopId' | 'tripName' | 'operatorId' | 'observedDepartureTime'
>): string => [
  value.date,
  value.block,
  value.routeId,
  value.stopId,
  value.tripName,
  value.operatorId,
  value.observedDepartureTime,
].join('||');

function buildCascadeLookups(days: DailySummary[]): {
  byId: Map<string, DwellCascade>;
  byLegacyKey: Map<string, DwellCascade>;
} {
  const byId = new Map<string, DwellCascade>();
  const byLegacyKey = new Map<string, DwellCascade>();
  for (const day of days) {
    for (const cascade of day.byCascade?.cascades ?? []) {
      if (cascade.incidentId) byId.set(cascade.incidentId, cascade);
      byLegacyKey.set(legacyJoinKey(cascade), cascade);
    }
  }
  return { byId, byLegacyKey };
}

function getImpactStatus(cascade: DwellCascade | null): DwellImpactStatus {
  if (!cascade || cascade.incidentRecordMatched === false) return 'unknown';
  if (cascade.blastRadius > 0) return 'otp-late';
  if (cascade.affectedTripCount > 0) return 'delay-carried';
  return 'no-later-carryover';
}

function hasUsableCascadeEvidence(cascade: DwellCascade | null): cascade is DwellCascade {
  return !!cascade && cascade.incidentRecordMatched !== false;
}

function getConfidence(cascade: DwellCascade | null): DwellEvidenceConfidence {
  if (!cascade || cascade.incidentRecordMatched === false) return 'limited';
  const missing = (cascade.sameTripMissingObservedTimepointCount ?? 0)
    + (cascade.laterTripMissingObservedTimepointCount ?? 0);
  if (cascade.sameTripObserved === true && missing === 0) return 'high';
  return 'partial';
}

export function compareDwellReviewRows(a: DwellIncidentReviewRow, b: DwellIncidentReviewRow): number {
  const severityDelta = Number(b.incident.severity === 'high') - Number(a.incident.severity === 'high');
  if (severityDelta !== 0) return severityDelta;
  const aCascade = hasUsableCascadeEvidence(a.cascade) ? a.cascade : null;
  const bCascade = hasUsableCascadeEvidence(b.cascade) ? b.cascade : null;
  const blastDelta = (bCascade?.blastRadius ?? -1) - (aCascade?.blastRadius ?? -1);
  if (blastDelta !== 0) return blastDelta;
  const tripsDelta = (bCascade?.affectedTripCount ?? -1) - (aCascade?.affectedTripCount ?? -1);
  if (tripsDelta !== 0) return tripsDelta;
  const dwellDelta = b.incident.trackedDwellSeconds - a.incident.trackedDwellSeconds;
  if (dwellDelta !== 0) return dwellDelta;
  const dateDelta = b.incident.date.localeCompare(a.incident.date);
  if (dateDelta !== 0) return dateDelta;
  return b.incident.observedDepartureTime.localeCompare(a.incident.observedDepartureTime);
}

function aggregateExposure(days: DailySummary[]): DwellExposureSummary[] {
  const map = new Map<string, DwellExposureSummary>();
  for (const day of days) {
    for (const row of day.byOperatorDwell?.exposureByRouteOperator ?? []) {
      const key = `${row.routeId}||${row.operatorId}`;
      const current = map.get(key);
      if (current) current.eligibleTimepointVisits += row.eligibleTimepointVisits;
      else map.set(key, { ...row });
    }
  }
  return [...map.values()];
}

function buildPatterns(rows: DwellIncidentReviewRow[]): DwellPatternSummary[] {
  const groups = new Map<string, DwellIncidentReviewRow[]>();
  for (const row of rows) {
    const key = `${row.incident.routeId}||${row.incident.stopId}||${row.incident.tripName}`;
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const dates = [...new Set(group.map(row => row.incident.date))].sort();
    const operators = new Set(group.map(row => row.incident.operatorId));
    return {
      key,
      routeId: group[0].incident.routeId,
      stopName: group[0].incident.stopName,
      tripName: group[0].incident.tripName,
      distinctDays: dates.length,
      incidentCount: group.length,
      highCount: group.filter(row => row.incident.severity === 'high').length,
      avgDwellSeconds: group.reduce((sum, row) => sum + row.incident.trackedDwellSeconds, 0) / group.length,
      otpLateDepartures: group.reduce((sum, row) => (
        sum + (hasUsableCascadeEvidence(row.cascade) ? row.cascade.blastRadius : 0)
      ), 0),
      operatorCount: operators.size,
      latestDate: dates[dates.length - 1] ?? '',
    };
  }).filter(pattern => pattern.distinctDays >= 3)
    .sort((a, b) => b.otpLateDepartures - a.otpLateDepartures
      || b.distinctDays - a.distinctDays
      || b.highCount - a.highCount
      || b.incidentCount - a.incidentCount);
}

function assembleReviewModel(
  days: DailySummary[],
  rows: DwellIncidentReviewRow[],
  includeExposure: boolean,
): DwellIncidentReviewModel {
  const exposureRows = includeExposure ? aggregateExposure(days) : [];
  const hasExposureData = includeExposure
    && days.length > 0
    && days.every(day => day.schemaVersion >= 12
      && day.byOperatorDwell?.exposureByRouteOperator !== undefined);
  const eligibleTimepointVisits = hasExposureData
    ? exposureRows.reduce((sum, row) => sum + row.eligibleTimepointVisits, 0)
    : null;

  const operatorIds = new Set<string>([
    ...rows.map(row => row.incident.operatorId),
    ...exposureRows.map(row => row.operatorId),
  ]);
  const operatorContext = [...operatorIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(operatorId => {
    const operatorRows = rows.filter(row => row.incident.operatorId === operatorId);
    const exposure = hasExposureData
      ? exposureRows.filter(row => row.operatorId === operatorId).reduce((sum, row) => sum + row.eligibleTimepointVisits, 0)
      : null;
    return {
      operatorId,
      incidentCount: operatorRows.length,
      highCount: operatorRows.filter(row => row.incident.severity === 'high').length,
      reportableDwellSeconds: operatorRows.reduce((sum, row) => sum + row.incident.trackedDwellSeconds, 0),
      eligibleTimepointVisits: exposure,
      incidentsPer1kEligibleVisits: exposure && exposure > 0 ? operatorRows.length / exposure * 1000 : null,
    };
  });

  const dailyTrend = days.map((day): DwellDailyTrendPoint => {
    const dayRows = rows.filter(row => row.incident.date === day.date);
    const exposureAvailable = hasExposureData;
    const exposure = exposureAvailable
      ? (day.byOperatorDwell?.exposureByRouteOperator ?? []).reduce((sum, row) => sum + row.eligibleTimepointVisits, 0)
      : null;
    return {
      date: day.date,
      incidents: dayRows.length,
      high: dayRows.filter(row => row.incident.severity === 'high').length,
      eligibleTimepointVisits: exposure,
      incidentsPer1kEligibleVisits: exposure && exposure > 0 ? dayRows.length / exposure * 1000 : null,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));

  const highCount = rows.filter(row => row.incident.severity === 'high').length;
  const otpLateDepartures = rows.reduce((sum, row) => (
    sum + (hasUsableCascadeEvidence(row.cascade) ? row.cascade.blastRadius : 0)
  ), 0);
  return {
    rows,
    patterns: buildPatterns(rows),
    operatorContext,
    dailyTrend,
    totalIncidents: rows.length,
    highCount,
    reportableDwellMinutes: rows.reduce((sum, row) => sum + row.incident.trackedDwellSeconds, 0) / 60,
    otpLateDepartures,
    otpCarryoverIncidentCount: rows.filter(row => (
      hasUsableCascadeEvidence(row.cascade) && row.cascade.blastRadius > 0
    )).length,
    eligibleTimepointVisits,
    incidentsPer1kEligibleVisits: eligibleTimepointVisits && eligibleTimepointVisits > 0
      ? rows.length / eligibleTimepointVisits * 1000
      : null,
    daysMissingDwellData: days.filter(day => !day.byOperatorDwell).map(day => day.date),
    daysNeedingReimport: days.filter(day => day.schemaVersion < 12
      || day.byOperatorDwell?.exposureByRouteOperator === undefined
      || (day.byOperatorDwell?.incidents ?? []).some(incident => isReportable(incident) && !incident.incidentId))
      .map(day => day.date),
  };
}

export function buildDwellIncidentReviewModel(days: DailySummary[]): DwellIncidentReviewModel {
  const incidents = days.flatMap(day => day.byOperatorDwell?.incidents ?? []).filter(isReportable);
  const cascades = buildCascadeLookups(days);
  const rows = incidents.map((incident): DwellIncidentReviewRow => {
    const cascade = (incident.incidentId ? cascades.byId.get(incident.incidentId) : undefined)
      ?? cascades.byLegacyKey.get(legacyJoinKey(incident))
      ?? null;
    return {
      incident,
      cascade,
      impactStatus: getImpactStatus(cascade),
      confidence: getConfidence(cascade),
      departureLatenessSeconds: incident.departureDeviationSeconds ?? null,
    };
  }).sort(compareDwellReviewRows);

  return assembleReviewModel(days, rows, true);
}

/** Builds supporting export sections from the active incident filters.
 * Exposure rates are deliberately suppressed because arbitrary incident filters
 * do not have a matching eligible-visit denominator.
 */
export function buildFilteredDwellIncidentReviewModel(
  days: DailySummary[],
  rows: DwellIncidentReviewRow[],
): DwellIncidentReviewModel {
  return assembleReviewModel(days, [...rows], false);
}
