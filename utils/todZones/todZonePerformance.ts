import { getTodActivityValue, type TodActivityMetric } from '../todPickupAggregation';
import type { TodDailyKpiDataset, TodDailyKpiLocation } from '../todPickupTypes';
import {
    assignTodZoneMembership,
    filterByTodZone,
    normalizeTodZoneStopId,
    selectEffectiveTodZoneVersion,
} from './todZoneGeometry';
import type { TodZoneDefinition, TodZoneVersion } from './todZoneTypes';

export interface ClassifiedTodLocation extends TodDailyKpiLocation {
    date: string;
    versionId?: string;
    zoneCodes: string[];
    isConnectionStop: boolean;
    connectionZoneCodes: string[];
}

export interface ClassifiedTodReports {
    locations: ClassifiedTodLocation[];
    usedVersionIds: Set<string>;
    unversionedDates: string[];
}

export interface TodZoneTopStop extends TodDailyKpiLocation {
    value: number;
    isConnectionStop: boolean;
}

export interface TodZonePerformanceRow {
    code: string;
    label: string;
    color: string;
    pickups: number;
    dropoffs: number;
    activity: number;
    value: number;
    activityShare: number;
    activeStops: number;
    connectionValue: number;
    connectionShare: number;
    topStops: TodZoneTopStop[];
}

export interface TodUnassignedPerformance {
    pickups: number;
    dropoffs: number;
    activity: number;
    value: number;
    activityShare: number;
    activeStops: number;
    topStops: TodZoneTopStop[];
}

export interface TodZonePerformance {
    totalValue: number;
    rows: TodZonePerformanceRow[];
    unassigned: TodUnassignedPerformance;
}

export type TodTrendGrain = 'daily' | 'weekly';

export interface TodZoneTrendPoint {
    key: string;
    label: string;
    pickups: number;
    dropoffs: number;
    activity: number;
    value: number;
}

function membershipForLocation(
    location: TodDailyKpiLocation,
    version: TodZoneVersion | null,
    snapshots: Map<string, Map<string, TodZoneVersion['stopSnapshot'][number]>>,
): Pick<ClassifiedTodLocation, 'zoneCodes' | 'isConnectionStop' | 'connectionZoneCodes'> {
    if (!version) return { zoneCodes: [], isConnectionStop: false, connectionZoneCodes: [] };
    const normalizedId = normalizeTodZoneStopId(location.id);
    const snapshotStop = snapshots.get(version.id)?.get(normalizedId);
    if (snapshotStop) {
        return {
            zoneCodes: snapshotStop.zoneCodes,
            isConnectionStop: snapshotStop.isConnectionStop ?? false,
            connectionZoneCodes: snapshotStop.connectionZoneCodes ?? [],
        };
    }
    const membership = assignTodZoneMembership(
        location,
        version.definitions,
        version.polygons,
        version.overrides,
        version.connectionStops,
    );
    return {
        zoneCodes: membership.zoneCodes,
        isConnectionStop: membership.isConnectionStop,
        connectionZoneCodes: membership.connectionZoneCodes,
    };
}

export function classifyTodReports(
    reports: TodDailyKpiDataset[],
    versions: TodZoneVersion[],
): ClassifiedTodReports {
    const snapshots = new Map(versions.map(version => [
        version.id,
        new Map(version.stopSnapshot.map(stop => [normalizeTodZoneStopId(stop.stopId), stop])),
    ]));
    const usedVersionIds = new Set<string>();
    const unversionedDates = new Set<string>();
    const locations = reports.flatMap(report => {
        const version = selectEffectiveTodZoneVersion(versions, [report.date]);
        if (version) usedVersionIds.add(version.id);
        else unversionedDates.add(report.date);
        return report.locations.map(location => ({
            ...location,
            date: report.date,
            ...(version ? { versionId: version.id } : {}),
            ...membershipForLocation(location, version, snapshots),
        }));
    });
    return {
        locations,
        usedVersionIds,
        unversionedDates: [...unversionedDates].sort(),
    };
}

export function aggregateClassifiedTodLocations(
    locations: ClassifiedTodLocation[],
    zoneFilter: string,
): Array<TodDailyKpiLocation & Pick<ClassifiedTodLocation, 'zoneCodes' | 'isConnectionStop' | 'connectionZoneCodes'>> {
    const aggregates = new Map<string, {
        location: TodDailyKpiLocation;
        coordinateWeight: number;
        latWeightedSum: number;
        lonWeightedSum: number;
        zoneCodes: Set<string>;
        isConnectionStop: boolean;
        connectionZoneCodes: Set<string>;
    }>();
    locations.forEach(location => {
        if (!filterByTodZone(location.zoneCodes, zoneFilter)) return;
        const weight = Math.max(location.pickups + location.dropoffs, 1);
        const aggregate = aggregates.get(location.id);
        if (aggregate) {
            aggregate.location.name = location.name;
            aggregate.location.pickups += location.pickups;
            aggregate.location.dropoffs += location.dropoffs;
            aggregate.coordinateWeight += weight;
            aggregate.latWeightedSum += location.lat * weight;
            aggregate.lonWeightedSum += location.lon * weight;
            aggregate.isConnectionStop ||= location.isConnectionStop;
            location.connectionZoneCodes.forEach(code => aggregate.connectionZoneCodes.add(code));
            location.zoneCodes.forEach(code => aggregate.zoneCodes.add(code));
            return;
        }
        aggregates.set(location.id, {
            location: { ...location },
            coordinateWeight: weight,
            latWeightedSum: location.lat * weight,
            lonWeightedSum: location.lon * weight,
            zoneCodes: new Set(location.zoneCodes),
            isConnectionStop: location.isConnectionStop,
            connectionZoneCodes: new Set(location.connectionZoneCodes),
        });
    });
    return [...aggregates.values()].map(aggregate => ({
        ...aggregate.location,
        lat: aggregate.latWeightedSum / aggregate.coordinateWeight,
        lon: aggregate.lonWeightedSum / aggregate.coordinateWeight,
        zoneCodes: [...aggregate.zoneCodes].sort(),
        isConnectionStop: aggregate.isConnectionStop,
        connectionZoneCodes: [...aggregate.connectionZoneCodes].sort(),
    })).sort((a, b) => (
        (b.pickups + b.dropoffs) - (a.pickups + a.dropoffs)
        || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    ));
}

function aggregateTopStops(
    locations: ClassifiedTodLocation[],
    metric: TodActivityMetric,
    zoneCode?: string,
): TodZoneTopStop[] {
    const byStop = new Map<string, TodZoneTopStop>();
    locations.forEach(location => {
        const normalizedId = normalizeTodZoneStopId(location.id);
        const existing = byStop.get(normalizedId);
        const isConnectionStop = zoneCode
            ? location.connectionZoneCodes.includes(zoneCode)
            : location.isConnectionStop;
        if (existing) {
            existing.name = location.name;
            existing.pickups += location.pickups;
            existing.dropoffs += location.dropoffs;
            existing.isConnectionStop ||= isConnectionStop;
            existing.value = getTodActivityValue(existing, metric);
            return;
        }
        byStop.set(normalizedId, {
            ...location,
            value: getTodActivityValue(location, metric),
            isConnectionStop,
        });
    });
    return [...byStop.values()]
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
        .slice(0, 5);
}

export function buildTodZonePerformance(
    locations: ClassifiedTodLocation[],
    definitions: TodZoneDefinition[],
    metric: TodActivityMetric,
): TodZonePerformance {
    const totalValue = locations.reduce((sum, location) => sum + getTodActivityValue(location, metric), 0);
    const rows = definitions.filter(zone => zone.active).map(zone => {
        const zoneLocations = locations.filter(location => location.zoneCodes.includes(zone.code));
        const pickups = zoneLocations.reduce((sum, location) => sum + location.pickups, 0);
        const dropoffs = zoneLocations.reduce((sum, location) => sum + location.dropoffs, 0);
        const activity = pickups + dropoffs;
        const value = metric === 'pickups' ? pickups : metric === 'dropoffs' ? dropoffs : activity;
        const connectionValue = zoneLocations
            .filter(location => location.connectionZoneCodes.includes(zone.code))
            .reduce((sum, location) => sum + getTodActivityValue(location, metric), 0);
        return {
            code: zone.code,
            label: zone.label,
            color: zone.color,
            pickups,
            dropoffs,
            activity,
            value,
            activityShare: totalValue > 0 ? value / totalValue : 0,
            activeStops: new Set(zoneLocations.map(location => normalizeTodZoneStopId(location.id))).size,
            connectionValue,
            connectionShare: value > 0 ? connectionValue / value : 0,
            topStops: aggregateTopStops(zoneLocations, metric, zone.code),
        };
    }).sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));
    const unassignedLocations = locations.filter(location => location.zoneCodes.length === 0);
    const unassignedPickups = unassignedLocations.reduce((sum, location) => sum + location.pickups, 0);
    const unassignedDropoffs = unassignedLocations.reduce((sum, location) => sum + location.dropoffs, 0);
    const unassignedActivity = unassignedPickups + unassignedDropoffs;
    const unassignedValue = metric === 'pickups'
        ? unassignedPickups
        : metric === 'dropoffs' ? unassignedDropoffs : unassignedActivity;
    return {
        totalValue,
        rows,
        unassigned: {
            pickups: unassignedPickups,
            dropoffs: unassignedDropoffs,
            activity: unassignedActivity,
            value: unassignedValue,
            activityShare: totalValue > 0 ? unassignedValue / totalValue : 0,
            activeStops: new Set(unassignedLocations.map(location => normalizeTodZoneStopId(location.id))).size,
            topStops: aggregateTopStops(unassignedLocations, metric),
        },
    };
}

function weekKey(date: string): string {
    const value = new Date(`${date}T12:00:00Z`);
    const day = value.getUTCDay();
    value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
    return value.toISOString().slice(0, 10);
}

function trendLabel(key: string, grain: TodTrendGrain): string {
    const label = new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    });
    return grain === 'weekly' ? `Week of ${label}` : label;
}

export function buildTodZoneTrend(
    locations: ClassifiedTodLocation[],
    dates: string[],
    zoneCode: string,
    metric: TodActivityMetric,
    grain: TodTrendGrain,
): TodZoneTrendPoint[] {
    const keys = [...new Set(dates)].sort().map(date => grain === 'weekly' ? weekKey(date) : date);
    const byKey = new Map<string, TodZoneTrendPoint>();
    [...new Set(keys)].forEach(key => byKey.set(key, {
        key,
        label: trendLabel(key, grain),
        pickups: 0,
        dropoffs: 0,
        activity: 0,
        value: 0,
    }));
    locations.forEach(location => {
        const matches = zoneCode === 'unassigned'
            ? location.zoneCodes.length === 0
            : location.zoneCodes.includes(zoneCode);
        if (!matches) return;
        const key = grain === 'weekly' ? weekKey(location.date) : location.date;
        const point = byKey.get(key);
        if (!point) return;
        point.pickups += location.pickups;
        point.dropoffs += location.dropoffs;
        point.activity += location.pickups + location.dropoffs;
        point.value += getTodActivityValue(location, metric);
    });
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
