import type { PerformanceDataSummary, PerformanceMetadata } from './performanceDataTypes';
import {
  PERFORMANCE_RUNTIME_LOGIC_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
} from './performanceDataTypes';

export type ImportHealthStatus = 'healthy' | 'warning' | 'critical';

export interface ImportHealthCheck {
  id: string;
  label: string;
  status: ImportHealthStatus;
  summary: string;
}

export interface PerformanceImportHealth {
  overallStatus: ImportHealthStatus;
  headline: string;
  summary: string;
  latestImportAt: string | null;
  latestServiceDate: string | null;
  checks: ImportHealthCheck[];
}

interface BuildImportHealthOptions {
  now?: Date;
}

export interface PerformanceMetadataHealth {
  status: ImportHealthStatus;
  label: string;
  summary: string;
}

function statusRank(status: ImportHealthStatus): number {
  switch (status) {
    case 'critical': return 2;
    case 'warning': return 1;
    default: return 0;
  }
}

function maxStatus(a: ImportHealthStatus, b: ImportHealthStatus): ImportHealthStatus {
  return statusRank(a) >= statusRank(b) ? a : b;
}

function formatAbsoluteDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatAbsoluteDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function diffHours(now: Date, then: Date): number {
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60);
}

function diffCalendarDays(now: Date, dateString: string): number | null {
  const parsed = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThen = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return Math.round((startNow.getTime() - startThen.getTime()) / (1000 * 60 * 60 * 24));
}

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function buildPerformanceImportHealth(
  data: PerformanceDataSummary,
  options: BuildImportHealthOptions = {},
): PerformanceImportHealth {
  const now = options.now ?? new Date();
  const latestImportAt = data.metadata?.importedAt ?? null;
  const latestServiceDate = data.metadata?.dateRange?.end
    ?? data.dailySummaries.map(day => day.date).sort().at(-1)
    ?? null;

  const checks: ImportHealthCheck[] = [];
  let overallStatus: ImportHealthStatus = 'healthy';

  if (!latestImportAt) {
    checks.push({
      id: 'import-recency',
      label: 'Latest import',
      status: 'critical',
      summary: 'Import timestamp is missing, so the app cannot confirm when the auto-import last ran.',
    });
    overallStatus = 'critical';
  } else {
    const importedAtDate = new Date(latestImportAt);
    if (Number.isNaN(importedAtDate.getTime())) {
      checks.push({
        id: 'import-recency',
        label: 'Latest import',
        status: 'critical',
        summary: `Import timestamp "${latestImportAt}" could not be read.`,
      });
      overallStatus = 'critical';
    } else {
      const hoursOld = diffHours(now, importedAtDate);
      const status: ImportHealthStatus = hoursOld > 72
        ? 'critical'
        : hoursOld > 36
          ? 'warning'
          : 'healthy';
      checks.push({
        id: 'import-recency',
        label: 'Latest import',
        status,
        summary: status === 'healthy'
          ? `Last import ran ${Math.round(hoursOld)} hours ago on ${formatAbsoluteDateTime(latestImportAt)}.`
          : status === 'warning'
            ? `Last import ran ${Math.round(hoursOld)} hours ago on ${formatAbsoluteDateTime(latestImportAt)}. The daily flow may be delayed.`
            : `Last import ran ${Math.round(hoursOld)} hours ago on ${formatAbsoluteDateTime(latestImportAt)}. The daily import likely stopped running.`,
      });
      overallStatus = maxStatus(overallStatus, status);
    }
  }

  if (!latestServiceDate) {
    checks.push({
      id: 'service-coverage',
      label: 'Latest service day',
      status: 'critical',
      summary: 'No service dates are stored, so the app cannot confirm that recent STREETS data is present.',
    });
    overallStatus = 'critical';
  } else {
    const dayGap = diffCalendarDays(now, latestServiceDate);
    const status: ImportHealthStatus = dayGap === null
      ? 'critical'
      : dayGap > 3
        ? 'critical'
        : dayGap > 1
          ? 'warning'
          : 'healthy';
    checks.push({
      id: 'service-coverage',
      label: 'Latest service day',
      status,
      summary: dayGap === null
        ? `Latest service date "${latestServiceDate}" could not be read.`
        : status === 'healthy'
          ? `Data includes service through ${formatAbsoluteDate(latestServiceDate)}.`
          : status === 'warning'
            ? `Latest service day is ${formatAbsoluteDate(latestServiceDate)} (${pluralize(dayGap, 'day')} behind today).`
            : `Latest service day is ${formatAbsoluteDate(latestServiceDate)} (${pluralize(dayGap, 'day')} behind today). The import history is stale.`,
    });
    overallStatus = maxStatus(overallStatus, status);
  }

  const runtimeLogicVersion = data.metadata?.runtimeLogicVersion;
  const runtimeLogicStatus: ImportHealthStatus =
    typeof runtimeLogicVersion !== 'number'
      ? 'warning'
      : runtimeLogicVersion < PERFORMANCE_RUNTIME_LOGIC_VERSION
        ? 'warning'
        : 'healthy';
  checks.push({
    id: 'runtime-logic',
    label: 'Runtime logic',
    status: runtimeLogicStatus,
    summary: typeof runtimeLogicVersion !== 'number'
      ? `Runtime logic version is missing. Some stored days may predate the current import pipeline (current is v${PERFORMANCE_RUNTIME_LOGIC_VERSION}).`
      : runtimeLogicVersion < PERFORMANCE_RUNTIME_LOGIC_VERSION
        ? `Stored data uses runtime logic v${runtimeLogicVersion}, but the current import pipeline is v${PERFORMANCE_RUNTIME_LOGIC_VERSION}.`
        : `Stored data is stamped with the current runtime logic v${runtimeLogicVersion}.`,
  });
  overallStatus = maxStatus(overallStatus, runtimeLogicStatus);

  const schemaCounts = new Map<number, number>();
  data.dailySummaries.forEach((day) => {
    schemaCounts.set(day.schemaVersion, (schemaCounts.get(day.schemaVersion) || 0) + 1);
  });
  const schemaVersions = Array.from(schemaCounts.keys()).sort((a, b) => a - b);
  const legacyDayCount = data.dailySummaries.filter(day => day.schemaVersion < PERFORMANCE_SCHEMA_VERSION).length;
  const schemaStatus: ImportHealthStatus =
    schemaVersions.length <= 1 && legacyDayCount === 0
      ? 'healthy'
      : 'warning';
  checks.push({
    id: 'history-consistency',
    label: 'History consistency',
    status: schemaStatus,
    summary: schemaStatus === 'healthy'
      ? `All stored days use the current schema v${PERFORMANCE_SCHEMA_VERSION}.`
      : `Stored history mixes schema versions ${schemaVersions.join(', ')}. ${pluralize(legacyDayCount, 'day')} are older than the current schema v${PERFORMANCE_SCHEMA_VERSION}.`,
  });
  overallStatus = maxStatus(overallStatus, schemaStatus);

  const recentDays = [...data.dailySummaries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
  const recentTripRuntimeDays = recentDays.filter(
    day => (day.tripStopSegmentRuntimes?.entries.length ?? 0) > 0,
  ).length;
  const tripRuntimeStatus: ImportHealthStatus =
    recentDays.length === 0
      ? 'critical'
      : recentTripRuntimeDays === recentDays.length
        ? 'healthy'
        : recentTripRuntimeDays === 0
          ? 'warning'
          : 'warning';
  checks.push({
    id: 'trip-linked-runtimes',
    label: 'Trip-linked stop runtimes',
    status: tripRuntimeStatus,
    summary: recentDays.length === 0
      ? 'No stored days are available to check trip-linked stop runtimes.'
      : recentTripRuntimeDays === recentDays.length
        ? `All of the last ${pluralize(recentDays.length, 'day')} include trip-linked stop runtimes.`
        : recentTripRuntimeDays === 0
          ? `None of the last ${pluralize(recentDays.length, 'day')} include trip-linked stop runtimes, so stop-order resolution and strict Step 2 checks will be limited.`
          : `Only ${recentTripRuntimeDays} of the last ${recentDays.length} days include trip-linked stop runtimes, so some routes may have weak stop-order evidence.`,
  });
  overallStatus = maxStatus(overallStatus, tripRuntimeStatus);

  const headline = overallStatus === 'healthy'
    ? 'Imports look healthy'
    : overallStatus === 'warning'
      ? 'Imports need attention'
      : 'Imports look broken or stale';

  const summary = overallStatus === 'healthy'
    ? 'The latest import, service dates, and runtime history all look current enough to trust the dashboard.'
    : overallStatus === 'warning'
      ? 'The dashboard still has data, but some parts of the import history are stale or only partially upgraded.'
      : 'The dashboard data is stale enough that the daily import may have stopped or the retained history is badly out of date.';

  return {
    overallStatus,
    headline,
    summary,
    latestImportAt,
    latestServiceDate,
    checks,
  };
}

export function buildPerformanceMetadataHealth(
  metadata: PerformanceMetadata | null | undefined,
  options: BuildImportHealthOptions = {},
): PerformanceMetadataHealth | null {
  if (!metadata) return null;

  const now = options.now ?? new Date();
  let status: ImportHealthStatus = 'healthy';

  const latestImportAt = metadata.importedAt;
  const latestServiceDate = metadata.dateRange?.end ?? null;

  const importedAtDate = latestImportAt ? new Date(latestImportAt) : null;
  if (!importedAtDate || Number.isNaN(importedAtDate.getTime())) {
    status = 'critical';
  } else {
    const hoursOld = diffHours(now, importedAtDate);
    if (hoursOld > 72) status = maxStatus(status, 'critical');
    else if (hoursOld > 36) status = maxStatus(status, 'warning');
  }

  const dayGap = latestServiceDate ? diffCalendarDays(now, latestServiceDate) : null;
  if (dayGap === null) {
    status = maxStatus(status, 'critical');
  } else if (dayGap > 3) {
    status = maxStatus(status, 'critical');
  } else if (dayGap > 1) {
    status = maxStatus(status, 'warning');
  }

  const label = status === 'healthy'
    ? 'Import healthy'
    : status === 'warning'
      ? 'Import delayed'
      : 'Import stale';

  if (!latestImportAt || !latestServiceDate) {
    return {
      status,
      label,
      summary: 'Import metadata is incomplete, so Scheduler cannot confirm that the daily flow is current.',
    };
  }

  return {
    status,
    label,
    summary: `Last import ${formatAbsoluteDateTime(latestImportAt)} • latest service day ${formatAbsoluteDate(latestServiceDate)}`,
  };
}
