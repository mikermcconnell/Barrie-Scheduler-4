import type {
    Step2CanonicalRouteSource,
    Step2PerformanceConfig,
    Step2PerformanceDiagnostics,
    Step2PlannerOverrides,
    Step2ReviewInput,
    Step2Direction,
} from './step2ReviewTypes';

interface NormalizedFingerprintPayload {
    routeIdentity: string;
    routeNumber: string;
    dayType: Step2ReviewInput['dayType'];
    importMode: Step2ReviewInput['importMode'];
    parsedDataFingerprint: string;
    performanceConfig?: Step2PerformanceConfig | null;
    performanceDiagnostics?: Step2PerformanceDiagnostics | null;
    canonicalRouteSource?: Step2CanonicalRouteSource | null;
    canonicalDirectionStops?: Partial<Record<Step2Direction, string[]>>;
    plannerOverrides: Step2PlannerOverrides;
}

const normalizeText = (value: string): string => value.trim();

const normalizeDateRange = (range: { start: string; end: string } | null | undefined) => (
    range
        ? {
            start: normalizeText(range.start),
            end: normalizeText(range.end),
        }
        : null
);

const normalizeExcludedBuckets = (buckets: string[]): string[] => (
    Array.from(new Set(buckets.map(normalizeText).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
);

const normalizeCanonicalDirectionStops = (
    stops: Step2ReviewInput['canonicalDirectionStops']
): Partial<Record<Step2Direction, string[]>> | undefined => {
    if (!stops) return undefined;

    const normalizedNorth = stops.North?.map(normalizeText).filter(Boolean) ?? [];
    const normalizedSouth = stops.South?.map(normalizeText).filter(Boolean) ?? [];

    const result: Partial<Record<Step2Direction, string[]>> = {};
    if (normalizedNorth.length > 0) {
        result.North = normalizedNorth;
    }
    if (normalizedSouth.length > 0) {
        result.South = normalizedSouth;
    }

    return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeFingerprintPayload = (input: Step2ReviewInput): NormalizedFingerprintPayload => ({
    routeIdentity: normalizeText(input.routeIdentity),
    routeNumber: normalizeText(input.routeNumber),
    dayType: input.dayType,
    importMode: input.importMode,
    parsedDataFingerprint: normalizeText(input.parsedDataFingerprint),
    performanceConfig: input.performanceConfig
        ? {
            routeId: normalizeText(input.performanceConfig.routeId),
            dateRange: normalizeDateRange(input.performanceConfig.dateRange),
        }
        : undefined,
    performanceDiagnostics: input.performanceDiagnostics
        ? {
            routeId: normalizeText(input.performanceDiagnostics.routeId),
            dateRange: normalizeDateRange(input.performanceDiagnostics.dateRange),
            runtimeLogicVersion: input.performanceDiagnostics.runtimeLogicVersion,
            importedAt: input.performanceDiagnostics.importedAt?.trim(),
            stopOrderDecision: input.performanceDiagnostics.stopOrderDecision,
            stopOrderConfidence: input.performanceDiagnostics.stopOrderConfidence,
            stopOrderSource: input.performanceDiagnostics.stopOrderSource,
        }
        : undefined,
    canonicalRouteSource: input.canonicalRouteSource
        ? {
            type: input.canonicalRouteSource.type,
            routeIdentity: input.canonicalRouteSource.routeIdentity?.trim(),
            versionHint: input.canonicalRouteSource.versionHint?.trim(),
        }
        : undefined,
    canonicalDirectionStops: normalizeCanonicalDirectionStops(input.canonicalDirectionStops),
    plannerOverrides: {
        excludedBuckets: normalizeExcludedBuckets(input.plannerOverrides.excludedBuckets),
    },
});

export const buildStep2ReviewFingerprint = (input: Step2ReviewInput): string => {
    const payload = normalizeFingerprintPayload(input);
    return `step2-review:v1:${JSON.stringify(payload)}`;
};

export const areStep2ReviewFingerprintsEqual = (
    left: Step2ReviewInput,
    right: Step2ReviewInput
): boolean => (
    buildStep2ReviewFingerprint(left) === buildStep2ReviewFingerprint(right)
);
