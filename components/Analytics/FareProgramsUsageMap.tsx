import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Download, FileSpreadsheet, GraduationCap, Info, Layers3, Loader2, MapPin, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Layer, Marker, Popup, Source, type LayerProps, type MapMouseEvent, type MapRef } from 'react-map-gl/mapbox';
import { MapBase } from '../shared/MapBase';
import type { FareProgramsSnapshot } from '../../utils/fare-programs/fareProgramsSnapshot';
import {
    FARE_PROGRAM_EXACT_TIME_BANDS,
    getFareProgramExactOriginUses,
    validateFareProgramsWorkbookFile,
    type FareProgramExactDayType,
    type FareProgramExactOrigin,
    type FareProgramExactOriginResult,
    type FareProgramExactTimeBandId,
} from '../../utils/fare-programs/fareProgramsWorkbook';
import {
    geocodeFareProgramOrigins,
    type FareProgramOriginGeocode,
} from '../../utils/fare-programs/fareProgramsOriginGeocoder';
import { exportFareProgramsUsageMapPdf } from '../../utils/fare-programs/fareProgramsPdfExport';
import { BARRIE_HIGH_SCHOOLS } from '../../utils/fare-programs/fareProgramsSchools';
import {
    groupFareProgramUsageMapOrigins,
    type FareProgramUsageMapPoint,
} from '../../utils/fare-programs/fareProgramsUsageMap';

interface FareProgramsUsageMapProps {
    snapshot: FareProgramsSnapshot;
    sourceFile: File | null;
    workbookStorageStatus: 'restoring' | 'saving' | 'saved' | 'none' | 'error';
    workbookStorageError: string | null;
    onSourceFileChange: (file: File) => void;
    onRemoveSourceFile: () => void;
}

type GeocodeStatus = 'idle' | 'loading' | 'ready' | 'error';
type DayFilter = FareProgramExactDayType | 'all';
type TimeFilter = FareProgramExactTimeBandId | 'all';
type MapView = 'bubbles' | 'heatmap';
type ValueMode = 'total' | 'average';
type LocatedOrigin = FareProgramExactOrigin & FareProgramOriginGeocode & { filteredUses: number };
type ClusterHover = {
    longitude: number;
    latitude: number;
    filteredUses: number;
    locationCount: number;
};

const number = new Intl.NumberFormat('en-CA');
const averageNumber = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const HIGH_SCHOOL_PASS = 'High School Student Pass 25/26';
const BUBBLE_SOURCE_ID = 'fare-programs-usage-bubble-source';
const BUBBLE_CLUSTER_LAYER_ID = 'fare-programs-usage-clusters';
const BUBBLE_CLUSTER_LABEL_LAYER_ID = 'fare-programs-usage-cluster-labels';
const BUBBLE_POINT_LAYER_ID = 'fare-programs-usage-points';
const BUBBLE_TOP_POINT_LABEL_LAYER_ID = 'fare-programs-usage-top-point-labels';

const bubbleClusterLayer: LayerProps = {
    id: BUBBLE_CLUSTER_LAYER_ID,
    type: 'circle',
    filter: ['has', 'point_count'],
    paint: {
        'circle-color': '#2563eb',
        'circle-opacity': 0.9,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
        'circle-radius': [
            'step',
            ['coalesce', ['get', 'uses_sum'], ['get', 'point_count'], 1],
            18,
            25, 22,
            100, 28,
            250, 34,
            500, 40,
        ],
    },
};

const bubblePointLayer: LayerProps = {
    id: BUBBLE_POINT_LAYER_ID,
    type: 'circle',
    filter: ['!', ['has', 'point_count']],
    paint: {
        'circle-color': '#2563eb',
        'circle-opacity': 0.82,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-radius': [
            'case',
            ['<=', ['get', 'rank'], 10],
            11,
            7,
        ],
    },
};

const bubbleTopPointLabelLayer: LayerProps = {
    id: BUBBLE_TOP_POINT_LABEL_LAYER_ID,
    type: 'symbol',
    filter: ['all', ['!', ['has', 'point_count']], ['<=', ['get', 'rank'], 10]],
    layout: {
        'text-field': ['to-string', ['get', 'rank']],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-allow-overlap': true,
    },
    paint: {
        'text-color': '#ffffff',
    },
};

function bubbleClusterLabelLayer(valueMode: ValueMode): LayerProps {
    return {
        id: BUBBLE_CLUSTER_LABEL_LAYER_ID,
        type: 'symbol',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': [
                'number-format',
                ['coalesce', ['get', 'uses_sum'], ['get', 'point_count']],
                { 'max-fraction-digits': valueMode === 'average' ? 1 : 0 },
            ],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 12,
            'text-allow-overlap': true,
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#1e3a8a',
            'text-halo-width': 0.75,
        },
    };
}

function propertyNumber(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function filterLabel(dayFilter: DayFilter, timeFilter: TimeFilter): string {
    const dayLabel = dayFilter === 'all' ? 'All days' : dayFilter === 'weekday' ? 'Weekdays' : 'Weekends';
    const timeLabel = timeFilter === 'all'
        ? 'all times'
        : FARE_PROGRAM_EXACT_TIME_BANDS.find((band) => band.id === timeFilter)?.label ?? timeFilter;
    return `${dayLabel}, ${timeLabel}`;
}

export const FareProgramsUsageMap: React.FC<FareProgramsUsageMapProps> = ({
    snapshot,
    sourceFile,
    workbookStorageStatus,
    workbookStorageError,
    onSourceFileChange,
    onRemoveSourceFile,
}) => {
    const reportRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MapRef | null>(null);
    const previousSourceFileRef = useRef<File | null>(null);
    const mapBuildIdRef = useRef(0);
    const [exactData, setExactData] = useState<FareProgramExactOriginResult | null>(null);
    const [parsedSourceFile, setParsedSourceFile] = useState<File | null>(null);
    const [isReadingWorkbook, setIsReadingWorkbook] = useState(false);
    const [workbookError, setWorkbookError] = useState<string | null>(null);
    const [workbookWarning, setWorkbookWarning] = useState<string | null>(null);
    const [dayFilter, setDayFilter] = useState<DayFilter>('all');
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
    const [status, setStatus] = useState<GeocodeStatus>('idle');
    const [geocodes, setGeocodes] = useState<Record<string, FareProgramOriginGeocode>>({});
    const [failedCount, setFailedCount] = useState(0);
    const [progress, setProgress] = useState({ completed: 0, total: 0 });
    const [mapError, setMapError] = useState<string | null>(null);
    const [selectedMapPointId, setSelectedMapPointId] = useState<string | null>(null);
    const [clusterHover, setClusterHover] = useState<ClusterHover | null>(null);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const [mapView, setMapView] = useState<MapView>('heatmap');
    const [valueMode, setValueMode] = useState<ValueMode>('total');
    const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let worker: Worker | null = null;
        const previousSourceFile = previousSourceFileRef.current;
        previousSourceFileRef.current = sourceFile;
        if (!sourceFile) {
            if (previousSourceFile) {
                mapBuildIdRef.current += 1;
                setExactData(null);
                setParsedSourceFile(null);
                setWorkbookError(null);
                setWorkbookWarning(null);
                setGeocodes({});
                setStatus('idle');
                setMapError(null);
                setSelectedMapPointId(null);
            }
            return () => { cancelled = true; };
        }

        mapBuildIdRef.current += 1;
        setExactData(null);
        setParsedSourceFile(null);
        setWorkbookError(null);
        setWorkbookWarning(null);
        setGeocodes({});
        setStatus('idle');
        setMapError(null);
        setSelectedMapPointId(null);
        setIsReadingWorkbook(true);
        void sourceFile.arrayBuffer()
            .then((buffer) => new Promise<FareProgramExactOriginResult>((resolve, reject) => {
                if (cancelled) return;
                worker = new Worker(
                    new URL('../../utils/fare-programs/fareProgramsWorkbook.worker.ts', import.meta.url),
                    { type: 'module' },
                );
                worker.onmessage = (event: MessageEvent<
                    | { ok: true; result: FareProgramExactOriginResult }
                    | { ok: false; error: string }
                >) => {
                    worker?.terminate();
                    const response = event.data;
                    if (response.ok === true) resolve(response.result);
                    else reject(new Error(response.error));
                };
                worker.onerror = () => {
                    worker?.terminate();
                    reject(new Error('The workbook reader stopped unexpectedly.'));
                };
                worker.postMessage({ buffer, fareType: HIGH_SCHOOL_PASS, mode: 'exact-origins' }, [buffer]);
            }))
            .then((result) => {
                if (cancelled) return;
                setStatus('loading');
                setExactData(result);
                setParsedSourceFile(sourceFile);
                setProgress({ completed: 0, total: result.origins.length });
                const warnings: string[] = [];
                if (result.sourceRows !== snapshot.sourceRows) {
                    warnings.push(`Workbook has ${number.format(result.sourceRows)} rows; the source snapshot has ${number.format(snapshot.sourceRows)}.`);
                }
                if (result.matchedUses !== snapshot.serviceMirroring.uses) {
                    warnings.push(`Workbook has ${number.format(result.matchedUses)} high-school-pass uses; the source snapshot has ${number.format(snapshot.serviceMirroring.uses)}.`);
                }
                setWorkbookWarning(warnings.length > 0 ? warnings.join(' ') : null);
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setWorkbookError(cause instanceof Error ? cause.message : 'Could not read the selected workbook.');
                }
            })
            .finally(() => {
                if (!cancelled) setIsReadingWorkbook(false);
            });

        return () => {
            cancelled = true;
            worker?.terminate();
        };
    }, [snapshot.serviceMirroring.uses, snapshot.sourceRows, sourceFile]);

    const sourceDayCount = exactData
        ? dayFilter === 'all'
            ? exactData.coverageDays.weekday + exactData.coverageDays.weekend
            : exactData.coverageDays[dayFilter]
        : 0;
    const filteredOriginTotals = useMemo(() => (exactData?.origins ?? [])
        .map((origin) => ({
            origin,
            filteredUses: getFareProgramExactOriginUses(origin, dayFilter, timeFilter),
        }))
        .filter((item) => item.filteredUses > 0)
        .sort((left, right) => right.filteredUses - left.filteredUses || left.origin.label.localeCompare(right.origin.label)), [
        dayFilter,
        exactData?.origins,
        timeFilter,
    ]);
    const filteredOrigins = useMemo(() => filteredOriginTotals.map(({ origin, filteredUses }) => ({
        origin,
        filteredUses: valueMode === 'average' && sourceDayCount > 0
            ? filteredUses / sourceDayCount
            : filteredUses,
    })), [filteredOriginTotals, sourceDayCount, valueMode]);
    const rawFilteredUses = filteredOriginTotals.reduce((sum, item) => sum + item.filteredUses, 0);
    const filteredUses = filteredOrigins.reduce((sum, item) => sum + item.filteredUses, 0);
    const locatedOrigins = useMemo(() => filteredOrigins
        .map(({ origin, filteredUses: uses }) => {
            const geocode = geocodes[origin.id];
            return geocode ? { ...origin, ...geocode, filteredUses: uses } : null;
        })
        .filter((origin): origin is LocatedOrigin => origin !== null), [filteredOrigins, geocodes]);
    const usageMapPoints = useMemo(
        () => groupFareProgramUsageMapOrigins(locatedOrigins),
        [locatedOrigins],
    );
    const originPointIds = useMemo(() => new Map(
        usageMapPoints.flatMap((point) => point.origins.map((origin) => [origin.id, point.id] as const)),
    ), [usageMapPoints]);
    const originRanks = useMemo(() => new Map(
        filteredOrigins.map(({ origin }, index) => [origin.id, index + 1] as const),
    ), [filteredOrigins]);
    const mappedUses = locatedOrigins.reduce((sum, origin) => sum + origin.filteredUses, 0);
    const maximumUses = locatedOrigins.reduce((maximum, origin) => Math.max(maximum, origin.filteredUses), 0);
    const selectedMapPoint = usageMapPoints.find((point) => point.id === selectedMapPointId) ?? null;
    const selectedSchool = BARRIE_HIGH_SCHOOLS.find((school) => school.id === selectedSchoolId) ?? null;
    const currentFilterLabel = filterLabel(dayFilter, timeFilter);
    const totalUses = exactData?.matchedUses ?? snapshot.serviceMirroring.uses;
    const missingUses = exactData?.missingStartUses
        ?? snapshot.serviceMirroring.uses - snapshot.serviceMirroring.originUsage.usableStartUses;
    const formatMeasure = (value: number) => valueMode === 'average'
        ? averageNumber.format(value)
        : number.format(value);

    const heatmapGeoJson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: locatedOrigins.map((origin) => ({
            type: 'Feature',
            properties: { uses: origin.filteredUses },
            geometry: {
                type: 'Point',
                coordinates: [origin.longitude, origin.latitude],
            },
        })),
    };
    const heatmapLayer: LayerProps = {
        id: 'fare-programs-usage-heatmap',
        type: 'heatmap',
        paint: {
            'heatmap-weight': [
                'interpolate',
                ['linear'],
                ['get', 'uses'],
                0, 0,
                Math.max(1, maximumUses), 1,
            ] as mapboxgl.Expression,
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1.8] as mapboxgl.Expression,
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 22, 14, 46] as mapboxgl.Expression,
            'heatmap-opacity': 0.82,
            'heatmap-color': [
                'interpolate',
                ['linear'],
                ['heatmap-density'],
                0, 'rgba(37,99,235,0)',
                0.2, 'rgba(59,130,246,0.55)',
                0.45, 'rgba(34,211,238,0.7)',
                0.7, 'rgba(251,191,36,0.82)',
                1, 'rgba(220,38,38,0.92)',
            ] as mapboxgl.Expression,
        },
    };
    const bubbleGeoJson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: usageMapPoints.map((point) => ({
            type: 'Feature',
            id: point.id,
            properties: {
                id: point.id,
                uses: point.filteredUses,
                locationCount: point.locationCount,
                rank: Math.min(...point.origins.map((origin) => originRanks.get(origin.id) ?? Number.MAX_SAFE_INTEGER)),
            },
            geometry: {
                type: 'Point',
                coordinates: [point.longitude, point.latitude],
            },
        })),
    };

    const focusMapPoint = (pointId: string, zoomIn: boolean) => {
        const point = usageMapPoints.find((candidate) => candidate.id === pointId);
        if (!point) return;
        setSelectedMapPointId(pointId);
        setSelectedSchoolId(null);
        setClusterHover(null);
        if (zoomIn) {
            const map = mapRef.current?.getMap();
            map?.easeTo({
                center: [point.longitude, point.latitude],
                zoom: Math.max(map.getZoom(), 14.5),
                duration: 450,
            });
        }
    };

    const handleBubbleMapClick = (event: MapMouseEvent) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (clusterId != null && feature?.geometry.type === 'Point' && 'coordinates' in feature.geometry) {
            const coordinates = feature.geometry.coordinates as [number, number];
            const source = mapRef.current?.getMap().getSource(BUBBLE_SOURCE_ID) as {
                getClusterExpansionZoom?: (
                    id: number,
                    callback: (error: Error | null, zoom: number) => void,
                ) => void;
            } | undefined;
            source?.getClusterExpansionZoom?.(Number(clusterId), (clusterError, zoom) => {
                if (clusterError) return;
                mapRef.current?.getMap().easeTo({
                    center: coordinates,
                    zoom,
                    duration: 450,
                });
            });
            setSelectedMapPointId(null);
            setClusterHover(null);
            return;
        }

        const pointId = typeof feature?.properties?.id === 'string'
            ? feature.properties.id
            : undefined;
        if (pointId) focusMapPoint(pointId, false);
    };

    const handleBubbleMapMouseMove = (event: MapMouseEvent) => {
        const feature = event.features?.[0];
        const canvas = mapRef.current?.getMap().getCanvas();
        if (canvas) canvas.style.cursor = feature ? 'pointer' : '';

        if (feature?.properties?.cluster_id == null || feature.geometry.type !== 'Point' || !('coordinates' in feature.geometry)) {
            setClusterHover(null);
            return;
        }

        const coordinates = feature.geometry.coordinates as [number, number];
        setClusterHover({
            longitude: coordinates[0],
            latitude: coordinates[1],
            filteredUses: propertyNumber(feature.properties.uses_sum),
            locationCount: propertyNumber(feature.properties.locations_sum),
        });
    };

    const handleBubbleMapMouseLeave = () => {
        const canvas = mapRef.current?.getMap().getCanvas();
        if (canvas) canvas.style.cursor = '';
        setClusterHover(null);
    };

    const chooseSourceFile = (file: File) => {
        const validationError = validateFareProgramsWorkbookFile(file);
        if (validationError) {
            setWorkbookError(validationError);
            return;
        }
        setWorkbookError(null);
        onSourceFileChange(file);
    };

    const buildUsageMap = useCallback(async (data: FareProgramExactOriginResult | null) => {
        if (!data) return;
        const buildId = ++mapBuildIdRef.current;
        setStatus('loading');
        setMapError(null);
        setFailedCount(0);
        setProgress({ completed: 0, total: data.origins.length });
        try {
            const result = await geocodeFareProgramOrigins(data.origins, {
                onProgress: ({ completed, total }) => {
                    if (mapBuildIdRef.current === buildId) setProgress({ completed, total });
                },
            });
            if (mapBuildIdRef.current !== buildId) return;
            setGeocodes(Object.fromEntries(result.geocodes.map((geocode) => [geocode.originId, geocode])));
            setFailedCount(result.failedOriginIds.length);
            setStatus('ready');
        } catch (cause) {
            if (mapBuildIdRef.current !== buildId) return;
            setMapError(cause instanceof Error ? cause.message : 'Could not locate the starting locations.');
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        if (exactData && parsedSourceFile === sourceFile) void buildUsageMap(exactData);
    }, [buildUsageMap, exactData, parsedSourceFile, sourceFile]);

    const exportPdf = async () => {
        if (!reportRef.current || !sourceFile || status !== 'ready') return;
        setIsExportingPdf(true);
        setPdfError(null);
        try {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            await exportFareProgramsUsageMapPdf({
                element: reportRef.current,
                filterLabel: currentFilterLabel,
                sourceFileName: sourceFile.name,
                totalUses,
                mappedUses,
            });
        } catch (cause) {
            setPdfError(cause instanceof Error ? cause.message : 'Could not export the usage map PDF.');
        } finally {
            setIsExportingPdf(false);
        }
    };

    return (
        <div className="space-y-5" ref={reportRef}>
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h2 className="text-base font-bold text-gray-900">High-school-pass usage map</h2>
                        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-500">
                            Explore starting locations by Barrie-local day and time. Counts are transactions, not unique students or confirmed home locations.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2" data-pdf-ignore="true">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:border-blue-300 hover:text-blue-700">
                            <Upload size={15} />
                            {sourceFile ? 'Change workbook' : 'Choose source workbook'}
                            <input
                                type="file"
                                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                className="sr-only"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) chooseSourceFile(file);
                                    event.currentTarget.value = '';
                                }}
                            />
                        </label>
                        {sourceFile && (
                            <button
                                type="button"
                                onClick={onRemoveSourceFile}
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:border-red-300 hover:text-red-700"
                            >
                                <Trash2 size={15} />
                                Remove saved workbook
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={status !== 'ready' || isExportingPdf}
                            onClick={() => void exportPdf()}
                            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-sm enabled:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            {isExportingPdf ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                            {isExportingPdf ? 'Creating PDF' : 'Export page PDF'}
                        </button>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">
                        <ShieldCheck className="mr-1.5 inline h-4 w-4" />
                        {workbookStorageStatus === 'restoring'
                            ? 'Restoring saved workbook…'
                            : workbookStorageStatus === 'saving'
                                ? 'Saving workbook on this device…'
                                : workbookStorageStatus === 'saved'
                                    ? 'Workbook saved on this device'
                                    : 'Workbook stays on this device'}
                    </div>
                    {sourceFile && (
                        <div className="inline-flex min-w-0 items-center gap-2 text-xs text-gray-600" data-pdf-ignore="true">
                            <FileSpreadsheet size={15} className="shrink-0 text-gray-500" />
                            <span className="truncate font-semibold">{sourceFile.name}</span>
                        </div>
                    )}
                    <span className="text-xs text-gray-500">On load, GTFS is checked first; remaining starting-location labels are temporarily sent to Mapbox.</span>
                </div>
                {workbookWarning && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{workbookWarning}</p>}
                {workbookStorageError && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{workbookStorageError}</p>}
                {pdfError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{pdfError}</p>}

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)]">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Day type</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {([
                                ['all', 'All days'],
                                ['weekday', 'Weekdays'],
                                ['weekend', 'Weekends'],
                            ] as const).map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => {
                                        setDayFilter(id);
                                        setSelectedMapPointId(null);
                                        setClusterHover(null);
                                    }}
                                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                        dayFilter === id
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Time of day</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setTimeFilter('all');
                                    setSelectedMapPointId(null);
                                    setClusterHover(null);
                                }}
                                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                    timeFilter === 'all'
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                }`}
                            >
                                All times
                            </button>
                            {FARE_PROGRAM_EXACT_TIME_BANDS.map((band) => (
                                <button
                                    key={band.id}
                                    type="button"
                                    onClick={() => {
                                        setTimeFilter(band.id);
                                        setSelectedMapPointId(null);
                                        setClusterHover(null);
                                    }}
                                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                        timeFilter === band.id
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                    }`}
                                >
                                    {band.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Measure</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        {([
                            ['total', 'Total uses'],
                            ['average', 'Average per day'],
                        ] as const).map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => {
                                    setValueMode(id);
                                    setSelectedMapPointId(null);
                                    setClusterHover(null);
                                }}
                                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                    valueMode === id
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                        <span className="text-xs text-gray-500">
                            {sourceDayCount > 0
                                ? `${number.format(sourceDayCount)} distinct ${dayFilter === 'all' ? 'source days' : `${dayFilter} source days`} in the workbook`
                                : 'Source-day count appears after the workbook loads'}
                        </span>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Total high-school uses</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{number.format(totalUses)}</div>
                    <div className="mt-1 text-xs text-blue-800">All High School Student Pass transactions.</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{valueMode === 'average' ? 'Average uses per day' : 'Uses in filter'}</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{formatMeasure(filteredUses)}</div>
                    <div className="mt-1 text-xs text-gray-500">
                        {currentFilterLabel}; {valueMode === 'average' ? `${number.format(rawFilteredUses)} uses across ${number.format(sourceDayCount)} source days.` : 'usable starts.'}
                    </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Starting locations</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{number.format(filteredOrigins.length)}</div>
                    <div className="mt-1 text-xs text-gray-500">Distinct workbook locations in this filter.</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Mapped uses</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{formatMeasure(mappedUses)}</div>
                    <div className="mt-1 text-xs text-gray-500">{status === 'ready' ? `${number.format(failedCount)} locations could not be located.` : 'Build the map to verify locations.'}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Missing / unauthorized</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{number.format(missingUses)}</div>
                    <div className="mt-1 text-xs text-gray-500">No usable starting location in the workbook.</div>
                </div>
            </section>

            <section className="grid min-h-[590px] gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.65fr)]">
                <div className="fare-programs-exact-map relative min-h-[590px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div
                        className="absolute right-4 top-4 z-20 flex rounded-lg border border-gray-200 bg-white/95 p-1 shadow-sm backdrop-blur"
                        role="tablist"
                        aria-label="Usage map display"
                        data-pdf-ignore="true"
                    >
                        {([
                            ['bubbles', 'Bubble map', MapPin],
                            ['heatmap', 'Heat map', Layers3],
                        ] as const).map(([id, label, Icon]) => (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={mapView === id}
                                onClick={() => {
                                    setMapView(id);
                                    setSelectedMapPointId(null);
                                    setClusterHover(null);
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${
                                    mapView === id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            >
                                <Icon size={14} />
                                {label}
                            </button>
                        ))}
                    </div>
                    <MapBase
                        mapRef={mapRef}
                        longitude={-79.69}
                        latitude={44.38}
                        zoom={11.3}
                        showNavigation
                        showScale
                        preserveDrawingBuffer
                        interactiveLayerIds={mapView === 'bubbles'
                            ? [BUBBLE_CLUSTER_LAYER_ID, BUBBLE_POINT_LAYER_ID]
                            : undefined}
                        onClick={mapView === 'bubbles' ? handleBubbleMapClick : undefined}
                        onMouseMove={mapView === 'bubbles' ? handleBubbleMapMouseMove : undefined}
                        onMouseLeave={mapView === 'bubbles' ? handleBubbleMapMouseLeave : undefined}
                    >
                        {mapView === 'heatmap' && locatedOrigins.length > 0 && (
                            <Source id="fare-programs-usage-heatmap-source" type="geojson" data={heatmapGeoJson}>
                                <Layer {...heatmapLayer} />
                            </Source>
                        )}
                        {mapView === 'bubbles' && usageMapPoints.length > 0 && (
                            <Source
                                id={BUBBLE_SOURCE_ID}
                                type="geojson"
                                data={bubbleGeoJson}
                                cluster
                                clusterMaxZoom={14}
                                clusterRadius={44}
                                clusterProperties={{
                                    uses_sum: ['+', ['get', 'uses']],
                                    locations_sum: ['+', ['get', 'locationCount']],
                                }}
                            >
                                <Layer {...bubbleClusterLayer} />
                                <Layer {...bubbleClusterLabelLayer(valueMode)} />
                                <Layer {...bubblePointLayer} />
                                <Layer {...bubbleTopPointLabelLayer} />
                            </Source>
                        )}
                        {BARRIE_HIGH_SCHOOLS.map((school) => (
                            <Marker key={school.id} longitude={school.longitude} latitude={school.latitude} anchor="center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedSchoolId(school.id);
                                        setSelectedMapPointId(null);
                                        setClusterHover(null);
                                    }}
                                    aria-label={`High school: ${school.name}`}
                                    className="grid h-8 w-8 place-items-center rounded-lg border-2 border-white bg-gray-900 text-white shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-300"
                                    title={school.name}
                                >
                                    <GraduationCap size={17} />
                                </button>
                            </Marker>
                        ))}
                        {clusterHover && !selectedMapPoint && (
                            <Popup
                                longitude={clusterHover.longitude}
                                latitude={clusterHover.latitude}
                                anchor="bottom"
                                offset={28}
                                closeButton={false}
                                closeOnClick={false}
                            >
                                <div className="p-1">
                                    <div className="text-sm font-bold text-gray-900">
                                        {number.format(clusterHover.locationCount)} starting locations
                                    </div>
                                    <div className="mt-1 text-xs font-semibold text-blue-700">
                                        {formatMeasure(clusterHover.filteredUses)} {valueMode === 'average' ? 'average daily uses' : 'filtered uses'}
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500">Click to zoom in and separate this area.</p>
                                </div>
                            </Popup>
                        )}
                        {selectedMapPoint && (
                            <Popup
                                longitude={selectedMapPoint.longitude}
                                latitude={selectedMapPoint.latitude}
                                anchor="bottom"
                                offset={24}
                                closeButton
                                closeOnClick={false}
                                onClose={() => setSelectedMapPointId(null)}
                            >
                                <div className="max-w-[300px] p-1">
                                    <div className="font-bold text-gray-900">
                                        {selectedMapPoint.locationCount === 1
                                            ? selectedMapPoint.origins[0].label
                                            : `${number.format(selectedMapPoint.locationCount)} starting locations`}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-blue-700">
                                        {formatMeasure(selectedMapPoint.filteredUses)} {valueMode === 'average' ? 'uses per source day' : 'filtered uses'}
                                    </div>
                                    <p className="mt-1 text-xs leading-relaxed text-gray-600">
                                        {currentFilterLabel}. {number.format(selectedMapPoint.totalUses)} uses across all days and times.
                                    </p>
                                    {selectedMapPoint.locationCount > 1 && (
                                        <div className="mt-3 max-h-44 space-y-1 overflow-y-auto border-t border-gray-100 pt-2">
                                            {selectedMapPoint.origins.map((origin) => (
                                                <div key={origin.id} className="flex items-start justify-between gap-3 text-xs">
                                                    <span className="min-w-0 flex-1 text-gray-600">{origin.label}</span>
                                                    <span className="shrink-0 font-semibold tabular-nums text-gray-900">
                                                        {formatMeasure(origin.filteredUses)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </Popup>
                        )}
                        {selectedSchool && (
                            <Popup
                                longitude={selectedSchool.longitude}
                                latitude={selectedSchool.latitude}
                                anchor="bottom"
                                offset={24}
                                closeButton
                                closeOnClick={false}
                                onClose={() => setSelectedSchoolId(null)}
                            >
                                <div className="max-w-[260px] p-1">
                                    <div className="font-bold text-gray-900">{selectedSchool.name}</div>
                                    <div className="mt-1 text-xs font-semibold text-gray-500">{selectedSchool.board}</div>
                                    <p className="mt-1 text-xs text-gray-600">School shown for planning context; pass uses are not assigned to this school.</p>
                                </div>
                            </Popup>
                        )}
                    </MapBase>

                    {status !== 'ready' && (
                        <div className="absolute inset-0 grid place-items-center bg-white/90 p-6 backdrop-blur-sm">
                            <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-lg">
                                {isReadingWorkbook || status === 'loading' ? (
                                    <>
                                        <Loader2 className="mx-auto h-9 w-9 animate-spin text-blue-600" />
                                        <h3 className="mt-3 text-base font-bold text-gray-900">{isReadingWorkbook ? 'Reading starting locations' : 'Locating starting locations'}</h3>
                                        <p className="mt-2 text-sm text-gray-600">
                                            {isReadingWorkbook
                                                ? 'Processing the selected workbook locally.'
                                                : `${number.format(progress.completed)} of ${number.format(progress.total)} locations checked.`}
                                        </p>
                                    </>
                                ) : !exactData ? (
                                    <>
                                        <Upload className="mx-auto h-10 w-10 text-blue-600" />
                                        <h3 className="mt-3 text-base font-bold text-gray-900">Choose the source workbook</h3>
                                        <p className="mt-2 text-sm leading-relaxed text-gray-600">
                                            Starting locations are read from a workbook selected on this device. The workbook can be saved in this browser for future visits.
                                        </p>
                                        {workbookError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{workbookError}</p>}
                                        <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                                            <Upload size={16} />
                                            Choose workbook
                                            <input
                                                type="file"
                                                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                                className="sr-only"
                                                onChange={(event) => {
                                                    const file = event.target.files?.[0];
                                                    if (file) chooseSourceFile(file);
                                                    event.currentTarget.value = '';
                                                }}
                                            />
                                        </label>
                                    </>
                                ) : (
                                    <>
                                        <MapPin className="mx-auto h-10 w-10 text-blue-600" />
                                        <h3 className="mt-3 text-base font-bold text-gray-900">The usage map could not be built</h3>
                                        <p className="mt-2 text-sm leading-relaxed text-gray-600">
                                            The app automatically checks {number.format(exactData.origins.length)} starting-location labels against GTFS stops or Mapbox. Generated map coordinates are not saved.
                                        </p>
                                        {mapError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{mapError}</p>}
                                        <button type="button" onClick={() => void buildUsageMap(exactData)} className="mt-5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                                            Try again
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {status === 'ready' && (
                        <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-lg border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                            <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                                {mapView === 'bubbles' ? <MapPin size={16} className="text-blue-600" /> : <Layers3 size={16} className="text-blue-600" />}
                                {mapView === 'bubbles' ? 'Starting locations' : 'Usage heat map'}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-gray-600">
                                {formatMeasure(mappedUses)} {valueMode === 'average' ? 'average daily' : 'filtered'} uses mapped. {mapView === 'bubbles' ? 'Nearby points are grouped; click a cluster to zoom in.' : 'Warmer areas represent more use.'}
                            </p>
                            <p className="mt-1 text-xs text-gray-500"><GraduationCap className="mr-1 inline h-3.5 w-3.5" />School icons provide planning context.</p>
                            {failedCount > 0 && <p className="mt-1 text-xs text-amber-700">{number.format(failedCount)} locations could not be located.</p>}
                        </div>
                    )}
                </div>

                <div className="space-y-5">
                    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-bold text-gray-900">Top starting locations</h2>
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">Uses, not riders</span>
                        </div>
                        <div className="mt-4 space-y-2">
                            {filteredOrigins.slice(0, 10).map(({ origin, filteredUses: uses }, index) => (
                                <button
                                    key={origin.id}
                                    type="button"
                                    disabled={!geocodes[origin.id]}
                                    onClick={() => {
                                        const pointId = originPointIds.get(origin.id);
                                        if (pointId) focusMapPoint(pointId, true);
                                    }}
                                    className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left enabled:hover:border-blue-200 enabled:hover:bg-blue-50/50 disabled:cursor-default"
                                >
                                    <span className="w-5 text-xs font-bold tabular-nums text-gray-400">{index + 1}</span>
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800" title={origin.label}>{origin.label}</span>
                                    <span className="text-sm font-bold tabular-nums text-gray-900">{formatMeasure(uses)}</span>
                                </button>
                            ))}
                            {!exactData && <p className="py-6 text-center text-xs text-gray-500">Choose the workbook to list starting locations.</p>}
                        </div>
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
                        <div className="flex gap-3">
                            <Clock3 size={18} className="mt-0.5 shrink-0 text-blue-700" />
                            <div>
                                <div className="text-sm font-bold">Time interpretation</div>
                                <p className="mt-1 text-xs leading-relaxed text-blue-900">{snapshot.serviceMirroring.originUsage.timestampAssumption}</p>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex gap-3">
                            <Info size={18} className="mt-0.5 shrink-0 text-gray-500" />
                            <div>
                                <div className="text-sm font-bold text-gray-900">Planning context</div>
                                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                                    Starting locations help build the usage map. They do not prove a student&apos;s home, school, identity, or unique rider location.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};
