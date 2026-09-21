import {
  SPECIALIZED_TRANSIT_SCHEMA_VERSION,
  type SpecializedTransitDatasetV1,
} from './types';

const DATASET_KEYS = ['schemaVersion', 'revision', 'updatedAt', 'updatedBy', 'months', 'locations'] as const;
const MONTH_KEYS = [
  'reportMonth',
  'reportedTrips',
  'priorYearPercent',
  'commonLocationBookings',
  'commonLocationCoverage',
  'reconciliationGap',
  'reconciliationStatus',
  'reconciliationNote',
  'serviceDateRange',
  'dailyTotals',
  'hourlyTotals',
  'activityBuckets',
  'recurringDemand',
  'sources',
  'importedAt',
  'importedBy',
] as const;
const LOCATION_KEYS = [
  'id',
  'displayName',
  'normalizedName',
  'aliases',
  'latitude',
  'longitude',
  'status',
  'coordinateSource',
  'relevance',
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function stringValue(value: unknown, label: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`${label} is invalid.`);
  return value as number;
}

function finite(value: unknown, label: string, minimum?: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  if (minimum !== undefined && value < minimum) throw new Error(`${label} is invalid.`);
  if (maximum !== undefined && value > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function nullableFinite(value: unknown, label: string, minimum?: number, maximum?: number): number | null {
  return value === null ? null : finite(value, label, minimum, maximum);
}

function isoDate(value: unknown, label: string): string {
  const normalized = stringValue(value, label, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function isoTimestamp(value: unknown, label: string): string {
  const normalized = stringValue(value, label, 64);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${label} is invalid.`);
  return normalized;
}

function safeId(value: unknown, label: string): string {
  const normalized = stringValue(value, label, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function countMap(value: unknown, label: string, keyPattern: RegExp): void {
  const values = record(value, label);
  for (const [key, count] of Object.entries(values)) {
    if (!keyPattern.test(key)) throw new Error(`${label} contains an invalid key.`);
    integer(count, `${label} count`);
  }
}

function assertSource(value: unknown, label: string): void {
  const source = record(value, label);
  assertKeys(source, ['sha256', 'pageCount'], label);
  const sha256 = stringValue(source.sha256, `${label} hash`, 64);
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error(`${label} hash is invalid.`);
  const pageCount = integer(source.pageCount, `${label} page count`, 1);
  if (pageCount > 1000) throw new Error(`${label} page count is invalid.`);
}

function assertMonth(monthKey: string, value: unknown): void {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error('Specialized Transit month key is invalid.');
  const month = record(value, `Specialized Transit month ${monthKey}`);
  assertKeys(month, MONTH_KEYS, `Specialized Transit month ${monthKey}`);
  if (month.reportMonth !== monthKey) throw new Error('Specialized Transit report month is invalid.');
  integer(month.reportedTrips, 'Reported trips');
  nullableFinite(month.priorYearPercent, 'Prior-year percentage', 0, 999);
  integer(month.commonLocationBookings, 'Common-location bookings');
  finite(month.commonLocationCoverage, 'Common-location coverage', 0, 1);
  integer(month.reconciliationGap, 'Reconciliation gap');
  if (!['reconciled', 'partial-common-location', 'inconsistent'].includes(String(month.reconciliationStatus))) {
    throw new Error('Reconciliation status is invalid.');
  }
  if (typeof month.reconciliationNote !== 'string' || month.reconciliationNote.length > 2000) {
    throw new Error('Reconciliation note is invalid.');
  }

  const dateRange = record(month.serviceDateRange, 'Service date range');
  assertKeys(dateRange, ['start', 'end'], 'Service date range');
  const start = isoDate(dateRange.start, 'Service date range start');
  const end = isoDate(dateRange.end, 'Service date range end');
  if (start > end || !start.startsWith(`${monthKey}-`) || !end.startsWith(`${monthKey}-`)) {
    throw new Error('Service date range is invalid.');
  }

  countMap(month.dailyTotals, 'Daily totals', /^20\d{2}-\d{2}-\d{2}$/);
  countMap(month.hourlyTotals, 'Hourly totals', /^(?:[0-9]|1[0-9]|2[0-3])$/);
  if (!Array.isArray(month.activityBuckets)) throw new Error('Activity buckets are invalid.');
  for (const bucketValue of month.activityBuckets) {
    const bucket = record(bucketValue, 'Activity bucket');
    assertKeys(bucket, ['date', 'hour', 'locationId', 'pickups', 'dropoffs'], 'Activity bucket');
    const date = isoDate(bucket.date, 'Activity bucket date');
    if (!date.startsWith(`${monthKey}-`)) throw new Error('Activity bucket date is invalid.');
    const hour = integer(bucket.hour, 'Activity bucket hour');
    if (hour > 23) throw new Error('Activity bucket hour is invalid.');
    safeId(bucket.locationId, 'Activity bucket location');
    integer(bucket.pickups, 'Activity bucket pickups');
    integer(bucket.dropoffs, 'Activity bucket dropoffs');
  }

  const recurring = record(month.recurringDemand, 'Recurring demand');
  assertKeys(recurring, ['distinctClientIds', 'medianBookingsPerClient', 'thresholds'], 'Recurring demand');
  integer(recurring.distinctClientIds, 'Distinct client count');
  finite(recurring.medianBookingsPerClient, 'Median bookings per client', 0);
  if (!Array.isArray(recurring.thresholds)) throw new Error('Recurring-demand thresholds are invalid.');
  for (const thresholdValue of recurring.thresholds) {
    const threshold = record(thresholdValue, 'Recurring-demand threshold');
    assertKeys(threshold, ['minimumBookings', 'clientCount', 'bookingCount', 'bookingShare'], 'Recurring-demand threshold');
    integer(threshold.minimumBookings, 'Minimum bookings', 1);
    integer(threshold.clientCount, 'Threshold client count');
    integer(threshold.bookingCount, 'Threshold booking count');
    finite(threshold.bookingShare, 'Threshold booking share', 0, 1);
  }

  const sources = record(month.sources, 'Specialized Transit sources');
  assertKeys(sources, ['monthlyReport', 'commonLocationsReport'], 'Specialized Transit sources');
  assertSource(sources.monthlyReport, 'Monthly report source');
  assertSource(sources.commonLocationsReport, 'Common-locations report source');
  isoTimestamp(month.importedAt, 'Imported timestamp');
  safeId(month.importedBy, 'Importer');
}

function assertLocation(locationKey: string, value: unknown): void {
  const location = record(value, `Specialized Transit location ${locationKey}`);
  assertKeys(location, LOCATION_KEYS, `Specialized Transit location ${locationKey}`);
  if (safeId(location.id, 'Location ID') !== locationKey) throw new Error('Specialized Transit location ID is invalid.');
  stringValue(location.displayName, 'Location display name');
  stringValue(location.normalizedName, 'Normalized location name');
  if (!Array.isArray(location.aliases) || location.aliases.length > 1000) throw new Error('Location aliases are invalid.');
  for (const alias of location.aliases) stringValue(alias, 'Location alias');

  const latitude = nullableFinite(location.latitude, 'Location latitude', -90, 90);
  const longitude = nullableFinite(location.longitude, 'Location longitude', -180, 180);
  if ((latitude === null) !== (longitude === null)) throw new Error('Location coordinates are incomplete.');
  if (!['unmapped', 'automatic', 'reviewed'].includes(String(location.status))) throw new Error('Location status is invalid.');
  if (location.coordinateSource !== null && !['gtfs-stop', 'known-place', 'mapbox', 'mapbox-permanent', 'manual'].includes(String(location.coordinateSource))) {
    throw new Error('Location coordinate source is invalid.');
  }
  nullableFinite(location.relevance, 'Location relevance');
}

export function assertSafeSpecializedTransitSegment(value: string, label: string): string {
  return safeId(value, label);
}

export function isSpecializedTransitStoragePath(teamId: string, path: string): boolean {
  const prefix = `teams/${teamId}/specializedTransitData/`;
  return path.startsWith(prefix)
    && !path.includes('..')
    && /^revision-[1-9]\d{0,6}-[A-Za-z0-9-]+[.]json$/.test(path.slice(prefix.length));
}

export function parseSpecializedTransitDataset(value: unknown): SpecializedTransitDatasetV1 {
  const dataset = record(value, 'Stored Specialized Transit data');
  assertKeys(dataset, DATASET_KEYS, 'Stored Specialized Transit data');
  if (dataset.schemaVersion !== SPECIALIZED_TRANSIT_SCHEMA_VERSION) throw new Error('Stored Specialized Transit schema is invalid.');
  integer(dataset.revision, 'Specialized Transit revision', 1);
  isoTimestamp(dataset.updatedAt, 'Specialized Transit update timestamp');
  safeId(dataset.updatedBy, 'Specialized Transit updater');

  const months = record(dataset.months, 'Specialized Transit months');
  const locations = record(dataset.locations, 'Specialized Transit locations');
  for (const [monthKey, month] of Object.entries(months)) assertMonth(monthKey, month);
  for (const [locationKey, location] of Object.entries(locations)) assertLocation(locationKey, location);
  return dataset as unknown as SpecializedTransitDatasetV1;
}
