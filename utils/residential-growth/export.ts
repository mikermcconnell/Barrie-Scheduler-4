import type { ResidentialGrowthLayer, ResidentialGrowthRecord } from './types';

const DEFAULT_STYLE = 'mapbox/streets-v12';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 840;
const DEFAULT_PADDING = 70;
const DEFAULT_MAX_POINTS = 120;
const TILE_SIZE = 512;
const MIN_ZOOM = 9;
const MAX_ZOOM = 15;

export interface ResidentialGrowthExportPoint {
    lon: number;
    lat: number;
    units: number;
    recordCount: number;
    label: string;
}

export interface ResidentialGrowthExportCamera {
    longitude: number;
    latitude: number;
    zoom: number;
}

export interface ResidentialGrowthStaticMapUrlOptions {
    records: ResidentialGrowthRecord[];
    layer: ResidentialGrowthLayer;
    mapboxToken: string | undefined;
    width?: number;
    height?: number;
    padding?: number;
    maxPoints?: number;
    style?: string;
}

export interface ResidentialGrowthBaseMapUrlOptions {
    camera: ResidentialGrowthExportCamera;
    mapboxToken: string | undefined;
    width?: number;
    height?: number;
    style?: string;
}

export interface ResidentialGrowthExportLayerSummary {
    layer: ResidentialGrowthLayer;
    title: string;
    metricLabel: string;
    records: ResidentialGrowthRecord[];
}

export interface ResidentialGrowthExportMarker {
    x: number;
    y: number;
    units: number;
    recordCount: number;
    clustered: boolean;
}

export type ResidentialGrowthTopSiteIconType = 'house' | 'apartment';

export type ResidentialGrowthExportAccuracyFilter = 'all' | 'exact' | 'approximate';

export interface ResidentialGrowthExportSummaryLineOptions {
    rangeLabel: string;
    periodCount: number;
    subtypeFilter: string;
    searchText: string;
    dateFrom: string;
    dateTo: string;
    accuracyFilter: ResidentialGrowthExportAccuracyFilter;
}

export interface ResidentialGrowthExportSummaryLines {
    primary: string;
    details: string[];
}

function coordinateKey(record: ResidentialGrowthRecord): string {
    if (!record.geocode) return '';
    return `${record.geocode.lon.toFixed(6)},${record.geocode.lat.toFixed(6)}`;
}

function compactLocationLabel(record: ResidentialGrowthRecord): string {
    return (record.geocode?.displayName || record.address).split(',')[0]?.trim() || record.address;
}

function formatCoordinate(value: number): string {
    return Number(value.toFixed(6)).toString();
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function interpolate(value: number, stops: Array<[number, number]>): number {
    if (value <= stops[0][0]) return stops[0][1];
    for (let index = 1; index < stops.length; index += 1) {
        const [stopValue, stopResult] = stops[index];
        const [previousValue, previousResult] = stops[index - 1];
        if (value <= stopValue) {
            const progress = (value - previousValue) / (stopValue - previousValue);
            return previousResult + (stopResult - previousResult) * progress;
        }
    }
    return stops.at(-1)![1];
}

function projectNormalized(lon: number, lat: number): { x: number; y: number } {
    const sin = clamp(Math.sin((lat * Math.PI) / 180), -0.9999, 0.9999);
    return {
        x: (lon + 180) / 360,
        y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
    };
}

function unprojectNormalized(x: number, y: number): { lon: number; lat: number } {
    return {
        lon: x * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
    };
}

export function getResidentialGrowthExportPoints(
    records: ResidentialGrowthRecord[],
    maxPoints = DEFAULT_MAX_POINTS,
): ResidentialGrowthExportPoint[] {
    const grouped = new Map<string, ResidentialGrowthRecord[]>();
    records.forEach((record) => {
        if (!record.geocode) return;
        const key = coordinateKey(record);
        grouped.set(key, [...(grouped.get(key) ?? []), record]);
    });

    return Array.from(grouped.values())
        .map((group) => {
            const first = group[0];
            return {
                lon: first.geocode!.lon,
                lat: first.geocode!.lat,
                units: group.reduce((sum, record) => sum + record.units, 0),
                recordCount: group.length,
                label: group.length > 1 ? `${group.length} records near ${compactLocationLabel(first)}` : compactLocationLabel(first),
            };
        })
        .sort((a, b) => b.units - a.units || b.recordCount - a.recordCount || a.label.localeCompare(b.label))
        .slice(0, maxPoints);
}

export function getResidentialGrowthUnitCircleStyle(units: number): { color: string; radius: number } {
    return getResidentialGrowthMapCircleStyle(units, false);
}

export function getResidentialGrowthMapCircleStyle(units: number, clustered = false): { color: string; radius: number } {
    const colorStops: Array<[number, string]> = [
        [1, '#16a34a'],
        [10, '#84cc16'],
        [25, '#eab308'],
        [75, '#f97316'],
        [125, '#dc2626'],
    ];
    const color = colorStops.find(([stop]) => units <= stop)?.[1] ?? colorStops.at(-1)![1];
    const radiusStops: Array<[number, number]> = clustered
        ? [
            [1, 16],
            [25, 22],
            [75, 30],
            [125, 38],
        ]
        : [
            [1, 7],
            [10, 12],
            [50, 20],
            [125, 30],
        ];
    return {
        color,
        radius: Math.round(interpolate(units, radiusStops)),
    };
}

export function getResidentialGrowthUnitLabel(units: number): string {
    if (units >= 1000) return `${Math.round(units / 1000)}k`;
    return Math.max(0, Math.round(units)).toLocaleString();
}

export function getResidentialGrowthTopSiteIconType(units: number): ResidentialGrowthTopSiteIconType {
    return units <= 3 ? 'house' : 'apartment';
}

export function getResidentialGrowthExportSummaryLines(options: ResidentialGrowthExportSummaryLineOptions): ResidentialGrowthExportSummaryLines {
    const residentialType = options.subtypeFilter === 'all' ? 'All residential types' : options.subtypeFilter;
    const primary = [
        options.rangeLabel,
        `${options.periodCount || 0} month${options.periodCount === 1 ? '' : 's'}`,
        residentialType,
    ].filter(Boolean).join(' | ');
    const details = [
        options.searchText.trim() ? `Search: ${options.searchText.trim()}` : '',
        options.dateFrom || options.dateTo ? `Dates: ${options.dateFrom || 'Start'} to ${options.dateTo || 'Today'}` : '',
        options.accuracyFilter === 'exact'
            ? 'Exact geocodes only'
            : options.accuracyFilter === 'approximate'
                ? 'Approximate geocodes only'
                : 'All geocodes',
    ].filter(Boolean);

    return { primary, details };
}

export function getResidentialGrowthExportLayerSummaries(
    range: Pick<{ issued: ResidentialGrowthRecord[]; occupied: ResidentialGrowthRecord[] }, 'issued' | 'occupied'>,
): ResidentialGrowthExportLayerSummary[] {
    return [
        {
            layer: 'issued',
            title: 'Issued Permits',
            metricLabel: 'mapped permits',
            records: range.issued,
        },
        {
            layer: 'occupied',
            title: 'Occupied Units',
            metricLabel: 'mapped units',
            records: range.occupied,
        },
    ];
}

export function fitResidentialGrowthExportCamera(
    points: ResidentialGrowthExportPoint[],
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    padding = DEFAULT_PADDING,
    offsetX = 0,
    offsetY = 0,
): ResidentialGrowthExportCamera {
    if (points.length === 0) {
        return { longitude: -79.69, latitude: 44.38, zoom: 11.5 };
    }

    const projected = points.map((point) => projectNormalized(point.lon, point.lat));
    const minX = Math.min(...projected.map((point) => point.x));
    const maxX = Math.max(...projected.map((point) => point.x));
    const minY = Math.min(...projected.map((point) => point.y));
    const maxY = Math.max(...projected.map((point) => point.y));
    const availableWidth = Math.max(1, width - padding * 2);
    const availableHeight = Math.max(1, height - padding * 2);
    const xSpan = Math.max(maxX - minX, 0.000001);
    const ySpan = Math.max(maxY - minY, 0.000001);
    const zoomX = Math.log2(availableWidth / (TILE_SIZE * xSpan));
    const zoomY = Math.log2(availableHeight / (TILE_SIZE * ySpan));
    const zoom = clamp(Math.min(zoomX, zoomY) - 0.03, MIN_ZOOM, MAX_ZOOM);
    const scale = TILE_SIZE * (2 ** zoom);
    const desiredScreenCenterX = width / 2 + offsetX;
    const desiredScreenCenterY = height / 2 + offsetY;
    const boundsCenterX = (minX + maxX) / 2;
    const boundsCenterY = (minY + maxY) / 2;
    const cameraCenterX = boundsCenterX - (desiredScreenCenterX - width / 2) / scale;
    const cameraCenterY = boundsCenterY - (desiredScreenCenterY - height / 2) / scale;
    const center = unprojectNormalized(cameraCenterX, cameraCenterY);

    return {
        longitude: Number(center.lon.toFixed(6)),
        latitude: Number(center.lat.toFixed(6)),
        zoom: Number(zoom.toFixed(2)),
    };
}

export function projectResidentialGrowthExportPoint(
    point: ResidentialGrowthExportPoint,
    camera: ResidentialGrowthExportCamera,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
): { x: number; y: number } {
    const scale = TILE_SIZE * (2 ** camera.zoom);
    const projectedPoint = projectNormalized(point.lon, point.lat);
    const projectedCenter = projectNormalized(camera.longitude, camera.latitude);
    return {
        x: width / 2 + (projectedPoint.x - projectedCenter.x) * scale,
        y: height / 2 + (projectedPoint.y - projectedCenter.y) * scale,
    };
}

export function buildResidentialGrowthExportMarkers(
    points: ResidentialGrowthExportPoint[],
    camera: ResidentialGrowthExportCamera,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    clusterRadius = 42,
): ResidentialGrowthExportMarker[] {
    const projected = points.map((point) => ({
        ...point,
        ...projectResidentialGrowthExportPoint(point, camera, width, height),
    }));
    const remaining = [...projected].sort((a, b) => b.units - a.units || b.recordCount - a.recordCount);
    const markers: ResidentialGrowthExportMarker[] = [];

    while (remaining.length > 0) {
        const seed = remaining.shift()!;
        const group = [seed];
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
            const candidate = remaining[index];
            const distance = Math.hypot(candidate.x - seed.x, candidate.y - seed.y);
            if (distance <= clusterRadius) {
                group.push(candidate);
                remaining.splice(index, 1);
            }
        }

        const units = group.reduce((sum, point) => sum + point.units, 0);
        const recordCount = group.reduce((sum, point) => sum + point.recordCount, 0);
        markers.push({
            x: group.reduce((sum, point) => sum + point.x * point.units, 0) / Math.max(1, units),
            y: group.reduce((sum, point) => sum + point.y * point.units, 0) / Math.max(1, units),
            units,
            recordCount,
            clustered: group.length > 1,
        });
    }

    return markers.sort((a, b) => a.units - b.units || Number(a.clustered) - Number(b.clustered));
}

export function buildResidentialGrowthBaseMapUrl(options: ResidentialGrowthBaseMapUrlOptions): string {
    const token = options.mapboxToken?.trim();
    if (!token) return '';

    const style = options.style ?? DEFAULT_STYLE;
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const { longitude, latitude, zoom } = options.camera;

    return `https://api.mapbox.com/styles/v1/${style}/static/${formatCoordinate(longitude)},${formatCoordinate(latitude)},${Number(zoom.toFixed(2))}/${width}x${height}@2x?access_token=${encodeURIComponent(token)}`;
}

export function buildResidentialGrowthStaticMapUrl(options: ResidentialGrowthStaticMapUrlOptions): string | null {
    const token = options.mapboxToken?.trim();
    if (!token) return null;

    const points = getResidentialGrowthExportPoints(options.records, options.maxPoints ?? DEFAULT_MAX_POINTS);
    if (points.length === 0) return null;

    const camera = fitResidentialGrowthExportCamera(
        points,
        options.width ?? DEFAULT_WIDTH,
        options.height ?? DEFAULT_HEIGHT,
        options.padding ?? DEFAULT_PADDING,
    );

    return buildResidentialGrowthBaseMapUrl({
        camera,
        mapboxToken: token,
        width: options.width,
        height: options.height,
        style: options.style,
    });
}
