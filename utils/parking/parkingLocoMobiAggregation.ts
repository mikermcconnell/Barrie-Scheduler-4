import {
  type ParkingLocoMobiAggregateValues,
  type ParkingLocoMobiDomainAggregate,
  type ParkingLocoMobiHistoryRow,
  type ParkingLocoMobiHistorySnapshot,
  type ParkingLocoMobiHourlyAggregate,
  type ParkingLocoMobiLocationAggregate,
  type ParkingLocoMobiLocationMonthAggregate,
  type ParkingLocoMobiMonthlyAggregate,
  type ParkingLocoMobiParseResult,
  type ParkingLocoMobiPaymentAggregate,
  type ParkingLocoMobiPaymentChannel,
  type ParkingLocoMobiWeekdayAggregate,
} from './parkingLocoMobiTypes';

interface AggregateAccumulator extends ParkingLocoMobiAggregateValues {
  totalReportedAmount: number;
}

interface MonthlyAccumulator extends AggregateAccumulator {
  dates: Set<string>;
  meters: Set<string>;
  locations: Set<string>;
}

interface LocationAccumulator extends AggregateAccumulator {
  meterId: string;
  locationLabel: string;
  domain: string;
  dates: Set<string>;
  paymentChannels: Set<ParkingLocoMobiPaymentChannel>;
}

interface DomainAccumulator extends AggregateAccumulator {
  meters: Set<string>;
  locations: Set<string>;
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function emptyAccumulator(): AggregateAccumulator {
  return {
    rowCount: 0,
    totalReportedAmount: 0,
    zeroAmountRowCount: 0,
    negativeAmountRowCount: 0,
  };
}

function addRow(accumulator: AggregateAccumulator, row: ParkingLocoMobiHistoryRow): void {
  accumulator.rowCount += 1;
  accumulator.totalReportedAmount += row.reportedAmount;
  if (row.qualityFlags.includes('zero_amount')) accumulator.zeroAmountRowCount += 1;
  if (row.qualityFlags.includes('negative_amount')) accumulator.negativeAmountRowCount += 1;
}

function finalizedValues(accumulator: AggregateAccumulator): ParkingLocoMobiAggregateValues {
  return {
    rowCount: accumulator.rowCount,
    totalReportedAmount: roundMoney(accumulator.totalReportedAmount),
    zeroAmountRowCount: accumulator.zeroAmountRowCount,
    negativeAmountRowCount: accumulator.negativeAmountRowCount,
  };
}

function locationKey(row: Pick<ParkingLocoMobiHistoryRow, 'domain' | 'meterId' | 'locationLabel'>): string {
  return `${row.domain}::${row.meterId}::${row.locationLabel}`;
}

function buildMonthly(rows: ParkingLocoMobiHistoryRow[]): ParkingLocoMobiMonthlyAggregate[] {
  const index = new Map<string, MonthlyAccumulator>();
  for (const row of rows) {
    const accumulator = index.get(row.activityMonth) ?? {
      ...emptyAccumulator(),
      dates: new Set<string>(),
      meters: new Set<string>(),
      locations: new Set<string>(),
    };
    addRow(accumulator, row);
    accumulator.dates.add(row.activityDate);
    accumulator.meters.add(row.meterId);
    accumulator.locations.add(locationKey(row));
    index.set(row.activityMonth, accumulator);
  }
  return [...index.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, accumulator]) => ({
      month,
      ...finalizedValues(accumulator),
      activeDateCount: accumulator.dates.size,
      activeMeterCount: accumulator.meters.size,
      activeLocationCount: accumulator.locations.size,
    }));
}

function buildLocations(rows: ParkingLocoMobiHistoryRow[]): ParkingLocoMobiLocationAggregate[] {
  const index = new Map<string, LocationAccumulator>();
  for (const row of rows) {
    const key = locationKey(row);
    const accumulator = index.get(key) ?? {
      ...emptyAccumulator(),
      meterId: row.meterId,
      locationLabel: row.locationLabel,
      domain: row.domain,
      dates: new Set<string>(),
      paymentChannels: new Set<ParkingLocoMobiPaymentChannel>(),
    };
    addRow(accumulator, row);
    accumulator.dates.add(row.activityDate);
    accumulator.paymentChannels.add(row.paymentChannel);
    index.set(key, accumulator);
  }
  return [...index.entries()]
    .map(([key, accumulator]) => {
      const dates = [...accumulator.dates].sort();
      return {
        key,
        meterId: accumulator.meterId,
        locationLabel: accumulator.locationLabel,
        domain: accumulator.domain,
        ...finalizedValues(accumulator),
        observedStartDate: dates[0],
        observedEndDate: dates[dates.length - 1],
        paymentChannels: [...accumulator.paymentChannels].sort(),
      };
    })
    .sort((left, right) => (
      right.totalReportedAmount - left.totalReportedAmount
      || left.locationLabel.localeCompare(right.locationLabel)
      || left.meterId.localeCompare(right.meterId)
    ));
}

function buildHourly(rows: ParkingLocoMobiHistoryRow[]): ParkingLocoMobiHourlyAggregate[] {
  const accumulators = Array.from({ length: 24 }, emptyAccumulator);
  for (const row of rows) addRow(accumulators[Math.floor(row.activityMinutes / 60)], row);
  return accumulators.map((accumulator, hour) => ({ hour, ...finalizedValues(accumulator) }));
}

function buildWeekdays(rows: ParkingLocoMobiHistoryRow[]): ParkingLocoMobiWeekdayAggregate[] {
  const accumulators = Array.from({ length: 7 }, emptyAccumulator);
  for (const row of rows) addRow(accumulators[row.weekday], row);
  return accumulators.map((accumulator, weekday) => ({
    weekday,
    label: WEEKDAY_LABELS[weekday],
    ...finalizedValues(accumulator),
  }));
}

function buildPaymentChannels(rows: ParkingLocoMobiHistoryRow[]): ParkingLocoMobiPaymentAggregate[] {
  const index = new Map<ParkingLocoMobiPaymentChannel, AggregateAccumulator & { label: string }>();
  for (const row of rows) {
    const accumulator = index.get(row.paymentChannel) ?? {
      ...emptyAccumulator(),
      label: row.paymentChannelLabel,
    };
    addRow(accumulator, row);
    index.set(row.paymentChannel, accumulator);
  }
  return [...index.entries()]
    .map(([paymentChannel, accumulator]) => ({
      paymentChannel,
      label: accumulator.label,
      ...finalizedValues(accumulator),
    }))
    .sort((left, right) => right.rowCount - left.rowCount || left.label.localeCompare(right.label));
}

function buildDomains(rows: ParkingLocoMobiHistoryRow[]): ParkingLocoMobiDomainAggregate[] {
  const index = new Map<string, DomainAccumulator>();
  for (const row of rows) {
    const accumulator = index.get(row.domain) ?? {
      ...emptyAccumulator(),
      meters: new Set<string>(),
      locations: new Set<string>(),
    };
    addRow(accumulator, row);
    accumulator.meters.add(row.meterId);
    accumulator.locations.add(locationKey(row));
    index.set(row.domain, accumulator);
  }
  return [...index.entries()]
    .map(([domain, accumulator]) => ({
      domain,
      ...finalizedValues(accumulator),
      activeMeterCount: accumulator.meters.size,
      activeLocationCount: accumulator.locations.size,
    }))
    .sort((left, right) => right.totalReportedAmount - left.totalReportedAmount || left.domain.localeCompare(right.domain));
}

export function buildParkingLocoMobiHistorySnapshot(
  parsed: ParkingLocoMobiParseResult,
): ParkingLocoMobiHistorySnapshot {
  return {
    schemaVersion: parsed.schemaVersion,
    vendor: parsed.vendor,
    financialBasis: parsed.financialBasis,
    coverage: { ...parsed.coverage, observedMonths: [...parsed.coverage.observedMonths], observedYears: [...parsed.coverage.observedYears] },
    reconciliation: { ...parsed.reconciliation },
    sourceTables: parsed.sourceTables.map(table => ({ ...table })),
    ignoredSheets: parsed.ignoredSheets.map(sheet => ({ ...sheet })),
    warnings: [...parsed.warnings],
    monthly: buildMonthly(parsed.rows),
    locations: buildLocations(parsed.rows),
    hourly: buildHourly(parsed.rows),
    weekdays: buildWeekdays(parsed.rows),
    paymentChannels: buildPaymentChannels(parsed.rows),
    domains: buildDomains(parsed.rows),
    locationMonths: buildLocationMonths(parsed.rows),
  };
}

function buildLocationMonths(rows: ParkingLocoMobiHistoryRow[]): ParkingLocoMobiLocationMonthAggregate[] {
  const index = new Map<string, ParkingLocoMobiLocationMonthAggregate>();
  for (const row of rows) {
    const key = JSON.stringify([row.activityMonth, row.domain, row.meterId, row.locationLabel]);
    const value = index.get(key) ?? {
      ...emptyAccumulator(), month: row.activityMonth, domain: row.domain,
      meterId: row.meterId, locationLabel: row.locationLabel, hourlyCounts: Array(24).fill(0),
    };
    addRow(value, row);
    value.hourlyCounts[Math.floor(row.activityMinutes / 60)] += 1;
    index.set(key, value);
  }
  return [...index.values()].map(value => ({ ...value, ...finalizedValues(value) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.domain.localeCompare(b.domain) || a.meterId.localeCompare(b.meterId) || a.locationLabel.localeCompare(b.locationLabel));
}
