export const SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT = 999;

const STORAGE_KEY = 'scheduler4:specialized-transit:mapbox-permanent-usage:v1';

export interface SpecializedTransitPermanentGeocodingUsage {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  trackingAvailable: boolean;
}

interface StoredUsage {
  month: string;
  used: number;
}

type BudgetStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class SpecializedTransitGeocodingBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecializedTransitGeocodingBudgetError';
  }
}

function currentMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function browserStorage(storage?: BudgetStorage): BudgetStorage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readUsage(storage: BudgetStorage, month: string): number {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Partial<StoredUsage>;
    if (parsed.month !== month) return 0;
    if (!Number.isInteger(parsed.used) || Number(parsed.used) < 0) {
      throw new SpecializedTransitGeocodingBudgetError('The Permanent Geocoding usage counter is invalid.');
    }
    return Math.min(Number(parsed.used), SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT);
  } catch (cause) {
    if (cause instanceof SpecializedTransitGeocodingBudgetError) throw cause;
    throw new SpecializedTransitGeocodingBudgetError('The Permanent Geocoding usage counter could not be read.');
  }
}

export function getSpecializedTransitPermanentGeocodingUsage(
  options: { storage?: BudgetStorage; now?: Date } = {},
): SpecializedTransitPermanentGeocodingUsage {
  const month = currentMonth(options.now ?? new Date());
  const storage = browserStorage(options.storage);
  if (!storage) {
    return {
      month,
      used: 0,
      limit: SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT,
      remaining: 0,
      trackingAvailable: false,
    };
  }
  try {
    const used = readUsage(storage, month);
    return {
      month,
      used,
      limit: SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT,
      remaining: SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT - used,
      trackingAvailable: true,
    };
  } catch {
    return {
      month,
      used: SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT,
      limit: SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT,
      remaining: 0,
      trackingAvailable: false,
    };
  }
}

export function claimSpecializedTransitPermanentGeocodingRequest(
  options: { storage?: BudgetStorage; now?: Date } = {},
): SpecializedTransitPermanentGeocodingUsage {
  const month = currentMonth(options.now ?? new Date());
  const storage = browserStorage(options.storage);
  if (!storage) {
    throw new SpecializedTransitGeocodingBudgetError(
      'Permanent Geocoding is blocked because this browser cannot track the monthly request limit.',
    );
  }
  const used = readUsage(storage, month);
  if (used >= SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT) {
    throw new SpecializedTransitGeocodingBudgetError(
      `The ${SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT}-request Permanent Geocoding limit has been reached for ${month}.`,
    );
  }
  const nextUsed = used + 1;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ month, used: nextUsed } satisfies StoredUsage));
  } catch {
    throw new SpecializedTransitGeocodingBudgetError(
      'Permanent Geocoding is blocked because this browser could not update the monthly request counter.',
    );
  }
  return {
    month,
    used: nextUsed,
    limit: SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT,
    remaining: SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT - nextUsed,
    trackingAvailable: true,
  };
}
