import type { MasterScheduleContent } from '../masterScheduleTypes';

export type DetectedCycleMode = 'Strict' | 'Floating';

export interface MasterCycleModeDetection {
    cycleMode: DetectedCycleMode;
    source: 'metadata' | 'heuristic';
    confidence: 'high' | 'medium' | 'low';
    summary: string;
}

interface BandStats {
    bandId: string;
    tripCount: number;
    serviceShare: number;
    blockCount: number;
    medianTravelTime: number;
    medianCycleTime: number;
    medianRecoveryTime: number;
    medianRecoveryRatio: number;
}

const MIN_SIGNIFICANT_BAND_TRIPS = 4;
const MIN_SIGNIFICANT_BAND_SHARE = 0.15;
const FLOATING_TRAVEL_SPREAD_MINUTES = 6;
const FLOATING_TRAVEL_SPREAD_RATIO = 0.12;
const STRICT_TRAVEL_STABILITY_MINUTES = 4;
const STRICT_TRAVEL_STABILITY_RATIO = 0.08;
const RECOVERY_DOMINANT_CYCLE_SPREAD = 10;
const RECOVERY_DOMINANT_RECOVERY_SPREAD = 8;

const getMedian = (values: number[]): number => {
    const ordered = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 0
        ? (ordered[midpoint - 1] + ordered[midpoint]) / 2
        : ordered[midpoint];
};

const buildBandStats = (content: MasterScheduleContent): BandStats[] => {
    const allTrips = [
        ...content.northTable?.trips ?? [],
        ...content.southTable?.trips ?? [],
    ].filter((trip) => Number.isFinite(trip.cycleTime) && trip.cycleTime > 0);

    const totalTrips = allTrips.length;
    if (totalTrips === 0) return [];

    const grouped = new Map<string, typeof allTrips>();
    allTrips.forEach((trip) => {
        if (!trip.assignedBand) return;
        const existing = grouped.get(trip.assignedBand) || [];
        existing.push(trip);
        grouped.set(trip.assignedBand, existing);
    });

    return Array.from(grouped.entries())
        .map(([bandId, trips]) => {
            const travelTimes = trips
                .map(trip => trip.travelTime)
                .filter(value => Number.isFinite(value) && value > 0);
            const cycleTimes = trips
                .map(trip => trip.cycleTime)
                .filter(value => Number.isFinite(value) && value > 0);
            const recoveryTimes = trips
                .map(trip => trip.recoveryTime)
                .filter(value => Number.isFinite(value) && value >= 0);
            const recoveryRatios = trips
                .map(trip => trip.travelTime > 0 ? (trip.recoveryTime / trip.travelTime) * 100 : null)
                .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);

            return {
                bandId,
                tripCount: trips.length,
                serviceShare: trips.length / totalTrips,
                blockCount: new Set(trips.map(trip => trip.blockId).filter(Boolean)).size,
                medianTravelTime: travelTimes.length > 0 ? getMedian(travelTimes) : 0,
                medianCycleTime: cycleTimes.length > 0 ? getMedian(cycleTimes) : 0,
                medianRecoveryTime: recoveryTimes.length > 0 ? getMedian(recoveryTimes) : 0,
                medianRecoveryRatio: recoveryRatios.length > 0 ? getMedian(recoveryRatios) : 0,
            } satisfies BandStats;
        })
        .filter(stats => stats.tripCount > 0)
        .sort((a, b) => a.bandId.localeCompare(b.bandId));
};

const getSpread = (values: number[]): number => (
    values.length > 1 ? Math.max(...values) - Math.min(...values) : 0
);

const isSignificantBand = (band: BandStats): boolean => (
    band.tripCount >= MIN_SIGNIFICANT_BAND_TRIPS
    || band.serviceShare >= MIN_SIGNIFICANT_BAND_SHARE
);

const formatBands = (bands: BandStats[]): string => bands.map(band => band.bandId).join(', ');

export const detectMasterCycleMode = (content: MasterScheduleContent): MasterCycleModeDetection => {
    const explicitMode = content.metadata?.cycleMode;
    if (explicitMode === 'Strict' || explicitMode === 'Floating') {
        return {
            cycleMode: explicitMode,
            source: 'metadata',
            confidence: 'high',
            summary: `Saved from master as ${explicitMode.toLowerCase()}.`,
        };
    }

    const allTrips = [
        ...content.northTable?.trips ?? [],
        ...content.southTable?.trips ?? [],
    ].filter((trip) => Number.isFinite(trip.cycleTime) && trip.cycleTime > 0);

    if (allTrips.length === 0) {
        return {
            cycleMode: 'Strict',
            source: 'heuristic',
            confidence: 'low',
            summary: 'No usable master trip timings were found, so Step 3 defaulted to strict.',
        };
    }

    const allCycleTimes = allTrips.map(trip => trip.cycleTime);
    const allTravelTimes = allTrips
        .map(trip => trip.travelTime)
        .filter(value => Number.isFinite(value) && value > 0);
    const overallMedianCycle = getMedian(allCycleTimes);
    const overallMedianTravel = allTravelTimes.length > 0 ? getMedian(allTravelTimes) : 0;

    const bandStats = buildBandStats(content);
    const significantBands = bandStats.filter(isSignificantBand);
    const coreBands = significantBands.length >= 2 ? significantBands : bandStats;

    if (coreBands.length >= 2) {
        const travelSpread = getSpread(coreBands.map(band => band.medianTravelTime));
        const cycleSpread = getSpread(coreBands.map(band => band.medianCycleTime));
        const recoverySpread = getSpread(coreBands.map(band => band.medianRecoveryTime));
        const recoveryRatioSpread = getSpread(coreBands.map(band => band.medianRecoveryRatio));
        const blockCountSpread = getSpread(coreBands.map(band => band.blockCount));
        const medianTravelBase = Math.max(1, getMedian(coreBands.map(band => band.medianTravelTime).filter(value => value > 0)));
        const travelSpreadRatio = travelSpread / medianTravelBase;
        const hasMeaningfulTravelVariation = (
            travelSpread >= FLOATING_TRAVEL_SPREAD_MINUTES
            && travelSpreadRatio >= FLOATING_TRAVEL_SPREAD_RATIO
        );
        const travelIsStable = (
            travelSpread <= STRICT_TRAVEL_STABILITY_MINUTES
            || travelSpreadRatio <= STRICT_TRAVEL_STABILITY_RATIO
        );
        const recoveryDominates = (
            cycleSpread >= RECOVERY_DOMINANT_CYCLE_SPREAD
            && travelIsStable
            && (recoverySpread >= RECOVERY_DOMINANT_RECOVERY_SPREAD || recoveryRatioSpread >= 12 || blockCountSpread >= 1)
        );

        if (recoveryDominates) {
            return {
                cycleMode: 'Strict',
                source: 'heuristic',
                confidence: significantBands.length >= 2 ? 'high' : 'medium',
                summary: `Detected as strict because travel times stay steady across ${formatBands(coreBands)} while the cycle spread is driven mainly by recovery/off-peak block changes.`,
            };
        }

        if (hasMeaningfulTravelVariation) {
            return {
                cycleMode: 'Floating',
                source: 'heuristic',
                confidence: significantBands.length >= 2 ? 'high' : 'medium',
                summary: `Detected as floating because substantial service bands (${formatBands(coreBands)}) show real travel-time variation (${Math.round(travelSpread)} min spread) beyond off-peak recovery changes.`,
            };
        }

        if (travelIsStable && cycleSpread <= 8) {
            return {
                cycleMode: 'Strict',
                source: 'heuristic',
                confidence: 'medium',
                summary: 'Detected as strict because substantial service bands keep similar travel and cycle times.',
            };
        }
    }

    const cycleSpread = getSpread(allCycleTimes);
    const travelSpread = getSpread(allTravelTimes);
    const distinctRoundedCycles = new Set(allCycleTimes.map(value => Math.round(value)));
    const withinThreeMinutesRatio = allCycleTimes.filter(value => Math.abs(value - overallMedianCycle) <= 3).length / allCycleTimes.length;

    if (travelSpread <= STRICT_TRAVEL_STABILITY_MINUTES && cycleSpread >= RECOVERY_DOMINANT_CYCLE_SPREAD) {
        return {
            cycleMode: 'Strict',
            source: 'heuristic',
            confidence: 'medium',
            summary: 'Detected as strict because cycle variation appears to come from added layover, not changing travel times.',
        };
    }

    if (withinThreeMinutesRatio >= 0.8 && cycleSpread <= 6) {
        return {
            cycleMode: 'Strict',
            source: 'heuristic',
            confidence: 'medium',
            summary: `Detected as strict because most trips cluster around one cycle time (~${Math.round(overallMedianCycle)} min).`,
        };
    }

    if (
        travelSpread >= FLOATING_TRAVEL_SPREAD_MINUTES
        && overallMedianTravel > 0
        && (travelSpread / overallMedianTravel) >= FLOATING_TRAVEL_SPREAD_RATIO
        && distinctRoundedCycles.size >= 4
    ) {
        return {
            cycleMode: 'Floating',
            source: 'heuristic',
            confidence: 'low',
            summary: `Detected as floating because travel times still vary materially across the schedule (${Math.round(travelSpread)} min spread).`,
        };
    }

    return {
        cycleMode: 'Strict',
        source: 'heuristic',
        confidence: 'low',
        summary: `Master timing pattern was mixed, so Step 3 defaulted to strict around ~${Math.round(overallMedianCycle)} min.`,
    };
};
