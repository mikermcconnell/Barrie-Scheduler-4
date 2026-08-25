import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Popup, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import { ArrowLeft, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import {
    buildCorridorSpeedMapIndex,
    getStatsForPeriod,
    scopeStatsToRoute,
    type CorridorSpeedIndex,
    type CorridorSpeedMetric,
    type CorridorSpeedStats,
} from '../../utils/gtfs/corridorSpeed';
import {
    getCorridorSpeedStyle,
    getMetricDisplayValue,
} from '../../utils/corridor-performance/corridorPerformancePresentation';
import { BUNDLED_CORRIDOR_GTFS_PROVENANCE } from '../../utils/corridor-performance/corridorPerformanceProvenance';
import { DAY_TYPES, TIME_PERIODS, type DayType, type TimePeriod } from '../../utils/gtfs/corridorHeadway';
import { HeadwayFilterBar } from './HeadwayFilterBar';
import { CorridorSpeedLegend } from './CorridorSpeedLegend';
import { CorridorSpeedDetailPanel } from './CorridorSpeedDetailPanel';
import { CorridorPerformanceRankedList } from './CorridorPerformanceRankedList';
import { CorridorPerformanceTrustBar } from './CorridorPerformanceTrustBar';
import { MapBase, toGeoJSON } from '../shared';

interface CorridorSpeedMapProps {
    onBack: () => void;
    teamId?: string;
    accessTeamId?: string;
}

interface SegmentFeatureProps {
    segmentId: string;
    color: string;
    weight: number;
    opacity: number;
    routeList: string;
    metricText: string;
    fromStop: string;
    toStop: string;
    directionId: string;
}

interface HoverInfo {
    longitude: number;
    latitude: number;
    props: SegmentFeatureProps;
}

const METRIC_OPTIONS: { id: CorridorSpeedMetric; label: string }[] = [
    { id: 'delay-minutes', label: 'Delay Min' },
    { id: 'delay-percent', label: 'Delay %' },
    { id: 'observed-speed', label: 'Observed km/h' },
    { id: 'scheduled-speed', label: 'Scheduled km/h' },
];

const SEGMENT_SRC = 'corridor-speed-segments';
const SEGMENT_BASE_LAYER = 'corridor-speed-base-lines';
const SEGMENT_LAYER = 'corridor-speed-lines';
const SEGMENT_HOVER_LAYER = 'corridor-speed-lines-hover';
const HIGHLIGHT_SRC = 'corridor-speed-highlight';
const HIGHLIGHT_LAYER = 'corridor-speed-highlight-line';

export const CorridorSpeedMap: React.FC<CorridorSpeedMapProps> = ({ onBack, teamId, accessTeamId }) => {
    const mapRef = useRef<MapRef | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [period, setPeriod] = useState<TimePeriod>('full-day');
    const [dayType, setDayType] = useState<DayType>('weekday');
    const [metric, setMetric] = useState<CorridorSpeedMetric>('delay-minutes');
    const [directionFilter, setDirectionFilter] = useState<string>('all');
    const [routeFilter, setRouteFilter] = useState<string>('all');
    const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

    const metadataQuery = usePerformanceMetadataQuery(teamId, accessTeamId);
    const hasPerformanceData = !!metadataQuery.data;
    const dataQuery = usePerformanceDataQuery(teamId, hasPerformanceData, metadataQuery.data, undefined, accessTeamId);

    const hasLegacySegmentRuntimeData = useMemo(
        () => dataQuery.data?.dailySummaries.some(day => (day.segmentRuntimes?.entries.length ?? 0) > 0) ?? false,
        [dataQuery.data],
    );
    const hasStopSegmentRuntimeData = useMemo(
        () => dataQuery.data?.dailySummaries.some(day => (day.stopSegmentRuntimes?.entries.length ?? 0) > 0) ?? false,
        [dataQuery.data],
    );
    const hasTripStopSegmentRuntimeData = useMemo(
        () => dataQuery.data?.dailySummaries.some(day => (day.tripStopSegmentRuntimes?.entries.length ?? 0) > 0) ?? false,
        [dataQuery.data],
    );

    const speedIndex = useMemo<CorridorSpeedIndex | null>(() => {
        if (!dataQuery.data || !hasTripStopSegmentRuntimeData) return null;
        return buildCorridorSpeedMapIndex(dataQuery.data.dailySummaries);
    }, [dataQuery.data, hasTripStopSegmentRuntimeData]);

    const segments = useMemo(() => speedIndex?.segments ?? [], [speedIndex]);
    const segmentById = useMemo(() => new Map(segments.map(segment => [segment.id, segment])), [segments]);

    const availableDirections = useMemo(
        () => speedIndex?.availableDirections ?? [],
        [speedIndex],
    );
    const availableRoutes = useMemo(
        () => Array.from(new Set(segments.flatMap(segment => segment.routes))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        [segments],
    );

    useEffect(() => {
        if (directionFilter === 'all') return;
        if (!availableDirections.includes(directionFilter)) {
            setDirectionFilter('all');
        }
    }, [availableDirections, directionFilter]);

    useEffect(() => {
        if (routeFilter === 'all') return;
        if (!availableRoutes.includes(routeFilter)) {
            setRouteFilter('all');
        }
    }, [availableRoutes, routeFilter]);

    const statsBySegment = useMemo(() => {
        if (!speedIndex) return new Map<string, CorridorSpeedStats>();
        const baseStats = getStatsForPeriod(speedIndex, dayType, period, directionFilter);
        if (routeFilter === 'all') return baseStats;

        const scopedStats = new Map<string, CorridorSpeedStats>();
        for (const [segmentId, stats] of baseStats.entries()) {
            const routeScopedStats = scopeStatsToRoute(stats, routeFilter);
            if (routeScopedStats) scopedStats.set(segmentId, routeScopedStats);
        }
        return scopedStats;
    }, [speedIndex, dayType, period, directionFilter, routeFilter]);

    const visibleSegments = useMemo(() => segments.filter(segment => (
        (directionFilter === 'all' || segment.directionId === directionFilter)
        && (routeFilter === 'all' || segment.routes.includes(routeFilter))
    )), [directionFilter, routeFilter, segments]);

    const evidenceCounts = useMemo(() => {
        let observed = 0;
        let usable = 0;
        for (const segment of visibleSegments) {
            const stats = statsBySegment.get(segment.id);
            if (stats?.observedRuntimeMin !== null && stats?.observedRuntimeMin !== undefined) observed += 1;
            if (stats?.confidenceLevel === 'usable') usable += 1;
        }
        return { observed, usable };
    }, [statsBySegment, visibleSegments]);

    const selectedSegment = useMemo(
        () => (selectedSegmentId ? segmentById.get(selectedSegmentId) ?? null : null),
        [segmentById, selectedSegmentId],
    );
    const selectedStats = useMemo(
        () => (selectedSegmentId ? statsBySegment.get(selectedSegmentId) ?? null : null),
        [selectedSegmentId, statsBySegment],
    );

    useEffect(() => {
        if (!selectedSegmentId) return;
        if (!visibleSegments.some(segment => segment.id === selectedSegmentId)) {
            setSelectedSegmentId(null);
        }
    }, [selectedSegmentId, visibleSegments]);

    const periodLabel = TIME_PERIODS.find(value => value.id === period)?.label ?? '';
    const dayTypeLabel = DAY_TYPES.find(value => value.id === dayType)?.label ?? '';

    const segmentGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
        const features: GeoJSON.Feature[] = [];

        for (const segment of visibleSegments) {
            if (segment.geometry.length < 2) continue;

            const stats = statsBySegment.get(segment.id) ?? null;
            const style = getCorridorSpeedStyle(stats, metric);
            const props: SegmentFeatureProps = {
                segmentId: segment.id,
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                routeList: routeFilter === 'all' ? segment.routes.join(', ') : routeFilter,
                metricText: getMetricDisplayValue(stats, metric),
                fromStop: segment.fromStopName,
                toStop: segment.toStopName,
                directionId: segment.directionId,
            };

            features.push({
                type: 'Feature',
                id: segment.id,
                properties: props,
                geometry: {
                    type: 'LineString',
                    coordinates: segment.geometry.map(toGeoJSON),
                },
            });
        }

        return { type: 'FeatureCollection', features };
    }, [visibleSegments, statsBySegment, metric, routeFilter]);

    const highlightGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
        if (!selectedSegment || selectedSegment.geometry.length < 2) {
            return { type: 'FeatureCollection', features: [] };
        }

        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: selectedSegment.geometry.map(toGeoJSON),
                },
            }],
        };
    }, [selectedSegment]);

    const segmentLayerStyle: LayerProps = {
        id: SEGMENT_LAYER,
        type: 'line' as const,
        layout: {
            'line-cap': 'round' as const,
            'line-join': 'round' as const,
        },
        paint: {
            'line-color': ['get', 'color'] as unknown as string,
            'line-width': ['get', 'weight'] as unknown as number,
            'line-opacity': ['get', 'opacity'] as unknown as number,
        },
    };

    const segmentBaseLayerStyle: LayerProps = {
        id: SEGMENT_BASE_LAYER,
        type: 'line' as const,
        layout: {
            'line-cap': 'round' as const,
            'line-join': 'round' as const,
        },
        paint: {
            'line-color': '#cbd5e1',
            'line-width': 2,
            'line-opacity': 0.25,
        },
    };

    const segmentHoverLayerStyle: LayerProps = {
        id: SEGMENT_HOVER_LAYER,
        type: 'line' as const,
        filter: (hoveredId !== null
            ? ['==', ['get', 'segmentId'], hoveredId]
            : ['==', ['literal', true], ['literal', false]]) as unknown as mapboxgl.FilterSpecification,
        layout: {
            'line-cap': 'round' as const,
            'line-join': 'round' as const,
        },
        paint: {
            'line-color': ['get', 'color'] as unknown as string,
            'line-width': ['+', ['get', 'weight'], 2] as unknown as number,
            'line-opacity': ['min', ['+', ['get', 'opacity'], 0.15], 1] as unknown as number,
        },
    };

    const highlightLayerStyle: LayerProps = {
        id: HIGHLIGHT_LAYER,
        type: 'line' as const,
        layout: {
            'line-cap': 'round' as const,
            'line-join': 'round' as const,
        },
        paint: {
            'line-color': '#0f172a',
            'line-width': 8,
            'line-opacity': 0.22,
        },
    };

    const handleMouseMove = useCallback((e: MapMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) {
            setHoveredId(null);
            setHoverInfo(null);
            const canvas = mapRef.current?.getMap().getCanvas();
            if (canvas) canvas.style.cursor = '';
            return;
        }

        const props = feature.properties as SegmentFeatureProps;
        setHoveredId(props.segmentId);
        setHoverInfo({
            longitude: e.lngLat.lng,
            latitude: e.lngLat.lat,
            props,
        });
        const canvas = mapRef.current?.getMap().getCanvas();
        if (canvas) canvas.style.cursor = 'pointer';
    }, []);

    const handleMouseLeave = useCallback(() => {
        setHoveredId(null);
        setHoverInfo(null);
        const canvas = mapRef.current?.getMap().getCanvas();
        if (canvas) canvas.style.cursor = '';
    }, []);

    const handleClick = useCallback((e: MapMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as SegmentFeatureProps;
        setSelectedSegmentId(props.segmentId);
    }, []);

    const clearSelection = useCallback(() => setSelectedSegmentId(null), []);
    const toggleFullscreen = useCallback(() => setIsFullscreen(value => !value), []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const raf = requestAnimationFrame(() => map.resize());
        const timer = window.setTimeout(() => map.resize(), 120);
        return () => {
            cancelAnimationFrame(raf);
            window.clearTimeout(timer);
        };
    }, [isFullscreen]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (selectedSegmentId) {
                clearSelection();
                return;
            }
            if (isFullscreen) setIsFullscreen(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [clearSelection, isFullscreen, selectedSegmentId]);

    const isLoading = metadataQuery.isLoading || (hasPerformanceData && dataQuery.isLoading);
    const loadedPerformanceMetadata = dataQuery.data?.metadata ?? metadataQuery.data;
    const metadataUnavailable = !metadataQuery.isLoading && metadataQuery.isError;
    const dataUnavailable = !isLoading && hasPerformanceData && !dataQuery.data;

    return (
        <div className={isFullscreen
            ? 'fixed inset-0 z-50 flex flex-col bg-white'
            : 'relative overflow-hidden rounded-xl border border-gray-200 bg-white'}>
            <div className="relative z-[1000] flex flex-wrap items-center gap-2 bg-white px-3 py-2.5">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                >
                    <ArrowLeft size={14} />
                    Back
                </button>

                <div className="bg-white/90 backdrop-blur-sm rounded-md px-2.5 py-1.5 shadow-sm border border-gray-200 pointer-events-auto">
                    <span className="text-xs font-bold text-gray-900">Corridor Performance</span>
                    <span className="text-[10px] text-gray-400 ml-1.5">{periodLabel} · {dayTypeLabel}</span>
                    {dataQuery.data?.metadata && (
                        <span className="text-[10px] text-gray-400 ml-1.5">
                            · {dataQuery.data.metadata.dateRange.start} to {dataQuery.data.metadata.dateRange.end}
                        </span>
                    )}
                </div>

                <div className="pointer-events-auto">
                    <HeadwayFilterBar
                        period={period}
                        dayType={dayType}
                        onPeriodChange={setPeriod}
                        onDayTypeChange={setDayType}
                    />
                </div>

                <div className="flex bg-white rounded-md border border-gray-300 shadow-sm overflow-hidden pointer-events-auto">
                    {METRIC_OPTIONS.map(option => (
                        <button
                            type="button"
                            key={option.id}
                            onClick={() => setMetric(option.id)}
                            className={`px-2.5 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                                metric === option.id
                                    ? 'bg-cyan-50 text-cyan-700'
                                    : 'text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <div className="pointer-events-auto">
                    <select
                        aria-label="Corridor direction"
                        value={directionFilter}
                        onChange={(event) => setDirectionFilter(event.target.value)}
                        className="px-2.5 py-1.5 text-[10px] font-bold uppercase border border-gray-300 rounded-md shadow-sm bg-white text-gray-600"
                    >
                        <option value="all">All Directions</option>
                        {availableDirections.map(direction => (
                            <option key={direction} value={direction}>{direction}</option>
                        ))}
                    </select>
                </div>

                <div className="pointer-events-auto">
                    <select
                        aria-label="Corridor route"
                        value={routeFilter}
                        onChange={(event) => setRouteFilter(event.target.value)}
                        className="px-2.5 py-1.5 text-[10px] font-bold uppercase border border-gray-300 rounded-md shadow-sm bg-white text-gray-600"
                    >
                        <option value="all">All Routes</option>
                        {availableRoutes.map(route => (
                            <option key={route} value={route}>Route {route}</option>
                        ))}
                    </select>
                </div>

                <div className="flex-1" />

                <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="bg-white border border-gray-300 rounded-md px-2 py-1.5 shadow-sm hover:bg-gray-50 transition-colors flex items-center gap-1.5 text-xs font-medium text-gray-600 pointer-events-auto"
                    title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                >
                    {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    {isFullscreen ? 'Exit' : 'Fullscreen'}
                </button>
            </div>

            <CorridorPerformanceTrustBar
                metadata={loadedPerformanceMetadata}
                provenance={BUNDLED_CORRIDOR_GTFS_PROVENANCE}
                observedCorridorCount={evidenceCounts.observed}
                usableCorridorCount={evidenceCounts.usable}
                totalCorridorCount={visibleSegments.length}
            />

            <div className={isFullscreen ? 'relative min-h-0 flex-1' : 'relative h-[750px] w-full'}>
            <CorridorSpeedLegend metric={metric} />

            {selectedSegment && (
                <CorridorSpeedDetailPanel
                    segment={selectedSegment}
                    stats={selectedStats}
                    metric={metric}
                    periodLabel={periodLabel}
                    dayTypeLabel={dayTypeLabel}
                    onClose={clearSelection}
                />
            )}

            {!selectedSegment && hasTripStopSegmentRuntimeData && (
                <CorridorPerformanceRankedList
                    segments={visibleSegments}
                    statsBySegment={statsBySegment}
                    metric={metric}
                    selectedSegmentId={selectedSegmentId}
                    onSelect={setSelectedSegmentId}
                />
            )}

            {isLoading && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-white/80">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="animate-spin" size={18} />
                        Loading trip-linked corridor evidence...
                    </div>
                </div>
            )}

            {!isLoading && !teamId && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center pointer-events-none">
                    <div className="bg-white/95 rounded-lg shadow-md border border-gray-200 px-6 py-4 text-center">
                        <div className="text-sm font-medium text-gray-700 mb-1">No team selected</div>
                        <div className="text-xs text-gray-400">Join or select a team to load STREETS segment speeds.</div>
                    </div>
                </div>
            )}

            {metadataUnavailable && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-white/85">
                    <div className="max-w-md rounded-lg border border-red-200 bg-white px-6 py-4 text-center shadow-md">
                        <div className="mb-1 text-sm font-semibold text-red-700">Unable to check STREETS data</div>
                        <div className="text-xs text-gray-500">
                            Performance metadata could not be loaded. Retry before importing or replacing any data.
                        </div>
                        <button
                            type="button"
                            onClick={() => void metadataQuery.refetch()}
                            className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )}

            {!isLoading && teamId && !metadataQuery.isError && !hasPerformanceData && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center pointer-events-none">
                    <div className="bg-white/95 rounded-lg shadow-md border border-gray-200 px-6 py-4 text-center max-w-sm">
                        <div className="text-sm font-medium text-gray-700 mb-1">STREETS data required</div>
                        <div className="text-xs text-gray-400">
                            Import STREETS AVL data in the Operations workspace before using Corridor Performance.
                        </div>
                    </div>
                </div>
            )}

            {dataUnavailable && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-white/85">
                    <div className="max-w-md rounded-lg border border-red-200 bg-white px-6 py-4 text-center shadow-md">
                        <div className="mb-1 text-sm font-semibold text-red-700">Performance data unavailable</div>
                        <div className="text-xs text-gray-500">
                            The team has performance metadata, but its stored dataset could not be loaded. Retry before re-importing data.
                        </div>
                        <button
                            type="button"
                            onClick={() => void dataQuery.refetch()}
                            className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )}

            {!isLoading && dataQuery.data && !hasStopSegmentRuntimeData && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center pointer-events-none">
                    <div className="bg-white/95 rounded-lg shadow-md border border-gray-200 px-6 py-4 text-center max-w-md">
                        <div className="text-sm font-medium text-gray-700 mb-1">Re-import STREETS data</div>
                        <div className="text-xs text-gray-400">
                            This import predates stop-level runtime evidence. Re-import it before using Corridor Performance.
                        </div>
                    </div>
                </div>
            )}

            {!isLoading && dataQuery.data && hasStopSegmentRuntimeData && !hasTripStopSegmentRuntimeData && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center pointer-events-none">
                    <div className="bg-white/95 rounded-lg shadow-md border border-gray-200 px-6 py-4 text-center max-w-md">
                        <div className="text-sm font-medium text-gray-700 mb-1">Re-import STREETS data</div>
                        <div className="text-xs text-gray-400">
                            This import has exact stop segments, but not the trip-linked traversals required for observed corridor operating speed.
                        </div>
                    </div>
                </div>
            )}

            {!isLoading && teamId && hasTripStopSegmentRuntimeData && !hasLegacySegmentRuntimeData && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
                    <div className="bg-white/92 backdrop-blur-sm rounded-md shadow-sm border border-gray-200 px-3 py-1.5 text-[10px] text-gray-500">
                        Trip-linked traversal mode
                    </div>
                </div>
            )}

                <MapBase
                    mapRef={mapRef}
                    showNavigation
                    showScale
                    className="w-full h-full"
                    interactiveLayerIds={[SEGMENT_LAYER]}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={handleClick}
                >
                    <Source id={SEGMENT_SRC} type="geojson" data={segmentGeoJSON}>
                        <Layer {...segmentBaseLayerStyle} />
                        <Layer {...segmentLayerStyle} />
                        <Layer {...segmentHoverLayerStyle} />
                    </Source>

                    <Source id={HIGHLIGHT_SRC} type="geojson" data={highlightGeoJSON}>
                        <Layer {...highlightLayerStyle} />
                    </Source>

                    {hoverInfo && (
                        <Popup
                            longitude={hoverInfo.longitude}
                            latitude={hoverInfo.latitude}
                            closeButton={false}
                            closeOnClick={false}
                            anchor="bottom"
                            offset={8}
                        >
                            <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                                <strong>{hoverInfo.props.directionId} · Routes {hoverInfo.props.routeList}</strong><br />
                                {hoverInfo.props.metricText}<br />
                                <span style={{ color: '#9ca3af' }}>
                                    {hoverInfo.props.fromStop} → {hoverInfo.props.toStop}
                                </span>
                            </div>
                        </Popup>
                    )}
                </MapBase>
            </div>
        </div>
    );
};
