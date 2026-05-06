import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import { ArrowLeft, Building2, CheckCircle2, Download, FileSpreadsheet, Loader2, MapPin, RefreshCw, Upload, AlertTriangle, Search } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { MapBase } from '../shared';
import permitCartoonIcon from '../../assets/residential-growth/icons/permit-cartoon.png';
import occupiedCartoonIcon from '../../assets/residential-growth/icons/occupied-cartoon.png';
import concentrationCartoonIcon from '../../assets/residential-growth/icons/concentration-cartoon.png';
import { parseIssuanceListing, parseOccupancyCertificate } from '../../utils/residential-growth/parser';
import {
    geocodeResidentialGrowthRecords,
    createEmptyResidentialGrowthGeocodeCache,
} from '../../utils/residential-growth/geocoder';
import {
    getResidentialGrowthDatasets,
    loadResidentialGrowthGeocodeCache,
    saveResidentialGrowthDataset,
    saveResidentialGrowthGeocodeCache,
} from '../../utils/residential-growth/service';
import {
    buildResidentialGrowthRange,
    getResidentialGrowthMonthOptions,
    periodFromText,
    RESIDENTIAL_GROWTH_DATE_RANGE_OPTIONS,
} from '../../utils/residential-growth/filters';
import type { ResidentialGrowthLayer, ResidentialGrowthMonthlyDataset, ResidentialGrowthRecord } from '../../utils/residential-growth/types';
import type { ResidentialGrowthDateRangePreset } from '../../utils/residential-growth/filters';

interface ResidentialGrowthWorkspaceProps {
    teamId: string;
    userId: string;
    data: ResidentialGrowthMonthlyDataset | null;
    onBack: () => void;
    onSaved: (dataset: ResidentialGrowthMonthlyDataset) => void;
}

const BARRIE_CENTER = { longitude: -79.69, latitude: 44.38 };

type ActiveTab = ResidentialGrowthLayer;
type AccuracyFilter = 'all' | 'exact' | 'approximate';

function formatRangeLabel(fromDate?: string, toDate?: string): string {
    if (!toDate) return 'No dated records';
    const formatDate = (value: string) => {
        const date = new Date(`${value}T12:00:00`);
        return Number.isNaN(date.getTime())
            ? value
            : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };
    if (!fromDate) return `Through ${formatDate(toDate)}`;
    return `${formatDate(fromDate)} – ${formatDate(toDate)}`;
}

function formatMonthLabel(period: string): string {
    const date = new Date(`${period}-01T12:00:00`);
    return Number.isNaN(date.getTime())
        ? period
        : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatPeriodRangeLabel(periods: string[]): string {
    if (periods.length === 0) return 'No uploaded months';
    const sorted = [...periods].sort();
    if (sorted.length === 1) return formatMonthLabel(sorted[0]);
    return `${formatMonthLabel(sorted[0])} – ${formatMonthLabel(sorted.at(-1)!)}`;
}

function recordDateLabel(tab: ActiveTab): string {
    return tab === 'issued' ? 'Issued' : 'Inspected';
}

function layerLabel(tab: ActiveTab): string {
    return tab === 'issued' ? 'Issued / planned' : 'Occupied / completed';
}

function pointColor(tab: ActiveTab): string {
    return tab === 'issued' ? '#2563eb' : '#16a34a';
}

function emptyDataset(userId: string): ResidentialGrowthMonthlyDataset {
    const period = new Date().toISOString().slice(0, 7);
    return {
        schemaVersion: 1,
        period,
        issued: [],
        occupied: [],
        metadata: {
            importedAt: new Date().toISOString(),
            importedBy: userId,
        },
    };
}

function recordPeriod(record: ResidentialGrowthRecord): string | undefined {
    return /^\d{4}-\d{2}-\d{2}$/.test(record.date) ? record.date.slice(0, 7) : undefined;
}

function periodFromRecords(records: ResidentialGrowthRecord[], fallback?: string): string {
    return records.map(recordPeriod).filter((period): period is string => !!period).sort().at(-1) ?? fallback ?? new Date().toISOString().slice(0, 7);
}

function mergeRecords(records: ResidentialGrowthRecord[]): ResidentialGrowthRecord[] {
    const byKey = new Map<string, ResidentialGrowthRecord>();
    records.forEach((record) => {
        byKey.set(`${record.layer}|${record.fileNumber}|${record.address}|${record.date}|${record.units}`.toLowerCase(), record);
    });
    return Array.from(byKey.values()).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.address.localeCompare(b.address));
}

function mergeMonthlyDataset(base: ResidentialGrowthMonthlyDataset | undefined, patch: ResidentialGrowthMonthlyDataset): ResidentialGrowthMonthlyDataset {
    if (!base) return patch;
    return {
        ...base,
        period: patch.period || base.period,
        issued: mergeRecords([...base.issued, ...patch.issued]),
        occupied: mergeRecords([...base.occupied, ...patch.occupied]),
        metadata: {
            ...base.metadata,
            ...patch.metadata,
            issuedFileName: patch.metadata.issuedFileName ?? base.metadata.issuedFileName,
            occupiedFileName: patch.metadata.occupiedFileName ?? base.metadata.occupiedFileName,
            issuedImportedAt: patch.metadata.issuedImportedAt ?? base.metadata.issuedImportedAt,
            occupiedImportedAt: patch.metadata.occupiedImportedAt ?? base.metadata.occupiedImportedAt,
        },
    };
}

function mergeDatasetsByPeriod(datasets: ResidentialGrowthMonthlyDataset[]): ResidentialGrowthMonthlyDataset[] {
    const byPeriod = new Map<string, ResidentialGrowthMonthlyDataset>();
    datasets.forEach((entry) => {
        if (entry.issued.length === 0 && entry.occupied.length === 0) return;
        byPeriod.set(entry.period, mergeMonthlyDataset(byPeriod.get(entry.period), entry));
    });
    return Array.from(byPeriod.values()).sort((a, b) => (b.metadata.importedAt || '').localeCompare(a.metadata.importedAt || ''));
}

function coordinateKey(record: ResidentialGrowthRecord): string {
    if (!record.geocode) return '';
    return `${record.geocode.lon.toFixed(6)},${record.geocode.lat.toFixed(6)}`;
}

function getAddressNumber(address: string): string | null {
    return address.trim().match(/^\d+[A-Z]?/i)?.[0]?.toLowerCase() ?? null;
}

function isApproximateGeocode(record: ResidentialGrowthRecord): boolean {
    if (!record.geocode) return true;
    const number = getAddressNumber(record.address);
    if (!number) return record.geocode.confidence !== 'high';
    return !record.geocode.displayName.toLowerCase().includes(number);
}

function groupRecordsByCoordinate(records: ResidentialGrowthRecord[]): ResidentialGrowthRecord[][] {
    const grouped = new Map<string, ResidentialGrowthRecord[]>();
    records.filter((record) => record.geocode).forEach((record) => {
        const key = coordinateKey(record);
        grouped.set(key, [...(grouped.get(key) ?? []), record]);
    });
    return Array.from(grouped.values());
}

function totalUnits(records: ResidentialGrowthRecord[]): number {
    return records.reduce((sum, record) => sum + record.units, 0);
}

function groupUnits(records: ResidentialGrowthRecord[]): number {
    return records.reduce((sum, record) => sum + record.units, 0);
}

function groupLabel(group: ResidentialGrowthRecord[]): string {
    const record = group[0];
    if (!record) return 'Unknown location';
    return group.length > 1 ? (record.geocode?.displayName || record.address) : record.address;
}

function compactBarrieLabel(label: string): string {
    return label.split(',')[0]?.trim() || label;
}

function sortGroupsByUnits(groups: ResidentialGrowthRecord[][]): ResidentialGrowthRecord[][] {
    return [...groups].sort((a, b) => groupUnits(b) - groupUnits(a) || b.length - a.length || groupLabel(a).localeCompare(groupLabel(b)));
}

function formatPercent(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return 'N/A';
    return `${Math.round(value)}%`;
}

function makeFeatureCollection(records: ResidentialGrowthRecord[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
    return {
        type: 'FeatureCollection',
        features: groupRecordsByCoordinate(records).map((group) => {
            const record = group[0];
            const totalUnits = group.reduce((sum, entry) => sum + entry.units, 0);
            return ({
                type: 'Feature',
                properties: {
                    id: record.id,
                    fileNumber: record.fileNumber,
                    address: group.length > 1 ? `${group.length} records near ${record.geocode!.displayName}` : record.address,
                    units: totalUnits,
                    recordCount: group.length,
                    category: record.subtype || record.category,
                    date: record.date,
                    coordinateKey: coordinateKey(record),
                    stackCount: group.length,
                    stackLabel: group.length > 1 ? String(group.length) : '',
                },
                geometry: {
                    type: 'Point',
                    coordinates: [record.geocode!.lon, record.geocode!.lat],
                },
            });
        }),
    };
}

function makeSpiderFeatureCollection(group: ResidentialGrowthRecord[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
    if (group.length <= 1 || !group[0]?.geocode) return { type: 'FeatureCollection', features: [] };
    const center = group[0].geocode;
    const radius = Math.min(0.0022, 0.00075 + group.length * 0.000035);
    return {
        type: 'FeatureCollection',
        features: group.map((record, index) => {
            const angle = (Math.PI * 2 * index) / group.length;
            return {
                type: 'Feature',
                properties: {
                    id: record.id,
                    fileNumber: record.fileNumber,
                    address: record.address,
                    units: record.units,
                },
                geometry: {
                    type: 'Point',
                    coordinates: [
                        center.lon + Math.cos(angle) * radius,
                        center.lat + Math.sin(angle) * radius,
                    ],
                },
            };
        }),
    };
}

function makeSpiderLineCollection(group: ResidentialGrowthRecord[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
    if (group.length <= 1 || !group[0]?.geocode) return { type: 'FeatureCollection', features: [] };
    const center = group[0].geocode;
    const points = makeSpiderFeatureCollection(group).features;
    return {
        type: 'FeatureCollection',
        features: points.map((point) => ({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: [[center.lon, center.lat], point.geometry.coordinates],
            },
        })),
    };
}

const mapLayerStyle = (tab: ActiveTab): LayerProps => ({
    id: `residential-growth-${tab}-points`,
    type: 'circle',
    filter: ['!', ['has', 'point_count']],
    paint: {
        'circle-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'units'], 1],
            1, '#16a34a',
            10, '#84cc16',
            25, '#eab308',
            75, '#f97316',
            125, '#dc2626',
        ],
        'circle-opacity': 0.82,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-radius': [
            'interpolate', ['linear'], ['coalesce', ['get', 'units'], 1],
            1, 7,
            10, 12,
            50, 20,
            125, 30,
        ],
    },
});

const clusterLayerStyle = (tab: ActiveTab): LayerProps => ({
    id: `residential-growth-${tab}-clusters`,
    type: 'circle',
    filter: ['has', 'point_count'],
    paint: {
        'circle-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'units_sum'], ['get', 'point_count'], 1],
            1, '#16a34a',
            10, '#84cc16',
            25, '#eab308',
            75, '#f97316',
            125, '#dc2626',
        ],
        'circle-opacity': 0.9,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
        'circle-radius': [
            'interpolate', ['linear'], ['coalesce', ['get', 'units_sum'], ['get', 'point_count'], 1],
            1, 16,
            25, 22,
            75, 30,
            125, 38,
        ],
    },
});

const clusterCountLayerStyle = (tab: ActiveTab): LayerProps => ({
    id: `residential-growth-${tab}-cluster-counts`,
    type: 'symbol',
    filter: ['has', 'point_count'],
    layout: {
        'text-field': ['to-string', ['round', ['coalesce', ['get', 'units_sum'], ['get', 'point_count']]]],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 13,
        'text-allow-overlap': true,
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#374151',
        'text-halo-width': 1,
    },
});

const stackLabelLayerStyle = (tab: ActiveTab): LayerProps => ({
    id: `residential-growth-${tab}-stack-labels`,
    type: 'symbol',
    filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'stackCount'], 1]],
    layout: {
        'text-field': ['get', 'stackLabel'],
        'text-size': 12,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': pointColor(tab),
        'text-halo-width': 1,
    },
});

const spiderLineLayerStyle = (tab: ActiveTab): LayerProps => ({
    id: `residential-growth-${tab}-spider-lines`,
    type: 'line',
    paint: {
        'line-color': pointColor(tab),
        'line-opacity': 0.45,
        'line-width': 1.5,
    },
});

const spiderPointLayerStyle = (tab: ActiveTab): LayerProps => ({
    id: `residential-growth-${tab}-spider-points`,
    type: 'circle',
    paint: {
        'circle-color': '#ffffff',
        'circle-opacity': 0.98,
        'circle-stroke-color': pointColor(tab),
        'circle-stroke-width': 3,
        'circle-radius': 7,
    },
});

const UploadButton: React.FC<{
    label: string;
    helper: string;
    busy: boolean;
    onFile: (file: File) => void;
}> = ({ label, helper, busy, onFile }) => (
    <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40">
        <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                event.currentTarget.value = '';
            }}
        />
        <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Upload size={18} /></div>
            <div>
                <div className="font-extrabold text-gray-900">{label}</div>
                <div className="mt-1 text-xs font-semibold leading-relaxed text-gray-500">{helper}</div>
            </div>
        </div>
    </label>
);

function loadImageDataUrl(src: string): Promise<string> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context) {
                resolve('');
                return;
            }
            context.drawImage(image, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => resolve('');
        image.src = src;
    });
}

export const ResidentialGrowthWorkspace: React.FC<ResidentialGrowthWorkspaceProps> = ({ teamId, userId, data, onBack, onSaved }) => {
    const [dataset, setDataset] = useState<ResidentialGrowthMonthlyDataset>(() => data ?? emptyDataset(userId));
    const [uploadedDatasets, setUploadedDatasets] = useState<ResidentialGrowthMonthlyDataset[]>(() => data ? [data] : []);
    const [activeTab, setActiveTab] = useState<ActiveTab>('issued');
    const [busyText, setBusyText] = useState<string>('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [error, setError] = useState<string>('');
    const [searchText, setSearchText] = useState('');
    const [subtypeFilter, setSubtypeFilter] = useState('all');
    const [dateRangePreset, setDateRangePreset] = useState<ResidentialGrowthDateRangePreset>('latest-month');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [accuracyFilter, setAccuracyFilter] = useState<AccuracyFilter>('all');
    const [expandedStackKey, setExpandedStackKey] = useState<string | null>(null);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [showImports, setShowImports] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const mapRef = useRef<MapRef | null>(null);

    const rangeSourceDatasets = useMemo(() => mergeDatasetsByPeriod([dataset, ...uploadedDatasets]), [dataset, uploadedDatasets]);
    const monthOptions = useMemo(() => getResidentialGrowthMonthOptions(rangeSourceDatasets), [rangeSourceDatasets]);
    const rangeResult = useMemo(() => buildResidentialGrowthRange(rangeSourceDatasets, dateRangePreset, selectedMonth), [dateRangePreset, rangeSourceDatasets, selectedMonth]);
    const rangeLabel = rangeResult.periods.length > 0 ? formatPeriodRangeLabel(rangeResult.periods) : formatRangeLabel(rangeResult.fromDate, rangeResult.toDate);
    const activeRecords = activeTab === 'issued' ? rangeResult.issued : rangeResult.occupied;
    const subtypeOptions = useMemo(() => Array.from(new Set(activeRecords.map((record) => record.subtype || record.workProposed || record.category).filter(Boolean))).sort(), [activeRecords]);
    const filteredActiveRecords = useMemo(() => {
        const query = searchText.trim().toLowerCase();
        return activeRecords.filter((record) => {
            const label = record.subtype || record.workProposed || record.category;
            if (query && !`${record.address} ${record.fileNumber} ${label}`.toLowerCase().includes(query)) return false;
            if (subtypeFilter !== 'all' && label !== subtypeFilter) return false;
            if (dateFrom && record.date && record.date < dateFrom) return false;
            if (dateTo && record.date && record.date > dateTo) return false;
            if (accuracyFilter === 'exact' && isApproximateGeocode(record)) return false;
            if (accuracyFilter === 'approximate' && !isApproximateGeocode(record)) return false;
            return true;
        });
    }, [activeRecords, accuracyFilter, dateFrom, dateTo, searchText, subtypeFilter]);
    const selectedRecord = selectedId ? filteredActiveRecords.find((record) => record.id === selectedId) ?? null : null;
    const selectedGroup = selectedRecord?.geocode
        ? filteredActiveRecords.filter((record) => coordinateKey(record) === coordinateKey(selectedRecord))
        : selectedRecord ? [selectedRecord] : [];
    const expandedGroup = useMemo(() => expandedStackKey
        ? filteredActiveRecords.filter((record) => coordinateKey(record) === expandedStackKey)
        : [], [expandedStackKey, filteredActiveRecords]);
    const geoJson = useMemo(() => makeFeatureCollection(filteredActiveRecords), [filteredActiveRecords]);
    const spiderGeoJson = useMemo(() => makeSpiderFeatureCollection(expandedGroup), [expandedGroup]);
    const spiderLineGeoJson = useMemo(() => makeSpiderLineCollection(expandedGroup), [expandedGroup]);
    const ungeocoded = filteredActiveRecords.filter((record) => !record.geocode);
    const issuedUnits = totalUnits(rangeResult.issued);
    const occupiedUnits = totalUnits(rangeResult.occupied);
    const filteredUnits = totalUnits(filteredActiveRecords);
    const mapTitle = activeTab === 'issued' ? 'Issued Permits' : 'Occupied Units';
    const totalMetricLabel = activeTab === 'issued' ? 'Permits' : 'Occupied units';
    const totalMetricValue = activeTab === 'issued'
        ? filteredActiveRecords.length.toLocaleString()
        : filteredUnits.toLocaleString();
    const pipelineUnits = Math.max(0, issuedUnits - occupiedUnits);
    const completionRate = issuedUnits > 0 ? (occupiedUnits / issuedUnits) * 100 : null;
    const activeConcentrationGroups = useMemo(() => sortGroupsByUnits(groupRecordsByCoordinate(filteredActiveRecords)).slice(0, 6), [filteredActiveRecords]);

    useEffect(() => {
        if (!data) return;
        setDataset(data);
        setUploadedDatasets((current) => current.length > 0 ? current : [data]);
        setSelectedId(null);
        setExpandedStackKey(null);
    }, [data]);

    useEffect(() => {
        let cancelled = false;
        setLoadingHistory(true);
        getResidentialGrowthDatasets(teamId)
            .then((datasets) => {
                if (!cancelled && datasets.length > 0) setUploadedDatasets(datasets);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Residential Growth import history.');
            })
            .finally(() => {
                if (!cancelled) setLoadingHistory(false);
            });
        return () => { cancelled = true; };
    }, [teamId]);

    useEffect(() => {
        const timer = window.setTimeout(() => fitToRecords(filteredActiveRecords), 120);
        return () => window.clearTimeout(timer);
    }, [activeTab, filteredActiveRecords]);

    useEffect(() => {
        if (monthOptions.length === 0) {
            if (selectedMonth) setSelectedMonth('');
            return;
        }
        if (!selectedMonth || !monthOptions.some((option) => option.value === selectedMonth)) {
            setSelectedMonth(monthOptions[0].value);
        }
    }, [monthOptions, selectedMonth]);

    useEffect(() => {
        setExpandedStackKey(null);
    }, [activeTab, searchText, subtypeFilter, dateRangePreset, selectedMonth, dateFrom, dateTo, accuracyFilter]);

    const fitToRecords = (records: ResidentialGrowthRecord[]) => {
        const points = records.filter((record) => record.geocode).map((record) => record.geocode!);
        if (points.length === 0) return;
        const lons = points.map((point) => point.lon);
        const lats = points.map((point) => point.lat);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        mapRef.current?.getMap().fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 70, maxZoom: 15, duration: 600 });
    };

    const handleSelectGroup = (group: ResidentialGrowthRecord[]) => {
        const first = group[0];
        if (!first) return;
        if (selectedGroup.length > 0 && coordinateKey(selectedGroup[0]) === coordinateKey(first)) {
            setSelectedId(null);
            setExpandedStackKey(null);
            return;
        }
        setSelectedId(first.id);
        setExpandedStackKey(group.length > 1 ? coordinateKey(first) : null);
        fitToRecords(group);
    };

    const geocodeAndSet = async (records: ResidentialGrowthRecord[], layer: ActiveTab): Promise<ResidentialGrowthRecord[]> => {
        const cache = await loadResidentialGrowthGeocodeCache(teamId) ?? createEmptyResidentialGrowthGeocodeCache();
        const result = await geocodeResidentialGrowthRecords(records, cache, (done, total, address) => {
            setBusyText(total > 0 ? `Geocoding ${done}/${total}: ${address}` : 'Geocoding addresses...');
        });
        await saveResidentialGrowthGeocodeCache(teamId, result.cache);
        setTimeout(() => fitToRecords(result.records), 200);
        if (result.failed.length > 0) {
            setError(`${result.failed.length} ${layer === 'issued' ? 'issued' : 'occupied'} address(es) need review.`);
        }
        return result.records;
    };

    const handleFile = async (file: File, layer: ActiveTab) => {
        setError('');
        setBusyText(`Reading ${file.name}...`);
        try {
            const buffer = await file.arrayBuffer();
            const parseResult = layer === 'issued' ? parseIssuanceListing(buffer) : parseOccupancyCertificate(buffer);
            if (parseResult.records.length === 0) throw new Error(parseResult.warnings.join(' ') || 'No usable records found.');
            setBusyText(`Found ${parseResult.records.length} records. Preparing map points...`);
            const geocodedRecords = await geocodeAndSet(parseResult.records, layer);
            const importTime = new Date().toISOString();
            const period = periodFromText(file.name) || parseResult.period || periodFromRecords(geocodedRecords, dataset.period);
            const monthlyDataset: ResidentialGrowthMonthlyDataset = {
                schemaVersion: 1,
                period,
                issued: layer === 'issued' ? geocodedRecords : [],
                occupied: layer === 'occupied' ? geocodedRecords : [],
                metadata: {
                    importedAt: importTime,
                    importedBy: userId,
                    issuedFileName: layer === 'issued' ? file.name : undefined,
                    occupiedFileName: layer === 'occupied' ? file.name : undefined,
                    issuedImportedAt: layer === 'issued' ? importTime : undefined,
                    occupiedImportedAt: layer === 'occupied' ? importTime : undefined,
                },
            };
            const mergedForPeriod = mergeMonthlyDataset(rangeSourceDatasets.find((entry) => entry.period === period), monthlyDataset);
            const datasetToSave: ResidentialGrowthMonthlyDataset = {
                ...mergedForPeriod,
                metadata: {
                    ...mergedForPeriod.metadata,
                    importedAt: new Date().toISOString(),
                    importedBy: userId,
                },
            };
            setDataset(datasetToSave);
            setSelectedMonth(period);
            setActiveTab(layer);
            setSelectedId(geocodedRecords[0]?.id ?? null);
            setBusyText(`Saving ${file.name} to Firebase...`);
            await saveResidentialGrowthDataset(teamId, userId, datasetToSave);
            setUploadedDatasets((current) => mergeDatasetsByPeriod([datasetToSave, ...current]));
            onSaved(datasetToSave);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Import or auto-save failed.');
        } finally {
            setBusyText('');
        }
    };

    const handleMapClick = (event: MapMouseEvent) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (clusterId != null && feature?.geometry.type === 'Point' && 'coordinates' in feature.geometry) {
            const coordinates = feature.geometry.coordinates as [number, number];
            const source = mapRef.current?.getMap().getSource(`residential-growth-${activeTab}-source`) as {
                getClusterExpansionZoom?: (clusterId: number, callback: (error: Error | null, zoom: number) => void) => void;
            } | undefined;
            source?.getClusterExpansionZoom?.(Number(clusterId), (clusterError, zoom) => {
                if (clusterError) return;
                mapRef.current?.getMap().easeTo({
                    center: coordinates,
                    zoom,
                    duration: 450,
                });
            });
            return;
        }

        const id = typeof feature?.properties?.id === 'string' ? feature.properties.id : undefined;
        if (!id) return;
        setSelectedId(id);
        const stackCount = Number(feature?.properties?.stackCount || 0);
        const key = typeof feature?.properties?.coordinateKey === 'string' ? feature.properties.coordinateKey : null;
        setExpandedStackKey(stackCount > 1 ? key : null);
    };

    const exportPdf = async () => {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 6;
        const mapX = margin;
        const mapY = margin;
        const mapW = pageWidth - margin * 2;
        const mapH = 145;
        const blue = [15, 82, 176];
        const navy = [15, 23, 42];
        const muted = [75, 85, 99];
        const lightBorder = [209, 213, 219];
        const cardFill = [255, 255, 255];
        const accent = activeTab === 'issued' ? blue : [5, 150, 105];
        const metricNoun = activeTab === 'issued' ? 'permits' : 'occupied units';
        const recordNoun = activeTab === 'issued' ? 'permit' : 'occupancy';
        const exportDate = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const filterChips = [
            layerLabel(activeTab),
            rangeLabel,
            `${rangeResult.periodCount || 0} month${rangeResult.periodCount === 1 ? '' : 's'}`,
            subtypeFilter === 'all' ? 'All residential types' : subtypeFilter,
            accuracyFilter === 'all' ? 'All geocodes' : accuracyFilter === 'exact' ? 'Exact geocodes only' : 'Approximate geocodes',
        ].filter(Boolean);
        const extraFilterNote = [
            dateFrom || dateTo ? `${dateFrom || 'Start'} to ${dateTo || 'Today'}` : '',
            searchText.trim() ? `Search: ${searchText.trim()}` : '',
        ].filter(Boolean).join(' · ');

        const pdfText = (value: string): string => value
            .replace(/[\u2010-\u2015]/g, '-')
            .replace(/[\u2022\u00b7]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();

        const setColor = (color: number[]) => doc.setTextColor(color[0], color[1], color[2]);
        const setFill = (color: number[]) => doc.setFillColor(color[0], color[1], color[2]);
        const setDraw = (color: number[]) => doc.setDrawColor(color[0], color[1], color[2]);

        const drawText = (
            value: string,
            x: number,
            y: number,
            size: number,
            style: 'normal' | 'bold' | 'italic' = 'normal',
            color: number[] = navy,
            options?: { maxWidth?: number; align?: 'left' | 'center' | 'right' },
        ) => {
            doc.setFont('helvetica', style);
            doc.setFontSize(size);
            setColor(color);
            doc.text(pdfText(value), x, y, options);
        };

        const drawCard = (x: number, y: number, w: number, h: number, radius = 2.5) => {
            setFill([226, 232, 240]);
            doc.roundedRect(x + 0.9, y + 0.9, w, h, radius, radius, 'F');
            setFill(cardFill);
            setDraw(lightBorder);
            doc.roundedRect(x, y, w, h, radius, radius, 'FD');
        };

        const drawChipIcon = (kind: 'calendar' | 'home' | 'pin', x: number, y: number, color: number[]) => {
            setDraw(color);
            doc.setLineWidth(0.35);
            if (kind === 'calendar') {
                doc.roundedRect(x, y - 3, 3.3, 3.3, 0.35, 0.35, 'S');
                doc.line(x, y - 2, x + 3.3, y - 2);
                doc.line(x + 0.8, y - 3.5, x + 0.8, y - 2.6);
                doc.line(x + 2.5, y - 3.5, x + 2.5, y - 2.6);
            } else if (kind === 'home') {
                doc.line(x, y - 1.4, x + 1.7, y - 3.2);
                doc.line(x + 1.7, y - 3.2, x + 3.4, y - 1.4);
                doc.rect(x + 0.6, y - 1.4, 2.2, 2.1, 'S');
            } else {
                doc.circle(x + 1.6, y - 1.9, 1.25, 'S');
                doc.circle(x + 1.6, y - 1.9, 0.35, 'S');
                doc.line(x + 1.6, y - 0.6, x + 1.6, y + 0.9);
            }
        };

        const drawChip = (label: string, x: number, y: number, width: number, active = false, icon?: 'calendar' | 'home' | 'pin') => {
            const text = pdfText(label);
            setFill(active ? accent : [255, 255, 255]);
            setDraw(active ? accent : lightBorder);
            doc.roundedRect(x, y, width, 8.2, 2.2, 2.2, 'FD');
            if (icon) drawChipIcon(icon, x + 3.6, y + 5.5, active ? [255, 255, 255] : accent);
            drawText(text.length > 29 ? `${text.slice(0, 26)}...` : text, x + (icon ? 10 : 4.5), y + 5.6, 7.2, active ? 'bold' : 'normal', active ? [255, 255, 255] : [55, 65, 81], { maxWidth: width - (icon ? 12 : 7) });
            return width;
        };

        const drawBuildingGlyph = (x: number, y: number, color: number[]) => {
            setDraw(color);
            doc.setLineWidth(0.35);
            doc.rect(x, y + 3.2, 6, 7, 'S');
            doc.rect(x + 7.3, y, 5.4, 10.2, 'S');
            for (let row = 0; row < 2; row += 1) {
                for (let col = 0; col < 2; col += 1) {
                    doc.rect(x + 1.2 + col * 2.2, y + 4.5 + row * 2.2, 0.7, 0.7, 'F');
                }
            }
            for (let row = 0; row < 3; row += 1) {
                doc.rect(x + 8.6, y + 1.8 + row * 2.2, 0.8, 0.8, 'F');
                doc.rect(x + 10.6, y + 1.8 + row * 2.2, 0.8, 0.8, 'F');
            }
        };

        const [headerIconDataUrl, concentrationIconDataUrl] = await Promise.all([
            loadImageDataUrl(activeTab === 'issued' ? permitCartoonIcon : occupiedCartoonIcon),
            loadImageDataUrl(concentrationCartoonIcon),
        ]);

        const canvas = mapRef.current?.getMap().getCanvas();
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        if (canvas) {
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = 1800;
            exportCanvas.height = 980;
            const context = exportCanvas.getContext('2d');
            if (context) {
                const sourceAspect = canvas.width / canvas.height;
                const targetAspect = exportCanvas.width / exportCanvas.height;
                let sx = 0;
                let sy = 0;
                let sw = canvas.width;
                let sh = canvas.height;
                if (sourceAspect > targetAspect) {
                    sw = canvas.height * targetAspect;
                    sx = (canvas.width - sw) / 2;
                } else {
                    sh = canvas.width / targetAspect;
                    sy = (canvas.height - sh) / 2;
                }
                context.drawImage(canvas, sx, sy, sw, sh, 0, 0, exportCanvas.width, exportCanvas.height);
                doc.addImage(exportCanvas.toDataURL('image/png'), 'PNG', mapX, mapY, mapW, mapH);
            } else {
                doc.addImage(canvas.toDataURL('image/png'), 'PNG', mapX, mapY, mapW, mapH);
            }
        }
        setDraw([226, 232, 240]);
        doc.setLineWidth(0.35);
        doc.roundedRect(mapX, mapY, mapW, mapH, 3, 3, 'S');

        const headerX = mapX + 6;
        const headerY = mapY + 6;
        const headerW = 88;
        const headerH = extraFilterNote ? 96 : 88;
        drawCard(headerX, headerY, headerW, headerH, 2.5);
        if (headerIconDataUrl) {
            doc.addImage(headerIconDataUrl, 'PNG', headerX + headerW - 22, headerY + 6, 15, 15);
        }
        drawText(mapTitle, headerX + 5.5, headerY + 13.5, 18, 'bold', navy);
        drawText('Standalone filtered map export', headerX + 5.5, headerY + 22, 8, 'italic', [55, 65, 81]);
        setDraw([203, 213, 225]);
        doc.line(headerX + 5.5, headerY + 27, headerX + headerW - 5.5, headerY + 27);
        drawText(totalMetricValue, headerX + 5.5, headerY + 43, 24, 'bold', accent);
        drawText(`${metricNoun} shown`, headerX + 30, headerY + 42.2, 9.5, 'bold', navy);
        drawText(`${filteredActiveRecords.length.toLocaleString()} records - ${filteredUnits.toLocaleString()} units - ${ungeocoded.length.toLocaleString()} needing geocode review`, headerX + 5.5, headerY + 51, 7.3, 'normal', muted, { maxWidth: headerW - 11 });
        const chipY = headerY + 58;
        drawChip(filterChips[0] ?? layerLabel(activeTab), headerX + 5.5, chipY, 29, true);
        drawChip(filterChips[1] ?? rangeLabel, headerX + 37.5, chipY, 45, false, 'calendar');
        drawChip(filterChips[2] ?? '1 month', headerX + 5.5, chipY + 10.5, 28, false, 'calendar');
        drawChip(filterChips[3] ?? 'All residential types', headerX + 36.5, chipY + 10.5, 46, false, 'home');
        drawChip(filterChips[4] ?? 'All geocodes', headerX + 5.5, chipY + 21, 34, false, 'pin');
        if (extraFilterNote) {
            drawText(extraFilterNote, headerX + 42, chipY + 26.6, 6.5, 'normal', muted, { maxWidth: headerW - 48 });
        }

        const legendX = mapX + mapW - 64;
        const legendY = mapY + mapH - 36;
        drawCard(legendX, legendY, 58, 28, 2.5);
        drawText('Units scale', legendX + 29, legendY + 7.7, 8.2, 'bold', navy, { align: 'center' });
        const legendColors = ['#84cc16', '#a3c72b', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#dc2626'];
        legendColors.forEach((color, index) => {
            doc.setFillColor(color);
            doc.circle(legendX + 7.5 + index * 7.2, legendY + 15.5, 1.6 + index * 0.22, 'F');
        });
        drawText('Low', legendX + 5, legendY + 24, 6.5, 'normal', [31, 41, 55]);
        setDraw([148, 163, 184]);
        doc.line(legendX + 18, legendY + 22.5, legendX + 43, legendY + 22.5);
        doc.triangle(legendX + 43, legendY + 21, legendX + 43, legendY + 24, legendX + 46, legendY + 22.5, 'F');
        drawText('High', legendX + 53, legendY + 24, 6.5, 'normal', [31, 41, 55], { align: 'right' });

        const panelY = mapY + mapH + 6;
        const footerLineY = pageHeight - 13.5;
        const panelH = footerLineY - panelY - 5;
        setFill([255, 255, 255]);
        doc.rect(0, panelY - 1, pageWidth, pageHeight - panelY + 1, 'F');
        drawText('Top 3 visible concentrations', margin + 4, panelY + 7.5, 10, 'bold', blue);
        const cardY = panelY + 12;
        const cardW = 52;
        const cardH = 23.5;
        const rankColors = [[220, 38, 38], [249, 115, 22], [234, 179, 8]];
        activeConcentrationGroups.slice(0, 3).forEach((group, index) => {
            const x = margin + 4 + index * (cardW + 5);
            const units = groupUnits(group);
            const rankColor = rankColors[index];
            drawCard(x, cardY, cardW, cardH, 2.2);
            setFill(rankColor);
            doc.circle(x + 6, cardY + 6, 3.2, 'F');
            drawText(`${index + 1}`, x + 6, cardY + 7.2, 7.4, 'bold', [255, 255, 255], { align: 'center' });
            drawText(compactBarrieLabel(groupLabel(group)), x + 16, cardY + 8.8, 8.4, 'bold', navy, { maxWidth: cardW - 20 });
            setFill(index === 0 ? [254, 226, 226] : index === 1 ? [255, 237, 213] : [254, 243, 199]);
            doc.circle(x + 9, cardY + 17.2, 5.4, 'F');
            if (concentrationIconDataUrl) {
                doc.addImage(concentrationIconDataUrl, 'PNG', x + 3.2, cardY + 12.2, 12, 12);
            } else {
                drawBuildingGlyph(x + 5.7, cardY + 12.3, rankColor);
            }
            drawText(units.toLocaleString(), x + 19, cardY + 20, 14.5, 'bold', rankColor);
            drawText('units', x + 36, cardY + 20, 8, 'normal', [31, 41, 55]);
        });

        const dividerX = margin + 176;
        setDraw([203, 213, 225]);
        doc.line(dividerX, panelY + 7, dividerX, panelY + panelH - 3);
        const noteX = dividerX + 8;
        drawText('How to read this map', noteX, panelY + 8, 10, 'bold', blue);
        drawText(`Circles represent residential ${recordNoun} activity by project location. Circle size and colour indicate the number of units at each location. Green means fewer units; red means more units. Use this map to quickly identify areas of residential growth activity during the selected time period.`, noteX, panelY + 16, 7.4, 'normal', [31, 41, 55], { maxWidth: pageWidth - noteX - margin - 2 });
        drawText(`Issued: ${issuedUnits.toLocaleString()} units - Occupied: ${occupiedUnits.toLocaleString()} units - Pipeline: ${pipelineUnits.toLocaleString()} units - Completion: ${formatPercent(completionRate)}`, noteX, panelY + 37, 7.2, 'bold', navy, { maxWidth: pageWidth - noteX - margin - 2 });

        setDraw(blue);
        doc.setLineWidth(0.45);
        doc.line(margin, footerLineY, pageWidth - margin, footerLineY);
        drawText('Scheduler Residential Growth', margin + 3, pageHeight - 6.8, 7.2, 'italic', blue);
        drawText(`Exported ${exportDate}`, pageWidth - margin - 3, pageHeight - 6.8, 7.2, 'normal', blue, { align: 'right' });
        doc.save(`${mapTitle.toLowerCase().replace(/\s+/g, '-')}-${dateRangePreset}.pdf`);
    };

    return (
        <div className="relative h-full overflow-hidden bg-gray-950 text-gray-900">
            <MapBase
                mapRef={mapRef}
                mapStyle="mapbox://styles/mapbox/streets-v12"
                longitude={BARRIE_CENTER.longitude}
                latitude={BARRIE_CENTER.latitude}
                zoom={11.5}
                preserveDrawingBuffer
                showNavigation
                showScale
                interactiveLayerIds={[
                    `residential-growth-${activeTab}-spider-points`,
                    `residential-growth-${activeTab}-clusters`,
                    `residential-growth-${activeTab}-points`,
                ]}
                onClick={handleMapClick}
                onLoad={() => fitToRecords(filteredActiveRecords)}
                className="absolute inset-0 h-full w-full"
                style={{ borderRadius: 0 }}
            >
                {filteredActiveRecords.length > 0 && (
                    <Source
                        key={`source-${activeTab}-${filteredActiveRecords.length}`}
                        id={`residential-growth-${activeTab}-source`}
                        type="geojson"
                        data={geoJson}
                        cluster
                        clusterMaxZoom={14}
                        clusterRadius={42}
                        clusterProperties={{
                            units_sum: ['+', ['get', 'units']],
                        }}
                    >
                        <Layer key={`clusters-${activeTab}-${filteredActiveRecords.length}`} {...clusterLayerStyle(activeTab)} />
                        <Layer key={`cluster-counts-${activeTab}-${filteredActiveRecords.length}`} {...clusterCountLayerStyle(activeTab)} />
                        <Layer key={`layer-${activeTab}-${filteredActiveRecords.length}`} {...mapLayerStyle(activeTab)} />
                        <Layer key={`labels-${activeTab}-${filteredActiveRecords.length}`} {...stackLabelLayerStyle(activeTab)} />
                    </Source>
                )}
                {expandedGroup.length > 1 && (
                    <Source key={`spider-${expandedStackKey}`} id={`residential-growth-${activeTab}-spider-source`} type="geojson" data={spiderLineGeoJson}>
                        <Layer {...spiderLineLayerStyle(activeTab)} />
                    </Source>
                )}
                {expandedGroup.length > 1 && (
                    <Source key={`spider-points-${expandedStackKey}`} id={`residential-growth-${activeTab}-spider-point-source`} type="geojson" data={spiderGeoJson}>
                        <Layer {...spiderPointLayerStyle(activeTab)} />
                    </Source>
                )}
            </MapBase>

            {filteredActiveRecords.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-white/20">
                    <div className="rounded-3xl border-2 border-dashed border-gray-200 bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
                        <FileSpreadsheet className="mx-auto text-blue-500" size={36} />
                        <div className="mt-3 text-xl font-black text-gray-950">{activeRecords.length === 0 ? `Upload a ${activeTab === 'issued' ? 'monthly issuance listing' : 'certificate of occupancy report'}` : 'No records match the filters'}</div>
                        <div className="mt-1 text-sm font-semibold text-gray-500">{activeRecords.length === 0 ? 'The map will populate after addresses are geocoded.' : 'Clear or loosen the filters to see more records.'}</div>
                    </div>
                </div>
            )}

            <div className="pointer-events-none absolute inset-0 z-20">
                <div className="pointer-events-auto absolute left-4 top-4 max-w-[calc(100%-2rem)] rounded-2xl border border-white/70 bg-white/90 p-2.5 shadow-xl backdrop-blur xl:max-w-[760px]">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded-xl px-2 py-2 text-xs font-black text-gray-500 hover:bg-gray-100 hover:text-blue-600">
                            <ArrowLeft size={16} /> Back
                        </button>
                        <div className="flex min-w-[210px] items-center gap-2">
                            <div className="rounded-2xl bg-emerald-50 p-2 text-emerald-600"><Building2 size={20} /></div>
                            <div className="min-w-0">
                                <h2 className="truncate text-lg font-black tracking-tight text-gray-950">{mapTitle}</h2>
                                <p className="truncate text-xs font-bold text-gray-500">{rangeLabel} · {rangeResult.periodCount || 0} month{rangeResult.periodCount === 1 ? '' : 's'} loaded{loadingHistory ? ' · loading' : ''}</p>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-1">
                            {(['issued', 'occupied'] as ActiveTab[]).map((tab) => (
                                <button
                                    key={tab}
                                    type="button"
                                    onClick={() => { setActiveTab(tab); setSelectedId(null); setSubtypeFilter('all'); setAccuracyFilter('all'); }}
                                    className={`rounded-xl px-3 py-2 text-xs font-black transition ${activeTab === tab ? `bg-white shadow-sm ${tab === 'issued' ? 'text-blue-600' : 'text-emerald-600'}` : 'text-gray-500 hover:text-gray-900'}`}
                                >
                                    {tab === 'issued' ? 'Issued' : 'Occupied'}
                                </button>
                            ))}
                        </div>
                        <select value={dateRangePreset} onChange={(event) => setDateRangePreset(event.target.value as ResidentialGrowthDateRangePreset)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none">
                            {RESIDENTIAL_GROWTH_DATE_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        {dateRangePreset === 'selected-month' && (
                            <select
                                value={selectedMonth}
                                onChange={(event) => setSelectedMonth(event.target.value)}
                                className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none"
                            >
                                {monthOptions.length === 0 && <option value="">No months</option>}
                                {monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        )}
                    </div>
                    <div className="mt-2 flex items-end gap-2 overflow-x-auto border-t border-gray-100 pt-2">
                        <div className={`shrink-0 rounded-xl border px-3 py-2 ${activeTab === 'issued' ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>
                            <div className="text-[10px] font-black uppercase tracking-[0.14em]">{totalMetricLabel}</div>
                            <div className="text-lg font-black leading-none text-gray-950">{totalMetricValue}</div>
                        </div>
                        {activeConcentrationGroups.length > 0 && (
                            <div className="shrink-0">
                                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Top 3</div>
                                <div className="flex items-stretch gap-2">
                                    {activeConcentrationGroups.slice(0, 3).map((group, index) => {
                                        const units = groupUnits(group);
                                        const selected = selectedGroup.length > 0 && coordinateKey(selectedGroup[0]) === coordinateKey(group[0]);
                                        return (
                                            <button
                                                key={coordinateKey(group[0])}
                                                type="button"
                                                onClick={() => handleSelectGroup(group)}
                                                title={selected ? 'Click again to clear selection' : 'Zoom to this concentration'}
                                                className={`w-[170px] shrink-0 rounded-xl border px-3 py-2 text-left shadow-sm ${selected ? (activeTab === 'issued' ? 'border-blue-300 bg-blue-50' : 'border-emerald-300 bg-emerald-50') : 'border-gray-200 bg-white hover:border-blue-300'}`}
                                            >
                                                <div className="truncate text-xs font-black text-gray-950">{index + 1}. {compactBarrieLabel(groupLabel(group))}</div>
                                                <div className={`mt-0.5 text-[11px] font-black ${activeTab === 'issued' ? 'text-blue-600' : 'text-emerald-600'}`}>{units.toLocaleString()} units</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto absolute right-4 top-4 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => fitToRecords(filteredActiveRecords)} className="inline-flex items-center gap-2 rounded-xl border border-white/70 bg-white/92 px-3 py-2 text-xs font-black text-gray-700 shadow-xl backdrop-blur hover:text-blue-600">
                        <RefreshCw size={14} /> Fit
                    </button>
                    <button type="button" onClick={() => setShowFilters((value) => !value)} className={`rounded-xl border border-white/70 px-3 py-2 text-xs font-black shadow-xl backdrop-blur ${showFilters ? 'bg-blue-600 text-white' : 'bg-white/92 text-gray-700 hover:text-blue-600'}`}>
                        Filters
                    </button>
                    <button type="button" onClick={() => setShowDetails((value) => !value)} className={`rounded-xl border border-white/70 px-3 py-2 text-xs font-black shadow-xl backdrop-blur ${showDetails ? 'bg-gray-900 text-white' : 'bg-white/92 text-gray-700 hover:text-blue-600'}`}>
                        Details
                    </button>
                    <button type="button" onClick={() => setShowImports((value) => !value)} className={`rounded-xl border border-white/70 px-3 py-2 text-xs font-black shadow-xl backdrop-blur ${showImports ? 'bg-emerald-600 text-white' : 'bg-white/92 text-gray-700 hover:text-blue-600'}`}>
                        Import
                    </button>
                    <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/95 px-3 py-2 text-xs font-black text-emerald-700 shadow-xl backdrop-blur">
                        <CheckCircle2 size={14} /> Auto-save on
                    </div>
                    <button type="button" onClick={() => void exportPdf()} disabled={activeRecords.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-white/70 bg-white/92 px-3 py-2 text-xs font-black text-gray-700 shadow-xl backdrop-blur hover:text-blue-600 disabled:opacity-50">
                        <Download size={14} /> PDF
                    </button>
                </div>

                {showFilters && (
                    <div className="pointer-events-auto absolute left-4 top-[88px] w-[min(760px,calc(100%-2rem))] rounded-3xl border border-white/70 bg-white/94 p-3 shadow-2xl backdrop-blur">
                        <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_170px_130px_130px_150px]">
                            <label className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                                <input
                                    value={searchText}
                                    onChange={(event) => setSearchText(event.target.value)}
                                    placeholder="Search address or file number"
                                    className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm font-semibold text-gray-700 outline-none focus:border-blue-300"
                                />
                            </label>
                            <select value={subtypeFilter} onChange={(event) => setSubtypeFilter(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none">
                                <option value="all">All types</option>
                                {subtypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none" />
                            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none" />
                            <select value={accuracyFilter} onChange={(event) => setAccuracyFilter(event.target.value as AccuracyFilter)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none">
                                <option value="all">All geocodes</option>
                                <option value="exact">Exact only</option>
                                <option value="approximate">Approximate</option>
                            </select>
                        </div>
                    </div>
                )}

                {showImports && (
                    <div className="pointer-events-auto absolute right-4 top-[72px] w-[min(360px,calc(100%-2rem))] rounded-3xl border border-white/70 bg-white/94 p-4 shadow-2xl backdrop-blur">
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Import new month</div>
                        <div className="mt-3 space-y-3">
                            <UploadButton label="Upload Issuance Listing" helper="Planned / permitted residential units." busy={!!busyText} onFile={(file) => void handleFile(file, 'issued')} />
                            <UploadButton label="Upload Occupancy Report" helper="Passed residential occupancy inspections." busy={!!busyText} onFile={(file) => void handleFile(file, 'occupied')} />
                        </div>
                    </div>
                )}

                {!showDetails && (
                    <div className="pointer-events-auto absolute bottom-40 right-4 rounded-2xl border border-white/70 bg-white/90 p-3 shadow-xl backdrop-blur">
                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">Units scale</div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-gray-600">
                            <span>Low</span>
                            <div className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, #16a34a 0%, #84cc16 25%, #eab308 50%, #f97316 75%, #dc2626 100%)' }} />
                            <span>High</span>
                        </div>
                    </div>
                )}

                {showDetails && (
                    <aside className="pointer-events-auto absolute bottom-4 right-4 max-h-[calc(100%-128px)] w-[min(420px,calc(100%-2rem))] overflow-auto rounded-3xl border border-white/70 bg-white/94 p-4 shadow-2xl backdrop-blur">
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Top map concentrations</div>
                            <div className="mt-3 space-y-2">
                                {activeConcentrationGroups.map((group, index) => {
                                    const record = group[0];
                                    const units = groupUnits(group);
                                    const selected = selectedGroup.length > 0 && coordinateKey(selectedGroup[0]) === coordinateKey(record);
                                    return (
                                        <button
                                            key={coordinateKey(record)}
                                            type="button"
                                            onClick={() => handleSelectGroup(group)}
                                            className={`w-full rounded-2xl border p-3 text-left transition ${selected ? (activeTab === 'issued' ? 'border-blue-300 bg-blue-50' : 'border-emerald-300 bg-emerald-50') : 'border-gray-200 bg-white hover:border-gray-300'}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-black text-gray-950">{index + 1}. {groupLabel(group)}</div>
                                                    <div className="mt-1 truncate text-xs font-semibold text-gray-500">{group.length} record{group.length === 1 ? '' : 's'} · {Array.from(new Set(group.map((entry) => entry.subtype || entry.workProposed || entry.category))).slice(0, 2).join(', ')}</div>
                                                </div>
                                                <div className={`rounded-full px-2 py-1 text-xs font-black ${activeTab === 'issued' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{units}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                                {activeConcentrationGroups.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-sm font-semibold text-gray-400">No mapped concentrations in the current filters.</div>}
                            </div>
                        </div>

                        {selectedRecord && (
                            <div className="mt-4 rounded-3xl border-2 border-gray-200 bg-gray-50 p-4">
                                <div className="flex items-start gap-3">
                                    <div className={`rounded-2xl bg-white p-2 shadow-sm ${activeTab === 'issued' ? 'text-blue-600' : 'text-emerald-600'}`}><MapPin size={18} /></div>
                                    <div>
                                        <div className="text-lg font-black leading-tight text-gray-950">{selectedGroup.length > 1 ? `${selectedGroup.length} records at this mapped position` : selectedRecord.address}</div>
                                        <div className="mt-1 text-xs font-bold uppercase tracking-wide text-gray-400">{selectedGroup.length > 1 ? selectedRecord.geocode?.displayName : selectedRecord.fileNumber}</div>
                                    </div>
                                </div>
                                <div className="mt-4 space-y-2 text-sm font-semibold text-gray-600">
                                    <div className="flex justify-between gap-3"><span>{recordDateLabel(activeTab)} date{selectedGroup.length > 1 ? ' range' : ''}</span><span className="text-gray-950">{selectedGroup.length > 1 ? `${selectedGroup.map((record) => record.date).sort()[0] || 'Unknown'} – ${selectedGroup.map((record) => record.date).sort().at(-1) || 'Unknown'}` : selectedRecord.date || 'Unknown'}</span></div>
                                    <div className="flex justify-between gap-3"><span>Records</span><span className="text-gray-950">{selectedGroup.length}</span></div>
                                    <div className="flex justify-between gap-3"><span>Units</span><span className="text-gray-950">{selectedGroup.reduce((sum, record) => sum + record.units, 0)}</span></div>
                                    <div className="flex justify-between gap-3"><span>Geocode</span><span className={`text-right ${selectedGroup.some(isApproximateGeocode) ? 'text-amber-700' : 'text-gray-950'}`}>{selectedGroup.some(isApproximateGeocode) ? 'Approximate street-level' : 'Exact address'}</span></div>
                                    <div className="flex justify-between gap-3"><span>Type</span><span className="text-right text-gray-950">{Array.from(new Set(selectedGroup.map((record) => record.subtype || record.workProposed || record.category))).slice(0, 2).join(', ')}</span></div>
                                </div>
                                {selectedRecord.description && <p className="mt-3 rounded-2xl bg-white p-3 text-xs font-semibold leading-relaxed text-gray-500">{selectedRecord.description}</p>}
                            </div>
                        )}
                    </aside>
                )}

                {(busyText || error) && (
                    <div className={`pointer-events-auto absolute left-1/2 top-[88px] w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border px-4 py-2 text-xs font-bold shadow-xl backdrop-blur ${error ? 'border-amber-200 bg-amber-50/95 text-amber-800' : activeTab === 'occupied' ? 'border-emerald-100 bg-emerald-50/95 text-emerald-800' : 'border-blue-100 bg-blue-50/95 text-blue-800'}`}>
                        <div className="flex items-start gap-2">
                            {busyText ? <Loader2 className="animate-spin" size={16} /> : error ? <AlertTriangle size={16} /> : <MapPin size={16} />}
                            <span>
                                {error || busyText}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ResidentialGrowthWorkspace;
