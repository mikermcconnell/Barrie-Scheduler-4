/**
 * Public Timetable Generator
 *
 * Generates rider-friendly brochure timetables from master schedule data.
 * Matches Barrie Transit's official brochure design.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Download, RefreshCw, Eye, Trash2, Image, ChevronDown, ChevronUp, Save, RotateCcw, Phone, Mail, Globe, Clock3, Maximize2, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { getAllMasterSchedules, getMasterSchedule, uploadRouteMap, deleteRouteMap, getRouteMapUrl } from '../../utils/services/masterScheduleService';
import type { MasterScheduleEntry, DayType } from '../../utils/masterScheduleTypes';
import type { MasterTrip, RoundTripTable } from '../../utils/parsers/masterScheduleParser';
import { buildRoundTripView } from '../../utils/parsers/masterScheduleParser';
import { buildRouteIdentity } from '../../utils/masterScheduleTypes';
import { getRouteConfig } from '../../utils/config/routeDirectionConfig';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';
import {
    BROCHURE_DAY_ORDER,
    deduplicateStopsForBrochure,
    getBrochureDayKey,
    getBrochureDayLabel,
} from '../../utils/reports/publicTimetableUtils';
import {
    PUBLIC_TIMETABLE_FARE_HEADERS,
} from '../../utils/reports/publicTimetableContent';
import type { PublicTimetableConfigDocument } from '../../utils/reports/publicTimetableConfigService';
import {
    buildDefaultPublicTimetableConfig,
    getEffectivePublicTimetableConfig,
    getPublicTimetableConfigErrorMessage,
    savePublicTimetableConfig,
} from '../../utils/reports/publicTimetableConfigService';

interface PublicTimetableProps {
    onBack: () => void;
    initialRouteNumber?: string;
}

type DayStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
type BrochureDayRecord = Record<'weekday' | 'saturday' | 'sunday', {
    dayType: DayType;
    label: string;
    status: DayStatus;
    table: RoundTripTable | null;
    message: string | null;
}>;

const createEmptyBrochureDays = (): BrochureDayRecord => ({
    weekday: { dayType: 'Weekday', label: getBrochureDayLabel('Weekday'), status: 'idle', table: null, message: null },
    saturday: { dayType: 'Saturday', label: getBrochureDayLabel('Saturday'), status: 'idle', table: null, message: null },
    sunday: { dayType: 'Sunday', label: getBrochureDayLabel('Sunday'), status: 'idle', table: null, message: null },
});

const LANDSCAPE_MAP_ROUTES = new Set(['10', '11', '100', '101']);
const PORTRAIT_HERO_MAP_ROUTES = new Set(['2']);
const RENDER_BROCHURE_ROUTE_MAP_IMAGE = false;
const BROCHURE_COMPACT_ROWS_PER_CHUNK = 28;
const BROCHURE_AFTERNOON_TABLE_SPLIT_MINUTES = 14 * 60;
const BROCHURE_WIDE_TIMEPOINT_THRESHOLD = 8;

const BROCHURE_TABLE_CLASS = 'h-full w-full table-fixed border-collapse text-[7.5px] leading-[0.9]';
const BROCHURE_HEADER_CELL_CLASS = 'border-l border-slate-200 px-0.5 py-0.5 text-center align-middle text-[6.5px] font-bold leading-[0.9] text-slate-700 first:border-l-0';
const BROCHURE_STOP_ID_CLASS = 'mt-[1px] block text-[5.5px] font-medium leading-none text-slate-400';
const BROCHURE_TIME_CELL_CLASS = 'border-l border-t border-slate-200 px-0.5 py-[1px] text-center align-middle text-[8px] font-semibold leading-none text-slate-700 first:border-l-0';

const BROCHURE_WIDE_TABLE_CLASS = 'h-full w-full table-fixed border-collapse text-[6.5px] leading-[0.8]';
const BROCHURE_WIDE_HEADER_CELL_CLASS = 'border-l border-slate-200 px-[1px] py-[1px] text-center align-middle text-[5.5px] font-bold leading-[0.82] text-slate-700 first:border-l-0';
const BROCHURE_WIDE_STOP_ID_CLASS = 'hidden';
const BROCHURE_WIDE_TIME_CELL_CLASS = 'border-l border-t border-slate-200 px-[1px] py-[1px] text-center align-middle text-[7px] font-semibold leading-none text-slate-700 first:border-l-0';

const BROCHURE_STOP_ABBREVIATIONS: Array<[RegExp, string]> = [
    [/barrie allandale transit terminal platforms?/gi, 'Allandale'],
    [/barrie allandale transit terminal/gi, 'Allandale'],
    [/georgian college/gi, 'Georgian'],
    [/park place/gi, 'Park Pl'],
    [/downtown hub/gi, 'Downtown'],
    [/rvh main entrance/gi, 'RVH'],
    [/rvh\/yonge/gi, 'RVH/Yonge'],
    [/crosstown\/essa/gi, 'Cross/Essa'],
    [/veteran'?s/gi, 'Vets'],
    [/ferndale woods/gi, 'Ferndale'],
    [/mapleview/gi, 'Mapleview'],
    [/community centre/gi, 'Comm Ctr'],
    [/terminal/gi, 'Term'],
    [/station/gi, 'Stn'],
];

const MAP_IMAGE_SCALE_MIN = 50;
const MAP_IMAGE_SCALE_MAX = 150;
const MAP_IMAGE_SCALE_DEFAULT = 100;
const MAP_IMAGE_OFFSET_MIN = -40;
const MAP_IMAGE_OFFSET_MAX = 40;
const MAP_IMAGE_OFFSET_DEFAULT = 0;

const clampMapImageScalePercent = (value: number | string | null | undefined): number => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) return MAP_IMAGE_SCALE_DEFAULT;
    return Math.min(MAP_IMAGE_SCALE_MAX, Math.max(MAP_IMAGE_SCALE_MIN, Math.round(numericValue)));
};

const clampMapImageOffsetPercent = (value: number | string | null | undefined): number => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) return MAP_IMAGE_OFFSET_DEFAULT;
    return Math.min(MAP_IMAGE_OFFSET_MAX, Math.max(MAP_IMAGE_OFFSET_MIN, Math.round(numericValue)));
};

interface MapImageDragState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
    elementWidth: number;
    elementHeight: number;
}

type MapImageResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface MapImageResizeState {
    pointerId: number;
    corner: MapImageResizeCorner;
    startClientX: number;
    startClientY: number;
    startScale: number;
    elementWidth: number;
    elementHeight: number;
}

interface VisibleBrochureStop {
    origStop: string;
    label: string;
    stopId: string;
}

interface DirectionPanelData {
    key: string;
    title: string;
    badge: string;
    trips: MasterTrip[];
    stops: VisibleBrochureStop[];
}

interface CombinedRoute2Column {
    key: string;
    label: string;
    stopId: string;
    direction: 'North' | 'South';
    stopKey: string;
}

interface CombinedRoute2Row {
    key: string;
    northTrip: MasterTrip | null;
    southTrip: MasterTrip | null;
}

interface CombinedRoundTripTimetable {
    columns: CombinedRoute2Column[];
    rows: CombinedRoute2Row[];
    firstBadge: string;
    firstTitle: string;
    secondBadge: string;
    secondTitle: string;
    boundaryIndex: number;
}

const formatMinutesForBrochure = (minutes: number | null | undefined): string => {
    if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
        return '';
    }

    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hours24 = Math.floor(normalized / 60);
    const mins = Math.round(normalized % 60);
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
};

const formatBrochureHeaderTime = (timeStr: string | undefined): string => {
    if (!timeStr) {
        return '-';
    }

    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) {
        return timeStr;
    }

    const [, rawHour, mins, rawPeriod] = match;
    const period = rawPeriod.toUpperCase();
    return mins === '00' ? `${parseInt(rawHour, 10)} ${period}` : `${parseInt(rawHour, 10)}:${mins} ${period}`;
};

const formatBrochureCellTime = (timeStr: string | undefined): string => {
    if (!timeStr) {
        return '—';
    }

    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) {
        return timeStr;
    }

    const [, rawHour, mins] = match;
    return mins === '00' ? `${parseInt(rawHour, 10)}` : `${parseInt(rawHour, 10)}:${mins}`;
};

const formatFrequencyLabel = (minutes: number | null): string => {
    if (!minutes) {
        return 'See schedule';
    }

    return `Every ${minutes} minutes`;
};

const estimateHeadwayMinutes = (trips: MasterTrip[]): number | null => {
    const departures = trips
        .map(trip => trip.startTime)
        .filter((value): value is number => Number.isFinite(value))
        .sort((a, b) => a - b);

    if (departures.length < 2) {
        return null;
    }

    const diffs = departures
        .slice(1)
        .map((value, index) => value - departures[index])
        .filter(diff => diff >= 5 && diff <= 120)
        .sort((a, b) => a - b);

    if (diffs.length === 0) {
        return null;
    }

    const median = diffs[Math.floor(diffs.length / 2)];
    return Math.max(5, Math.round(median / 5) * 5);
};

const getTripDisplayTime = (trip: MasterTrip, stopKey: string): string => {
    return formatBrochureCellTime(trip.stops[stopKey]);
};

const getBrochureTableClasses = (columnCount: number) => {
    const isWide = columnCount >= BROCHURE_WIDE_TIMEPOINT_THRESHOLD;
    return {
        isWide,
        table: isWide ? BROCHURE_WIDE_TABLE_CLASS : BROCHURE_TABLE_CLASS,
        headerCell: isWide ? BROCHURE_WIDE_HEADER_CELL_CLASS : BROCHURE_HEADER_CELL_CLASS,
        stopId: isWide ? BROCHURE_WIDE_STOP_ID_CLASS : BROCHURE_STOP_ID_CLASS,
        timeCell: isWide ? BROCHURE_WIDE_TIME_CELL_CLASS : BROCHURE_TIME_CELL_CLASS,
    };
};

const abbreviateBrochureStopName = (name: string): string => {
    let out = name;
    for (const [pattern, replacement] of BROCHURE_STOP_ABBREVIATIONS) {
        out = out.replace(pattern, replacement);
    }
    return out.replace(/\s+/g, ' ').trim();
};

const chunkItems = <T,>(items: T[], chunkSize: number): T[][] => {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
};

const chunkBrochureTableItems = <T,>(
    items: T[],
    getStartTime: (item: T) => number | null | undefined,
): T[][] => {
    const afternoonSplitIndex = items.findIndex(item => {
        const startTime = getStartTime(item);
        return Number.isFinite(startTime) && Number(startTime) >= BROCHURE_AFTERNOON_TABLE_SPLIT_MINUTES;
    });

    const sections = afternoonSplitIndex > 0 && afternoonSplitIndex < items.length
        ? [items.slice(0, afternoonSplitIndex), items.slice(afternoonSplitIndex)]
        : [items];

    return sections.flatMap(section => chunkItems(section, BROCHURE_COMPACT_ROWS_PER_CHUNK));
};

const buildDirectionTitleFromStops = (stops: VisibleBrochureStop[]): string => {
    if (stops.length === 0) {
        return 'Schedule';
    }

    if (stops.length === 1) {
        return stops[0].label;
    }

    return `${stops[0].label} → ${stops[stops.length - 1].label}`;
};

const getDirectionBadge = (routeNumber: string, direction: 'North' | 'South'): string => {
    const config = getRouteConfig(routeNumber);
    if (!config || config.segments.length === 1) {
        return routeNumber;
    }

    const segment = config.segments.find(item => item.name === direction);
    return segment?.variant.split(' ')[0] ?? routeNumber;
};

const getVisibleStopsForDirection = (
    stops: string[],
    stopIds: Record<string, string>,
    selectedStops: string[],
): VisibleBrochureStop[] => {
    const deduped = deduplicateStopsForBrochure(stops);

    return deduped.stopMapping
        .map((origStop, index) => ({
            origStop,
            label: deduped.displayStops[index],
            stopId: stopIds[origStop] || '',
        }))
        .filter(stop => selectedStops.includes(stop.origStop));
};

const getContactIcon = (contact: string): React.ReactElement => {
    if (contact.includes('@')) {
        return <Mail size={12} />;
    }

    if (/\d/.test(contact)) {
        return <Phone size={12} />;
    }

    return <Globe size={12} />;
};

export const PublicTimetable: React.FC<PublicTimetableProps> = ({ onBack, initialRouteNumber }) => {
    const { team, canManageTeam } = useTeam();
    const { user } = useAuth();
    const toast = useToast();
    const brochurePage1Ref = useRef<HTMLDivElement | null>(null);
    const brochurePage2Ref = useRef<HTMLDivElement | null>(null);
    const mapImageDragRef = useRef<MapImageDragState | null>(null);
    const mapImageResizeRef = useRef<MapImageResizeState | null>(null);
    const [entries, setEntries] = useState<MasterScheduleEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);

    // Selection state
    const [selectedRoute, setSelectedRoute] = useState<string>('');
    const [selectedDirection, setSelectedDirection] = useState<'North' | 'South' | 'Both'>('Both');
    const [selectedStops, setSelectedStops] = useState<string[]>([]);
    const [headerText, setHeaderText] = useState('');

    // Route map image
    const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
    const [uploadingMap, setUploadingMap] = useState(false);

    const [brochureDays, setBrochureDays] = useState<BrochureDayRecord>(createEmptyBrochureDays());
    const [brochureConfig, setBrochureConfig] = useState<PublicTimetableConfigDocument>(buildDefaultPublicTimetableConfig());
    const [configDraft, setConfigDraft] = useState<PublicTimetableConfigDocument>(buildDefaultPublicTimetableConfig());
    const [loadingConfig, setLoadingConfig] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [configWarning, setConfigWarning] = useState<string | null>(null);
    const [showConfigEditor, setShowConfigEditor] = useState(false);
    const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
    const [isDraggingMapImage, setIsDraggingMapImage] = useState(false);
    const [isResizingMapImage, setIsResizingMapImage] = useState(false);

    useEffect(() => {
        const routeNumber = initialRouteNumber?.trim();
        if (!routeNumber) return;
        setSelectedRoute(routeNumber);
        setSelectedDirection('Both');
    }, [initialRouteNumber]);

    // Load available schedules
    useEffect(() => {
        const loadEntries = async () => {
            if (!team?.id) {
                setLoading(false);
                return;
            }
            try {
                const allEntries = await getAllMasterSchedules(team.id);
                setEntries(allEntries);
            } catch (error) {
                console.error('Error loading schedules:', error);
            } finally {
                setLoading(false);
            }
        };
        loadEntries();
    }, [team?.id]);

    useEffect(() => {
        if (!isFullscreenPreview) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsFullscreenPreview(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isFullscreenPreview]);

    // Get unique routes
    const routes = useMemo(() => {
        const routeSet = new Set(entries.map(e => e.routeNumber));
        if (selectedRoute) {
            routeSet.add(selectedRoute);
        }
        return Array.from(routeSet).sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            return numA - numB;
        });
    }, [entries, selectedRoute]);

    useEffect(() => {
        const loadBrochureConfig = async () => {
            if (!team?.id) {
                const defaults = buildDefaultPublicTimetableConfig();
                setBrochureConfig(defaults);
                setConfigDraft(defaults);
                setConfigWarning(null);
                return;
            }

            setLoadingConfig(true);
            try {
                const config = await getEffectivePublicTimetableConfig(team.id);
                setBrochureConfig(config);
                setConfigDraft({
                    ...config,
                    fareRows: config.fareRows.map(row => ({ ...row })),
                    legendItems: [...config.legendItems],
                    contacts: [...config.contacts],
                });
                setConfigWarning(null);
            } catch (error) {
                console.error('Error loading public timetable config:', error);
                const defaults = buildDefaultPublicTimetableConfig();
                setBrochureConfig(defaults);
                setConfigDraft(defaults);
                setConfigWarning(getPublicTimetableConfigErrorMessage(error, 'load'));
            } finally {
                setLoadingConfig(false);
            }
        };

        void loadBrochureConfig();
    }, [team?.id]);

    // Load route map image when route changes
    useEffect(() => {
        const loadMapImage = async () => {
            if (!team?.id || !selectedRoute) {
                setMapImageUrl(null);
                return;
            }
            try {
                const url = await getRouteMapUrl(team.id, selectedRoute);
                setMapImageUrl(url);
            } catch (error) {
                console.error('Error loading route map:', error);
                setMapImageUrl(null);
                toast.error('Route Map Load Failed', 'The route map could not be loaded.');
            }
        };
        void loadMapImage();
    }, [selectedRoute, team?.id, toast]);

    // Load all brochure day data
    useEffect(() => {
        const loadAllDayTypes = async () => {
            if (!team?.id || !selectedRoute) {
                setBrochureDays(createEmptyBrochureDays());
                setSelectedStops([]);
                return;
            }

            setBrochureDays({
                weekday: { dayType: 'Weekday', label: getBrochureDayLabel('Weekday'), status: 'loading', table: null, message: null },
                saturday: { dayType: 'Saturday', label: getBrochureDayLabel('Saturday'), status: 'loading', table: null, message: null },
                sunday: { dayType: 'Sunday', label: getBrochureDayLabel('Sunday'), status: 'loading', table: null, message: null },
            });

            const loadedDays: Array<{
                key: keyof BrochureDayRecord;
                value: BrochureDayRecord[keyof BrochureDayRecord];
            }> = await Promise.all(BROCHURE_DAY_ORDER.map(async (dayType) => {
                const dayKey = getBrochureDayKey(dayType);

                try {
                    const routeIdentity = buildRouteIdentity(selectedRoute, dayType);
                    const result = await getMasterSchedule(team.id, routeIdentity);
                    if (!result) {
                        return {
                            key: dayKey,
                            value: {
                                dayType,
                                label: getBrochureDayLabel(dayType),
                                status: 'missing' as const,
                                table: null,
                                message: `${dayType} schedule is not published for this route.`,
                            } as BrochureDayRecord[keyof BrochureDayRecord]
                        };
                    }

                    return {
                        key: dayKey,
                        value: {
                            dayType,
                            label: getBrochureDayLabel(dayType),
                            status: 'ready' as const,
                            table: buildRoundTripView(result.content.northTable, result.content.southTable),
                            message: null,
                        } as BrochureDayRecord[keyof BrochureDayRecord]
                    };
                } catch (error) {
                    console.error(`Error loading ${dayType} schedule:`, error);
                    return {
                        key: dayKey,
                        value: {
                            dayType,
                            label: getBrochureDayLabel(dayType),
                            status: 'error' as const,
                            table: null,
                            message: `Could not load the ${dayType.toLowerCase()} schedule.`,
                        } as BrochureDayRecord[keyof BrochureDayRecord]
                    };
                }
            }));

            const nextDays = createEmptyBrochureDays();
            const allStops = new Set<string>();

            loadedDays.forEach(({ key, value }) => {
                nextDays[key] = value;
                if (value.table) {
                    value.table.northStops.forEach(stop => allStops.add(stop));
                    value.table.southStops.forEach(stop => allStops.add(stop));
                }
            });

            setBrochureDays(nextDays);
            setSelectedStops(Array.from(allStops));
        };
        void loadAllDayTypes();
    }, [selectedRoute, team?.id]);

    // Handle map image upload
    const handleMapUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file || !team?.id || !selectedRoute) {
            return;
        }

        if (!file.type.startsWith('image/')) {
            toast.warning('Image Required', 'Please select an image file.');
            return;
        }

        setUploadingMap(true);
        try {
            const url = await uploadRouteMap(team.id, selectedRoute, file);
            setMapImageUrl(url);
            toast.success('Route Map Updated', 'The brochure map image is ready.');
        } catch (error) {
            console.error('Route map upload failed:', error);
            toast.error('Upload Failed', 'The route map image could not be uploaded.');
        } finally {
            setUploadingMap(false);
        }
    };

    // Handle map image delete
    const handleMapDelete = async () => {
        if (!team?.id || !selectedRoute || !mapImageUrl) return;

        if (!window.confirm('Delete route map image?')) return;

        try {
            await deleteRouteMap(team.id, selectedRoute);
            setMapImageUrl(null);
            toast.success('Route Map Deleted', 'The brochure map image was removed.');
        } catch (error) {
            console.error('Error deleting map:', error);
            toast.error('Delete Failed', 'The route map image could not be deleted.');
        }
    };

    // Get available stops based on direction
    const availableStops = useMemo(() => {
        const stops = new Set<string>();
        const readyTables = Object.values(brochureDays)
            .filter((day): day is BrochureDayRecord[keyof BrochureDayRecord] & { table: RoundTripTable } => day.status === 'ready' && day.table !== null)
            .map(day => day.table);

        if (selectedDirection === 'North' || selectedDirection === 'Both') {
            readyTables.forEach(table => table.northStops.forEach(stop => stops.add(stop)));
        }
        if (selectedDirection === 'South' || selectedDirection === 'Both') {
            readyTables.forEach(table => table.southStops.forEach(stop => stops.add(stop)));
        }
        return Array.from(stops);
    }, [brochureDays, selectedDirection]);

    // Toggle stop selection
    const toggleStop = (stop: string) => {
        setSelectedStops(prev =>
            prev.includes(stop)
                ? prev.filter(s => s !== stop)
                : [...prev, stop]
        );
    };

    // Select all / none
    const selectAllStops = () => setSelectedStops(availableStops);
    const selectNoStops = () => setSelectedStops([]);

    const updateFareRow = (index: number, field: keyof PublicTimetableConfigDocument['fareRows'][number], value: string) => {
        setConfigDraft(prev => ({
            ...prev,
            fareRows: prev.fareRows.map((row, rowIndex) => (
                rowIndex === index ? { ...row, [field]: value } : row
            )),
        }));
    };

    const updateStringList = (field: 'legendItems' | 'contacts', index: number, value: string) => {
        setConfigDraft(prev => ({
            ...prev,
            [field]: prev[field].map((item, itemIndex) => itemIndex === index ? value : item),
        }));
    };

    const updateMapImageScale = (value: number | string) => {
        setConfigDraft(prev => ({
            ...prev,
            mapImageScalePercent: clampMapImageScalePercent(value),
        }));
    };

    const updateMapImageOffset = (axis: 'x' | 'y', value: number | string) => {
        const field = axis === 'x' ? 'mapImageOffsetXPercent' : 'mapImageOffsetYPercent';
        setConfigDraft(prev => ({
            ...prev,
            [field]: clampMapImageOffsetPercent(value),
        }));
    };

    const updateMapImagePlacement = (scalePercent: number, offsetXPercent = 0, offsetYPercent = 0) => {
        setConfigDraft(prev => ({
            ...prev,
            mapImageScalePercent: clampMapImageScalePercent(scalePercent),
            mapImageOffsetXPercent: clampMapImageOffsetPercent(offsetXPercent),
            mapImageOffsetYPercent: clampMapImageOffsetPercent(offsetYPercent),
        }));
    };

    const handleMapImagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!mapImageUrl || isResizingMapImage || event.button !== 0) return;

        const bounds = event.currentTarget.getBoundingClientRect();
        mapImageDragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startOffsetX: clampMapImageOffsetPercent(configDraft.mapImageOffsetXPercent),
            startOffsetY: clampMapImageOffsetPercent(configDraft.mapImageOffsetYPercent),
            elementWidth: Math.max(bounds.width, 1),
            elementHeight: Math.max(bounds.height, 1),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDraggingMapImage(true);
    };

    const handleMapImagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const dragState = mapImageDragRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) return;

        const nextOffsetX = dragState.startOffsetX + ((event.clientX - dragState.startClientX) / dragState.elementWidth) * 100;
        const nextOffsetY = dragState.startOffsetY + ((event.clientY - dragState.startClientY) / dragState.elementHeight) * 100;

        setConfigDraft(prev => ({
            ...prev,
            mapImageOffsetXPercent: clampMapImageOffsetPercent(nextOffsetX),
            mapImageOffsetYPercent: clampMapImageOffsetPercent(nextOffsetY),
        }));
    };

    const handleMapImagePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const dragState = mapImageDragRef.current;
        if (dragState?.pointerId === event.pointerId) {
            mapImageDragRef.current = null;
            setIsDraggingMapImage(false);
        }
    };

    const handleMapImageResizePointerDown = (
        corner: MapImageResizeCorner,
        event: React.PointerEvent<HTMLButtonElement>
    ) => {
        if (!mapImageUrl || event.button !== 0) return;

        event.preventDefault();
        event.stopPropagation();

        const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
        if (!bounds) return;

        mapImageResizeRef.current = {
            pointerId: event.pointerId,
            corner,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startScale: clampMapImageScalePercent(configDraft.mapImageScalePercent),
            elementWidth: Math.max(bounds.width, 1),
            elementHeight: Math.max(bounds.height, 1),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsResizingMapImage(true);
    };

    const handleMapImageResizePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const resizeState = mapImageResizeRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) return;

        event.preventDefault();
        event.stopPropagation();

        const deltaX = event.clientX - resizeState.startClientX;
        const deltaY = event.clientY - resizeState.startClientY;
        const horizontalDelta = resizeState.corner.endsWith('right') ? deltaX : -deltaX;
        const verticalDelta = resizeState.corner.startsWith('bottom') ? deltaY : -deltaY;
        const normalizedDelta = ((horizontalDelta / resizeState.elementWidth) + (verticalDelta / resizeState.elementHeight)) / 2;
        const nextScale = resizeState.startScale + (normalizedDelta * 100);

        setConfigDraft(prev => ({
            ...prev,
            mapImageScalePercent: clampMapImageScalePercent(nextScale),
        }));
    };

    const handleMapImageResizePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        const resizeState = mapImageResizeRef.current;
        if (resizeState?.pointerId === event.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            mapImageResizeRef.current = null;
            setIsResizingMapImage(false);
        }
    };

    const handleResetConfigDefaults = () => {
        const defaults = buildDefaultPublicTimetableConfig();
        setConfigDraft(defaults);
        toast.info('Defaults Restored', 'Review the brochure settings and save to publish them for your team.');
    };

    const handleSaveConfig = async () => {
        if (!team?.id || !user?.uid) {
            toast.warning('Sign In Required', 'Sign in to save brochure settings.');
            return;
        }

        const cleanedConfig = {
            disclaimer: configDraft.disclaimer.trim(),
            fareEffectiveDate: configDraft.fareEffectiveDate.trim(),
            fareRows: configDraft.fareRows.map(row => ({
                label: row.label.trim(),
                adult: row.adult.trim(),
                student: row.student.trim(),
                children: row.children.trim(),
                senior: row.senior.trim(),
                family: row.family.trim(),
            })).filter(row => row.label),
            fareNote: configDraft.fareNote.trim(),
            legendItems: configDraft.legendItems.map(item => item.trim()).filter(Boolean),
            promoTitle: configDraft.promoTitle.trim(),
            promoText: configDraft.promoText.trim(),
            contacts: configDraft.contacts.map(contact => contact.trim()).filter(Boolean),
            mapImageScalePercent: clampMapImageScalePercent(configDraft.mapImageScalePercent),
            mapImageOffsetXPercent: clampMapImageOffsetPercent(configDraft.mapImageOffsetXPercent),
            mapImageOffsetYPercent: clampMapImageOffsetPercent(configDraft.mapImageOffsetYPercent),
        };

        if (!cleanedConfig.disclaimer || cleanedConfig.fareRows.length === 0 || cleanedConfig.legendItems.length === 0 || cleanedConfig.contacts.length === 0) {
            toast.warning('Missing Settings', 'Disclaimer, fares, legend items, and contacts must have at least one value.');
            return;
        }

        setSavingConfig(true);
        try {
            await savePublicTimetableConfig(team.id, cleanedConfig, user.uid);
            const nextConfig: PublicTimetableConfigDocument = {
                ...configDraft,
                ...cleanedConfig,
                updatedAt: new Date().toISOString(),
                updatedBy: user.uid,
                version: brochureConfig.version + 1,
            };
            setBrochureConfig(nextConfig);
            setConfigDraft({
                ...nextConfig,
                fareRows: nextConfig.fareRows.map(row => ({ ...row })),
                legendItems: [...nextConfig.legendItems],
                contacts: [...nextConfig.contacts],
            });
            setConfigWarning(null);
            toast.success('Brochure Settings Saved', 'Preview and export now use the updated managed content and map placement.');
        } catch (error) {
            console.error('Error saving public timetable config:', error);
            toast.error('Save Failed', getPublicTimetableConfigErrorMessage(error, 'save'));
        } finally {
            setSavingConfig(false);
        }
    };

    // Generate PDF
    const generatePDF = async () => {
        const pages = [
            brochurePage1Ref.current,
            brochurePage2Ref.current,
        ].filter((page): page is HTMLDivElement => page !== null);

        if (!selectedRoute || pages.length === 0) {
            toast.warning('Nothing To Export', 'Choose a route first.');
            return;
        }

        if (selectedStops.length === 0) {
            toast.warning('No Stops Selected', 'Select at least one stop before exporting.');
            return;
        }

        setGenerating(true);
        try {
            const { default: html2canvas } = await import('html2canvas');
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'letter'
            });

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 5;

            for (const [index, page] of pages.entries()) {
                const canvas = await html2canvas(page, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    ignoreElements: (element) => element instanceof HTMLElement && element.dataset.exportIgnore === 'true',
                });

                const imgData = canvas.toDataURL('image/png');
                const usableWidth = pageWidth - (margin * 2);
                const usableHeight = pageHeight - (margin * 2);
                const ratio = Math.min(usableWidth / canvas.width, usableHeight / canvas.height);
                const imgWidth = canvas.width * ratio;
                const imgHeight = canvas.height * ratio;
                const x = (pageWidth - imgWidth) / 2;
                const y = (pageHeight - imgHeight) / 2;

                if (index > 0) {
                    doc.addPage();
                }

                doc.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight, undefined, 'FAST');
            }

            const filename = `timetable_${selectedRoute}.pdf`;
            doc.save(filename);
            toast.success('PDF Ready', 'The timetable brochure was exported.');
        } catch (error) {
            console.error('Error generating PDF:', error);
            toast.error('Export Failed', 'The timetable brochure could not be exported.');
        } finally {
            setGenerating(false);
        }
    };

    const brochureTitle = headerText.trim() || (selectedRoute ? `Route ${selectedRoute}` : 'Public Timetable');
    const routeConfig = selectedRoute ? getRouteConfig(selectedRoute) : null;
    const isLoopRoute = routeConfig?.segments.length === 1;
    const hasReadyBrochureDay = Object.values(brochureDays).some(day => day.status === 'ready' && day.table);
    const isLandscapeMapRoute = selectedRoute ? LANDSCAPE_MAP_ROUTES.has(selectedRoute) : false;
    const isPortraitHeroMapRoute = selectedRoute ? PORTRAIT_HERO_MAP_ROUTES.has(selectedRoute) : false;
    const mapImageScalePercent = clampMapImageScalePercent(configDraft.mapImageScalePercent);
    const mapImageOffsetXPercent = clampMapImageOffsetPercent(configDraft.mapImageOffsetXPercent);
    const mapImageOffsetYPercent = clampMapImageOffsetPercent(configDraft.mapImageOffsetYPercent);
    const savedMapImageScalePercent = clampMapImageScalePercent(brochureConfig.mapImageScalePercent);
    const savedMapImageOffsetXPercent = clampMapImageOffsetPercent(brochureConfig.mapImageOffsetXPercent);
    const savedMapImageOffsetYPercent = clampMapImageOffsetPercent(brochureConfig.mapImageOffsetYPercent);
    const brochureEffectiveDate = entries
        .filter(entry => entry.routeNumber === selectedRoute)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map(entry => entry.effectiveDate?.trim())
        .find((value): value is string => Boolean(value));
    const brochurePublicSummary = (() => {
        if (!selectedRoute || !routeConfig) {
            return 'Route map and timetable information';
        }

        if (routeConfig.segments.length === 1) {
            return `${routeConfig.segments[0].name} loop`;
        }

        const northTerminus = routeConfig.segments.find(segment => segment.name === 'North')?.terminus;
        const southTerminus = routeConfig.segments.find(segment => segment.name === 'South')?.terminus;

        if (selectedDirection === 'North') {
            return northTerminus ? `Toward ${northTerminus}` : 'Northbound service';
        }

        if (selectedDirection === 'South') {
            return southTerminus ? `Toward ${southTerminus}` : 'Southbound service';
        }

        if (northTerminus && southTerminus) {
            return `${northTerminus} ↔ ${southTerminus}`;
        }

        return 'Service in both directions';
    })();

    const coverDirectionLines = (() => {
        if (!selectedRoute || !routeConfig) {
            return [];
        }

        if (routeConfig.segments.length === 1) {
            const segment = routeConfig.segments[0];
            return [{
                badge: segment.variant,
                text: `${segment.name} loop service`,
            }];
        }

        const directionsToShow = selectedDirection === 'Both'
            ? (['North', 'South'] as const)
            : ([selectedDirection] as const);

        return directionsToShow.map(direction => {
            const segment = routeConfig.segments.find(item => item.name === direction);
            const badge = segment?.variant.split(' ')[0] ?? selectedRoute;
            const variantRemainder = segment?.variant.replace(badge, '').trim() ?? '';

            const text = direction === 'North'
                ? [
                    variantRemainder,
                    segment?.terminus ? (variantRemainder ? `to ${segment.terminus}` : segment.terminus) : null,
                ].filter(Boolean).join(' ')
                : (segment?.terminus || variantRemainder || 'Southbound service');

            return { badge, text };
        });
    })();

    const renderBrochureMapImage = (variant: 'landscape' | 'portrait'): React.ReactElement | null => {
        if (!RENDER_BROCHURE_ROUTE_MAP_IMAGE || !mapImageUrl) {
            return null;
        }

        const isZoomedOut = mapImageScalePercent < 100;
        const backgroundClassName = variant === 'landscape'
            ? 'absolute inset-0 h-full w-full object-cover object-center'
            : 'absolute inset-0 h-full w-full object-cover object-[64%_50%]';
        const foregroundClassName = isZoomedOut
            ? 'absolute inset-0 h-full w-full object-contain object-center'
            : variant === 'landscape'
                ? 'absolute inset-0 h-full w-full object-contain object-center'
                : 'absolute inset-0 h-full w-full object-cover object-[64%_50%]';
        const foregroundStyle: React.CSSProperties = {
            transform: `translate(${mapImageOffsetXPercent}%, ${mapImageOffsetYPercent}%) scale(${mapImageScalePercent / 100})`,
            transformOrigin: 'center center',
        };
        const resizeHandles: Array<{
            corner: MapImageResizeCorner;
            label: string;
            className: string;
        }> = [
            {
                corner: 'top-left',
                label: 'Resize map from top left',
                className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
            },
            {
                corner: 'top-right',
                label: 'Resize map from top right',
                className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
            },
            {
                corner: 'bottom-left',
                label: 'Resize map from bottom left',
                className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
            },
            {
                corner: 'bottom-right',
                label: 'Resize map from bottom right',
                className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
            },
        ];

        return (
            <div
                className={`absolute inset-0 touch-none select-none ${isDraggingMapImage ? 'cursor-grabbing' : isResizingMapImage ? 'cursor-crosshair' : 'cursor-grab'}`}
                onPointerDown={handleMapImagePointerDown}
                onPointerMove={handleMapImagePointerMove}
                onPointerUp={handleMapImagePointerUp}
                onPointerCancel={handleMapImagePointerUp}
                title="Drag to reposition the brochure map"
            >
                {isZoomedOut && (
                    <img
                        src={mapImageUrl}
                        alt=""
                        aria-hidden="true"
                        className={backgroundClassName}
                        draggable={false}
                    />
                )}
                <img
                    src={mapImageUrl}
                    alt={`Route ${selectedRoute} map`}
                    className={foregroundClassName}
                    style={foregroundStyle}
                    draggable={false}
                />
                <div
                    data-export-ignore="true"
                    className="pointer-events-none absolute inset-2 rounded-md border border-dashed border-amber-500/90"
                    aria-hidden="true"
                />
                <div
                    data-export-ignore="true"
                    className="pointer-events-none absolute inset-2"
                >
                    {resizeHandles.map(handle => (
                        <button
                            key={handle.corner}
                            type="button"
                            aria-label={handle.label}
                            title={handle.label}
                            onPointerDown={(event) => handleMapImageResizePointerDown(handle.corner, event)}
                            onPointerMove={handleMapImageResizePointerMove}
                            onPointerUp={handleMapImageResizePointerUp}
                            onPointerCancel={handleMapImageResizePointerUp}
                            className={`pointer-events-auto absolute h-4 w-4 rounded-sm border-2 border-white bg-amber-500 shadow-md ring-1 ring-amber-700/40 ${handle.className}`}
                        />
                    ))}
                </div>
            </div>
        );
    };

    const renderBlankBrochureMapArea = (): React.ReactElement => (
        <div
            className="h-full w-full bg-white"
            aria-label="Blank route map area for manual map placement after export"
        />
    );

    const buildDayDirectionPanels = (
        day: BrochureDayRecord[keyof BrochureDayRecord],
    ): DirectionPanelData[] => {
        if (day.status !== 'ready' || !day.table || !selectedRoute) {
            return [];
        }

        const sortTrips = (trips: MasterTrip[]) => [...trips].sort((a, b) => {
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }

            if (a.blockId !== b.blockId) {
                return a.blockId.localeCompare(b.blockId, undefined, { numeric: true });
            }

            return a.tripNumber - b.tripNumber;
        });

        const northTrips = sortTrips(day.table.rows.flatMap(row => row.trips.filter(trip => trip.direction === 'North')));
        const southTrips = sortTrips(day.table.rows.flatMap(row => row.trips.filter(trip => trip.direction === 'South')));
        const northStops = getVisibleStopsForDirection(day.table.northStops, day.table.northStopIds, selectedStops);
        const southStops = getVisibleStopsForDirection(day.table.southStops, day.table.southStopIds, selectedStops);
        const panels: DirectionPanelData[] = [];

        if ((selectedDirection === 'Both' || selectedDirection === 'North' || isLoopRoute) && northTrips.length > 0 && northStops.length > 0) {
            panels.push({
                key: `${day.dayType}-north`,
                badge: isLoopRoute ? selectedRoute : getDirectionBadge(selectedRoute, 'North'),
                title: buildDirectionTitleFromStops(northStops),
                trips: northTrips,
                stops: northStops,
            });
        }

        if (!isLoopRoute && (selectedDirection === 'Both' || selectedDirection === 'South') && southTrips.length > 0 && southStops.length > 0) {
            panels.push({
                key: `${day.dayType}-south`,
                badge: getDirectionBadge(selectedRoute, 'South'),
                title: buildDirectionTitleFromStops(southStops),
                trips: southTrips,
                stops: southStops,
            });
        }

        if (panels.length === 0 && isLoopRoute && southTrips.length > 0 && southStops.length > 0) {
            panels.push({
                key: `${day.dayType}-loop`,
                badge: selectedRoute,
                title: buildDirectionTitleFromStops(southStops),
                trips: southTrips,
                stops: southStops,
            });
        }

        return panels;
    };

    const buildRoute2RoundTripRows = (
        day: BrochureDayRecord[keyof BrochureDayRecord],
    ): CombinedRoundTripTimetable | null => {
        if (day.status !== 'ready' || !day.table || selectedRoute !== '2' || selectedDirection !== 'Both') {
            return null;
        }

        const sortTrips = (trips: MasterTrip[]) => [...trips].sort((a, b) => {
            if (a.startTime !== b.startTime) return a.startTime - b.startTime;
            if (a.blockId !== b.blockId) return a.blockId.localeCompare(b.blockId, undefined, { numeric: true });
            return a.tripNumber - b.tripNumber;
        });

        const northTrips = sortTrips(day.table.rows.flatMap(row => row.trips.filter(trip => trip.direction === 'North')));
        const southTrips = sortTrips(day.table.rows.flatMap(row => row.trips.filter(trip => trip.direction === 'South')));
        const northStops = getVisibleStopsForDirection(day.table.northStops, day.table.northStopIds, selectedStops);
        const southStops = getVisibleStopsForDirection(day.table.southStops, day.table.southStopIds, selectedStops);

        const findStop = (stops: VisibleBrochureStop[], matcher: (label: string) => boolean): VisibleBrochureStop | null =>
            stops.find(stop => matcher(stop.label.toLowerCase())) ?? null;

        const northParkPlace = findStop(northStops, label => label.includes('park place'));
        const northVeterans = findStop(northStops, label => label.includes("veteran"));
        const northSproule = findStop(northStops, label => label.includes('sproule'));
        const southDowntown = findStop(southStops, label => label.includes('downtown hub') || label === 'downtown');
        const southFerndale = findStop(southStops, label => label.includes('ferndale woods'))
            ?? findStop(southStops, label => label.includes('ferndale'));
        const southVeterans = findStop(southStops, label => label.includes("veteran"));
        const southParkPlace = findStop(southStops, label => label.includes('park place'));

        const columnStops = [
            northParkPlace ? { ...northParkPlace, key: 'north-park-place', direction: 'North' as const } : null,
            northVeterans ? { ...northVeterans, key: 'north-veterans', direction: 'North' as const } : null,
            northSproule ? { ...northSproule, key: 'north-sproule', direction: 'North' as const } : null,
            southDowntown ? { ...southDowntown, key: 'south-downtown', direction: 'South' as const } : null,
            southFerndale ? { ...southFerndale, key: 'south-ferndale', direction: 'South' as const } : null,
            southVeterans ? { ...southVeterans, key: 'south-veterans', direction: 'South' as const } : null,
            southParkPlace ? { ...southParkPlace, key: 'south-park-place', direction: 'South' as const } : null,
        ].filter((stop): stop is VisibleBrochureStop & { key: string; direction: 'North' | 'South' } => stop !== null);

        const columns = columnStops.map(stop => ({
            key: stop.key,
            label: stop.label,
            stopId: stop.stopId,
            direction: stop.direction,
            stopKey: stop.origStop,
        }));

        if (columns.length < 2 || northTrips.length === 0) {
            return null;
        }

        const rows = northTrips.map((northTrip, index) => ({
            key: `${northTrip.id}-${southTrips[index]?.id ?? index}`,
            northTrip,
            southTrip: southTrips[index] ?? null,
        }));

        return {
            columns,
            rows,
            firstBadge: '2A',
            firstTitle: 'Park Place → Downtown Hub',
            secondBadge: '2B',
            secondTitle: 'Downtown Hub → Park Place',
            boundaryIndex: 3,
        };
    };

    const buildRoute8ARoundTripRows = (
        day: BrochureDayRecord[keyof BrochureDayRecord],
    ): CombinedRoundTripTimetable | null => {
        if (day.status !== 'ready' || !day.table || selectedRoute !== '8A' || selectedDirection !== 'Both') {
            return null;
        }

        const sortTrips = (trips: MasterTrip[]) => [...trips].sort((a, b) => {
            if (a.startTime !== b.startTime) return a.startTime - b.startTime;
            if (a.blockId !== b.blockId) return a.blockId.localeCompare(b.blockId, undefined, { numeric: true });
            return a.tripNumber - b.tripNumber;
        });

        const northTrips = sortTrips(day.table.rows.flatMap(row => row.trips.filter(trip => trip.direction === 'North')));
        const southTrips = sortTrips(day.table.rows.flatMap(row => row.trips.filter(trip => trip.direction === 'South')));
        const northStops = getVisibleStopsForDirection(day.table.northStops, day.table.northStopIds, selectedStops);
        const southStops = getVisibleStopsForDirection(day.table.southStops, day.table.southStopIds, selectedStops);

        const findStop = (stops: VisibleBrochureStop[], matcher: (label: string) => boolean): VisibleBrochureStop | null =>
            stops.find(stop => matcher(stop.label.toLowerCase())) ?? null;

        const northBarrieSouth = findStop(northStops, label => label.includes('barrie south'));
        const northParkPlace = findStop(northStops, label => label.includes('park place'));
        const northCommunityCentre = findStop(northStops, label => label.includes('maple hill') || label.includes('peggy hill') || label.includes('community centre'));
        const northAllandale = findStop(northStops, label => label.includes('allandale'));
        const northDowntown = findStop(northStops, label => label.includes('downtown'));
        const northGeorgian = findStop(northStops, label => label.includes('georgian college'));
        const southGeorgian = findStop(southStops, label => label.includes('georgian college'));
        const southGeorgianMall = findStop(southStops, label => label.includes('georgian mall') || label.includes('livingstone'));
        const southAllandale = findStop(southStops, label => label.includes('allandale'));
        const southBarrieSouth = findStop(southStops, label => label.includes('barrie south'));
        const southParkPlace = findStop(southStops, label => label.includes('park place'));

        const columnStops = [
            northBarrieSouth ? { ...northBarrieSouth, key: 'north-barrie-south', direction: 'North' as const } : null,
            northParkPlace ? { ...northParkPlace, key: 'north-park-place', direction: 'North' as const } : null,
            northCommunityCentre ? { ...northCommunityCentre, key: 'north-community-centre', direction: 'North' as const } : null,
            northAllandale ? { ...northAllandale, key: 'north-allandale', direction: 'North' as const } : null,
            northDowntown ? { ...northDowntown, key: 'north-downtown', direction: 'North' as const } : null,
            northGeorgian ? { ...northGeorgian, key: 'north-georgian', direction: 'North' as const } : null,
            southGeorgian ? { ...southGeorgian, key: 'south-georgian', direction: 'South' as const } : null,
            southGeorgianMall ? { ...southGeorgianMall, key: 'south-georgian-mall', direction: 'South' as const } : null,
            southAllandale ? { ...southAllandale, key: 'south-allandale', direction: 'South' as const } : null,
            southBarrieSouth ? { ...southBarrieSouth, key: 'south-barrie-south', direction: 'South' as const } : null,
            southParkPlace ? { ...southParkPlace, key: 'south-park-place', direction: 'South' as const } : null,
        ].filter((stop): stop is VisibleBrochureStop & { key: string; direction: 'North' | 'South' } => stop !== null);

        const columns = columnStops.map(stop => ({
            key: stop.key,
            label: stop.label,
            stopId: stop.stopId,
            direction: stop.direction,
            stopKey: stop.origStop,
        }));
        const boundaryIndex = columns.findIndex(column => column.direction === 'South');

        if (columns.length < 2 || boundaryIndex <= 0 || northTrips.length === 0) {
            return null;
        }

        const usedSouthTripIds = new Set<string>();
        const rows = northTrips.map((northTrip, index) => {
            const matchedSouthTrip = southTrips.find(southTrip => (
                !usedSouthTripIds.has(southTrip.id)
                && southTrip.blockId === northTrip.blockId
                && southTrip.startTime >= northTrip.endTime - 15
            )) ?? southTrips[index] ?? null;

            if (matchedSouthTrip) {
                usedSouthTripIds.add(matchedSouthTrip.id);
            }

            return {
                key: `${northTrip.id}-${matchedSouthTrip?.id ?? index}`,
                northTrip,
                southTrip: matchedSouthTrip,
            };
        });

        return {
            columns,
            rows,
            firstBadge: '8A-NB',
            firstTitle: 'RVH to Georgian College',
            secondBadge: '8A-SB',
            secondTitle: 'Yonge to Park Place',
            boundaryIndex,
        };
    };

    const summarizeDayService = (day: BrochureDayRecord[keyof BrochureDayRecord]) => {
        if (day.status !== 'ready' || !day.table) {
            return {
                label: day.label.replace(' & Holidays', ''),
                hours: 'Not published',
                headway: 'Unavailable',
                isAvailable: false,
            };
        }

        const allTrips = day.table.rows.flatMap(row => row.trips);

        if (allTrips.length === 0) {
            return {
                label: day.label.replace(' & Holidays', ''),
                hours: 'No trips published',
                headway: 'Unavailable',
                isAvailable: false,
            };
        }

        const start = Math.min(...allTrips.map(trip => trip.startTime));
        const end = Math.max(...allTrips.map(trip => trip.endTime));

        return {
            label: day.label.replace(' & Holidays', ''),
            hours: `${formatMinutesForBrochure(start)} – ${formatMinutesForBrochure(end)}`,
            headway: formatFrequencyLabel(estimateHeadwayMinutes(allTrips)),
            isAvailable: true,
        };
    };

    const renderDayTimetable = (
        day: BrochureDayRecord[keyof BrochureDayRecord],
        keyPrefix: string,
    ): React.ReactElement => {
        const panels = buildDayDirectionPanels(day);
        const combinedRoundTrip = buildRoute8ARoundTripRows(day) ?? buildRoute2RoundTripRows(day);

        if (day.status !== 'ready' || !day.table) {
            return (
                <div className="flex-1 min-w-0 flex flex-col rounded-[18px] border border-slate-200 bg-white">
                    <div className="flex items-center justify-between rounded-t-[18px] bg-[#0b5d4f] px-4 py-2.5 text-white">
                        <span className="text-[16px] font-extrabold uppercase tracking-[0.04em]">{day.label.replace(' & Holidays', '')}</span>
                        <span className="text-[11px] font-semibold tracking-wide opacity-90">Unavailable</span>
                    </div>
                    <div className="flex flex-1 items-center justify-center rounded-b-[26px] border border-t-0 border-slate-200 bg-white px-8 text-center text-sm text-slate-500">
                        {day.status === 'loading' ? `Loading ${day.label}...` : day.message ?? `${day.label} timetable unavailable.`}
                    </div>
                </div>
            );
        }

        if (panels.length === 0) {
            return (
                <div className="flex-1 min-w-0 flex flex-col rounded-[18px] border border-slate-200 bg-white">
                    <div className="flex items-center justify-between rounded-t-[18px] bg-[#0b5d4f] px-4 py-2.5 text-white">
                        <span className="text-[16px] font-extrabold uppercase tracking-[0.04em]">{day.label.replace(' & Holidays', '')}</span>
                        <span className="text-[11px] font-semibold tracking-wide opacity-90">Filtered</span>
                    </div>
                    <div className="flex flex-1 items-center justify-center rounded-b-[26px] border border-t-0 border-slate-200 bg-white px-8 text-center text-sm text-slate-500">
                        The current stop and direction filters hide every timetable row for this day.
                    </div>
                </div>
            );
        }

        const qrPattern = [1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1];

        return (
            <div className="flex-1 min-w-0 flex flex-col rounded-[18px] border border-slate-200 bg-white">
                <div className="flex items-center justify-between rounded-t-[18px] bg-[#0b5d4f] px-4 py-2.5 text-white">
                    <span className="text-[16px] font-extrabold uppercase tracking-[0.04em]">
                        {day.label.replace(' & Holidays', '')}
                    </span>
                </div>

                <div className="flex flex-1 flex-col rounded-b-[18px] border border-t-0 border-slate-200 bg-white px-3 pb-2 pt-2">
                    <p className="mb-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold leading-none text-[#0b5d4f]">Scheduled departure times are shown for each listed timepoint and trip.</p>

                    {combinedRoundTrip ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                            {(() => {
                                const tableClasses = getBrochureTableClasses(combinedRoundTrip.columns.length);
                                return (
                                    <>
                            <div className="flex items-center gap-2">
                                <span className="inline-flex min-w-[30px] items-center justify-center rounded-md bg-[#1f6a45] px-1.5 py-0.5 text-[11px] font-extrabold text-white">
                                    {combinedRoundTrip.firstBadge}
                                </span>
                                <span className="text-[12px] font-semibold text-slate-800">{combinedRoundTrip.firstTitle}</span>
                                <span className="text-[11px] font-bold text-slate-400">then</span>
                                <span className="inline-flex min-w-[30px] items-center justify-center rounded-md bg-[#1f6a45] px-1.5 py-0.5 text-[11px] font-extrabold text-white">
                                    {combinedRoundTrip.secondBadge}
                                </span>
                                <span className="text-[12px] font-semibold text-slate-800">{combinedRoundTrip.secondTitle}</span>
                            </div>

                            <div className="flex flex-1 flex-col gap-1.5">
                                {chunkBrochureTableItems(
                                    combinedRoundTrip.rows,
                                    row => row.northTrip?.startTime ?? row.southTrip?.startTime,
                                ).map((rowChunk, chunkIndex) => (
                                    <div key={`${keyPrefix}-round-trip-${chunkIndex}`} className="flex-1 overflow-hidden rounded-[14px] border border-slate-200">
                                        <table className={tableClasses.table}>
                                            <thead>
                                                <tr className="bg-[#f3f5f4]">
                                                    {combinedRoundTrip.columns.map((column, columnIndex) => (
                                                        <th
                                                            key={`${keyPrefix}-round-trip-head-${chunkIndex}-${column.key}`}
                                                            className={`${tableClasses.headerCell} ${columnIndex === combinedRoundTrip.boundaryIndex ? 'border-l-2 border-l-[#0b5d4f]' : ''}`}
                                                        >
                                                            <span className="block">{tableClasses.isWide ? abbreviateBrochureStopName(column.label) : column.label}</span>
                                                            {column.stopId ? (
                                                                <span className={tableClasses.stopId}>{column.stopId}</span>
                                                            ) : null}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rowChunk.map((row, rowIndex) => {
                                                    return (
                                                        <tr
                                                            key={`${keyPrefix}-round-trip-row-${chunkIndex}-${row.key}`}
                                                            className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-[#faf9f7]'}
                                                        >
                                                            {combinedRoundTrip.columns.map((column, columnIndex) => {
                                                                const trip = column.direction === 'North' ? row.northTrip : row.southTrip;
                                                                return (
                                                                    <td
                                                                        key={`${keyPrefix}-round-trip-cell-${chunkIndex}-${row.key}-${column.key}`}
                                                                        className={`${tableClasses.timeCell} ${columnIndex === combinedRoundTrip.boundaryIndex ? 'border-l-2 border-l-[#0b5d4f]' : ''}`}
                                                                    >
                                                                        {trip ? getTripDisplayTime(trip, column.stopKey) : '—'}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                                    </>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="grid flex-1 grid-cols-1 gap-1.5">
                            {panels.map((panel) => {
                            const badgeClassName = panel.key.includes('north')
                                ? 'bg-[#1f6a45] text-white'
                                : panel.key.includes('south')
                                    ? 'bg-[#1f6a45] text-white'
                                    : '';
                            const loopBadgeStyle = panel.key.includes('north') || panel.key.includes('south')
                                ? undefined
                                : { backgroundColor: getRouteColor(selectedRoute), color: getRouteTextColor(selectedRoute) };

                            return (
                                <div key={`${keyPrefix}-${panel.key}`} className="flex min-h-0 flex-col gap-1.5">
                                    {(() => {
                                        const tableClasses = getBrochureTableClasses(panel.stops.length);
                                        return (
                                            <>
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`inline-flex min-w-[30px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-extrabold ${badgeClassName}`}
                                            style={loopBadgeStyle}
                                        >
                                            {panel.badge}
                                        </span>
                                        <span className="text-[12px] font-semibold text-slate-800">{panel.title}</span>
                                    </div>

                                    <div className="flex flex-1 flex-col gap-1.5">
                                        {chunkBrochureTableItems(panel.trips, trip => trip.startTime).map((tripChunk, chunkIndex) => (
                                            <div key={`${keyPrefix}-${panel.key}-${chunkIndex}`} className="flex-1 overflow-hidden rounded-[14px] border border-slate-200">
                                                <table className={tableClasses.table}>
                                                    <thead>
                                                        <tr className="bg-[#f3f5f4]">
                                                            {panel.stops.map((stop) => (
                                                                <th
                                                                    key={`${keyPrefix}-${panel.key}-head-${chunkIndex}-${stop.origStop}`}
                                                                    className={tableClasses.headerCell}
                                                                >
                                                                    <span className="block">{tableClasses.isWide ? abbreviateBrochureStopName(stop.label) : stop.label}</span>
                                                                    {stop.stopId ? (
                                                                        <span className={tableClasses.stopId}>{stop.stopId}</span>
                                                                    ) : null}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {tripChunk.map((trip, tripIndex) => {
                                                            return (
                                                            <tr
                                                                key={`${keyPrefix}-${panel.key}-row-${chunkIndex}-${tripIndex}`}
                                                                className={tripIndex % 2 === 0 ? 'bg-white' : 'bg-[#faf9f7]'}
                                                            >
                                                                {panel.stops.map((stop) => (
                                                                    <td
                                                                        key={`${keyPrefix}-${panel.key}-cell-${chunkIndex}-${tripIndex}-${stop.origStop}`}
                                                                        className={tableClasses.timeCell}
                                                                    >
                                                                        {getTripDisplayTime(trip, stop.origStop)}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ))}
                                    </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            );
                            })}
                        </div>
                    )}

                    <div className={`mt-2 items-end justify-between gap-4 border-t border-slate-200 pt-2 ${panels.length > 1 ? 'hidden' : 'flex'}`}>
                        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                            <Clock3 className="h-4 w-4 text-[#0b5d4f]" />
                            <span>{brochureConfig.disclaimer}</span>
                        </div>

                        <div className="flex items-end gap-3">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                Scan for real-time info
                            </span>
                            <div className="grid grid-cols-4 gap-[2px] rounded-md border border-slate-300 bg-white p-1.5">
                                {qrPattern.map((cell, index) => (
                                    <span
                                        key={`${keyPrefix}-qr-${index}`}
                                        className={`h-2.5 w-2.5 rounded-[1px] ${cell ? 'bg-slate-900' : 'bg-white'}`}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderFrontCover = (): React.ReactElement => {
        const serviceCards = Object.values(brochureDays).map(day => summarizeDayService(day));
        const footerContacts = brochureConfig.contacts.slice(0, 3);
        const singleRideFare = brochureConfig.fareRows.find(row => /single/i.test(row.label));
        const dayPassFare = brochureConfig.fareRows.find(row => /day/i.test(row.label));
        const monthlyFare = brochureConfig.fareRows.find(row => /monthly/i.test(row.label));
        const primaryFareItems = [
            singleRideFare ? { label: 'Adult / Student', value: singleRideFare.adult || singleRideFare.student } : null,
            singleRideFare ? { label: 'Senior', value: singleRideFare.senior } : null,
            singleRideFare ? { label: 'Children', value: singleRideFare.children } : null,
            dayPassFare ? { label: 'Day Pass', value: dayPassFare.adult } : null,
            dayPassFare ? { label: 'Family Day Pass', value: dayPassFare.family } : null,
            monthlyFare ? { label: 'Monthly Adult', value: monthlyFare.adult } : null,
        ].filter((item): item is { label: string; value: string } => Boolean(item?.value && item.value !== '-'));
        const fareTitle = brochureConfig.fareEffectiveDate.toLowerCase().includes('current')
            ? 'Fares'
            : `Fares - ${brochureConfig.fareEffectiveDate}`;

        return (
            <div className="flex h-full gap-4">
                <div className="flex flex-[1.05] min-w-0 flex-col rounded-[18px] border border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h1 className="text-[46px] font-black leading-[0.95] tracking-[-0.05em] text-[#0b5d4f]">
                                {selectedRoute ? `Route ${selectedRoute}` : 'Route'}
                            </h1>
                            <div className="mt-2 space-y-1.5">
                                {coverDirectionLines.length > 0 ? coverDirectionLines.map((line, index) => (
                                    <div key={`${line.badge}-${index}`} className="flex items-center gap-3 leading-none">
                                        <span
                                            className={`inline-flex min-w-[42px] items-center justify-center rounded-lg px-2 py-1.5 text-[16px] font-extrabold leading-none ${
                                                index === 0 ? 'bg-[#1f6a45] text-white' : 'bg-[#1f6a45] text-white'
                                            }`}
                                        >
                                            {line.badge}
                                        </span>
                                        <span className="text-[17px] font-semibold leading-none text-slate-800">{line.text}</span>
                                    </div>
                                )) : (
                                    <p className="text-[17px] font-semibold text-slate-700">{brochurePublicSummary}</p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 text-right">
                            <div className="rounded-xl bg-white px-2.5 py-1.5 text-[#00518c]">
                                <div className="flex items-center gap-2">
                                    <div className="text-right text-[22px] font-black leading-[0.82] tracking-[-0.055em]">
                                        <div>Barrie</div>
                                        <div>Transit</div>
                                    </div>
                                    <svg viewBox="0 0 74 56" className="h-11 w-14 shrink-0" aria-label="Barrie Transit chevron">
                                        <path d="M31 4h27L73 28 58 52H31l16-24L31 4Z" fill="currentColor" />
                                        <path d="M19 4h7l16 24-16 24h-7l16-24L19 4Z" fill="currentColor" />
                                        <path d="M7 4h7l16 24-16 24H7l16-24L7 4Z" fill="currentColor" />
                                    </svg>
                                </div>
                            </div>

                            {brochureEffectiveDate ? (
                                <div className="rounded-xl bg-[#0b5d4f] px-3 py-2 text-right text-white shadow-sm">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] opacity-80">Effective</p>
                                    <p className="mt-0.5 text-[12px] font-semibold">{brochureEffectiveDate}</p>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {isLandscapeMapRoute ? (
                        <div className="relative mt-3 min-h-0 flex-1 overflow-hidden rounded-[18px] border border-[#d5ddd8] bg-[#f6f4ef]">
                            {renderBrochureMapImage('landscape') ?? renderBlankBrochureMapArea()}

                            <div className="absolute bottom-3 left-3 right-3 grid grid-cols-[0.95fr_1.05fr] gap-2">
                                <div className="rounded-[16px] border border-slate-200 bg-white/95 p-2.5 shadow-sm">
                                    <p className="text-[14px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">Service Summary</p>
                                    <div className="mt-1.5 grid grid-cols-1 gap-1.5">
                                        {serviceCards.map(card => (
                                            <div key={card.label} className="rounded-[12px] border border-slate-200 bg-[#eef2ef] px-2 py-1 text-center">
                                                <p className="text-[10px] font-extrabold uppercase leading-none tracking-[0.06em] text-[#0b5d4f]">{card.label}</p>
                                                <p className="mt-1 text-[9px] font-semibold leading-none text-slate-700">{card.hours}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-[16px] border border-slate-200 bg-white/95 p-2.5 shadow-sm">
                                    <p className="text-[14px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">{fareTitle}</p>
                                    <p className="text-[8px] text-slate-500">Exact fare required.</p>
                                    <div className="mt-1 overflow-hidden rounded-[12px] border border-slate-200">
                                        <table className="w-full border-collapse text-[7.5px]">
                                            <thead>
                                                <tr className="bg-[#0b5d4f] text-white">
                                                    {PUBLIC_TIMETABLE_FARE_HEADERS.map((header, index) => (
                                                        <th
                                                            key={header || `fare-head-${index}`}
                                                            className={`px-0.5 py-1 text-[6.5px] font-bold uppercase ${index === 0 ? 'text-left' : 'text-center'}`}
                                                        >
                                                            {header || 'Category'}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {brochureConfig.fareRows.map((row, rowIndex) => (
                                                    <tr key={row.label} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-[#f8f7f3]'}>
                                                        {[row.label, row.adult, row.student, row.children, row.senior, row.family].map((cell, cellIndex) => (
                                                <td
                                                                key={`${row.label}-${cellIndex}`}
                                                                className={`border-t border-slate-200 px-0.5 py-1 align-middle leading-none ${cellIndex === 0 ? 'font-semibold text-slate-700' : 'text-center text-slate-600'}`}
                                                            >
                                                                {cell}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="mt-1 rounded-[12px] bg-[#0b5d4f] px-2 py-1 text-white">
                                        <div className="text-[9px] font-black uppercase tracking-[0.1em]">Barrie Transit</div>
                                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[7.5px]">
                                            {footerContacts.map((contact) => (
                                                <div key={contact} className="flex items-center gap-1">
                                                    {getContactIcon(contact)}
                                                    <span>{contact}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        isPortraitHeroMapRoute ? (
                        <div className="mt-3 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2">
                            <div className="relative min-h-0 overflow-hidden rounded-[18px] border border-[#d5ddd8] bg-[#f6f4ef]">
                                {renderBrochureMapImage('portrait') ?? renderBlankBrochureMapArea()}
                            </div>

                            <div className="grid shrink-0 grid-cols-[0.95fr_1.05fr] gap-2">
                                <div className="rounded-[14px] border border-slate-200 bg-white p-2 shadow-sm">
                                    <p className="text-[12px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">Service Summary</p>
                                    <div className="mt-1 grid grid-cols-3 gap-1">
                                        {serviceCards.map(card => (
                                            <div key={card.label} className="rounded-[10px] border border-slate-200 bg-[#eef2ef] px-1.5 py-1 text-center">
                                                <p className="text-[7px] font-extrabold uppercase leading-none tracking-[0.04em] text-[#0b5d4f]">{card.label}</p>
                                                <p className="mt-1 text-[7px] font-semibold leading-none text-slate-700">{card.hours}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-[14px] border border-slate-200 bg-white p-2 shadow-sm">
                                    <p className="text-[12px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">{fareTitle}</p>
                                    <div className="mt-1 grid grid-cols-3 gap-1">
                                        {primaryFareItems.slice(0, 6).map(item => (
                                            <div key={item.label} className="rounded-[9px] border border-slate-200 bg-[#f8faf8] px-1.5 py-1">
                                                <p className="text-[6.5px] font-bold uppercase leading-none tracking-[0.03em] text-slate-500">{item.label}</p>
                                                <p className="mt-1 text-[10px] font-black leading-none text-[#0b5d4f]">{item.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                        ) : (
                        <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,1.32fr)_minmax(185px,0.68fr)] gap-3">
                            <div className="relative min-h-0 overflow-hidden rounded-[18px] border border-[#d5ddd8] bg-[#f6f4ef]">
                                {renderBrochureMapImage('portrait') ?? renderBlankBrochureMapArea()}
                            </div>

                            <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
                                <div className="shrink-0 rounded-[16px] border border-slate-200 bg-white p-2.5 shadow-sm">
                                    <p className="text-[14px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">Service Summary</p>
                                    <div className="mt-1.5 grid grid-cols-1 gap-1.5">
                                        {serviceCards.map(card => (
                                            <div key={card.label} className="rounded-[12px] border border-slate-200 bg-[#eef2ef] px-2 py-1.5 text-center">
                                                <p className="text-[10px] font-extrabold uppercase leading-none tracking-[0.06em] text-[#0b5d4f]">{card.label}</p>
                                                <p className="mt-1 text-[8.5px] font-semibold leading-none text-slate-700">{card.hours}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 overflow-hidden rounded-[16px] border border-slate-200 bg-white p-2.5 shadow-sm">
                                    <p className="text-[14px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">{fareTitle}</p>
                                    <p className="text-[8.5px] leading-tight text-slate-500">Exact fare required. Common fares shown.</p>
                                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                                        {primaryFareItems.map(item => (
                                            <div key={item.label} className="rounded-[10px] border border-slate-200 bg-[#f8faf8] px-2 py-1.5">
                                                <p className="text-[7px] font-bold uppercase leading-none tracking-[0.05em] text-slate-500">{item.label}</p>
                                                <p className="mt-1 text-[13px] font-black leading-none text-[#0b5d4f]">{item.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="mt-1.5 text-[7.5px] leading-tight text-slate-500">{brochureConfig.fareNote}</p>
                                </div>

                                <div className="shrink-0 rounded-[14px] bg-[#0b5d4f] px-3 py-2 text-white">
                                    <div className="text-[10px] font-black uppercase tracking-[0.1em]">Barrie Transit</div>
                                    <div className="mt-1 grid gap-1 text-[7.5px] leading-none">
                                        {footerContacts.map((contact) => (
                                            <div key={contact} className="flex items-center gap-1 leading-none">
                                                {getContactIcon(contact)}
                                                <span className="leading-none">{contact}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                        )
                    )}
                </div>

                <div className="flex h-full flex-1 min-w-0">
                    {renderDayTimetable(brochureDays.sunday, 'sunday')}
                </div>
            </div>
        );
    };

    const renderBrochurePages = (): React.ReactElement => {
        const pageStyle: React.CSSProperties = {
            width: '1100px',
            height: '894px',
            minWidth: '1100px',
        };

        return (
            <>
                <div className="mx-auto" style={pageStyle}>
                    <div data-export-ignore="true" className="mb-3">
                        <span className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-[14px] font-semibold text-slate-600 shadow-sm">
                            Side A
                        </span>
                    </div>
                    <div
                        ref={brochurePage1Ref}
                        className="h-[calc(100%-44px)] overflow-hidden rounded-[18px] border border-[#d6d6d2] bg-[#ece8e1] p-4 shadow-none"
                    >
                        {renderFrontCover()}
                    </div>
                </div>

                <div className="mx-auto" style={pageStyle}>
                    <div data-export-ignore="true" className="mb-3">
                        <span className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-[14px] font-semibold text-slate-600 shadow-sm">
                            Side B
                        </span>
                    </div>
                    <div
                        ref={brochurePage2Ref}
                        className="h-[calc(100%-44px)] overflow-hidden rounded-[18px] border border-[#d6d6d2] bg-[#ece8e1] p-4 shadow-none"
                    >
                        <div className="flex h-full gap-4">
                            <div className="flex flex-1 min-w-0">
                                {renderDayTimetable(brochureDays.weekday, 'weekday')}
                            </div>
                            <div className="flex flex-1 min-w-0">
                                {renderDayTimetable(brochureDays.saturday, 'saturday')}
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <RefreshCw className="animate-spin text-gray-400" size={32} />
            </div>
        );
    }

    if (!team) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-500 mb-4">Join a team to access master schedules.</p>
                    <button onClick={onBack} className="text-blue-600 hover:underline">
                        ← Back
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <ArrowLeft size={20} />
                        Back
                    </button>
                    <h2 className="text-xl font-bold text-gray-900">Public Timetable Generator</h2>
                </div>
                <button
                    onClick={generatePDF}
                    disabled={generating || selectedStops.length === 0 || !selectedRoute}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {generating ? (
                        <RefreshCw className="animate-spin" size={18} />
                    ) : (
                        <Download size={18} />
                    )}
                    Export PDF
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - Configuration */}
                <div className="w-72 shrink-0 border-r border-gray-200 overflow-y-auto p-4 bg-gray-50">
                    <div className="space-y-6">
                        {/* Route Selection */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Route</label>
                            <select
                                value={selectedRoute}
                                onChange={(e) => {
                                    setSelectedRoute(e.target.value);
                                    setSelectedDirection('Both');
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            >
                                <option value="">Select a route...</option>
                                {routes.map(route => (
                                    <option key={route} value={route}>Route {route}</option>
                                ))}
                            </select>
                        </div>

                        {/* Brochure availability */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Brochure Days</label>
                            <div className="space-y-2">
                                {Object.values(brochureDays).map(day => (
                                    <div
                                        key={day.dayType}
                                        className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                                    >
                                        <span className="font-medium text-gray-800">{day.label}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                            day.status === 'ready'
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : day.status === 'loading'
                                                    ? 'bg-amber-100 text-amber-700'
                                                    : 'bg-gray-100 text-gray-500'
                                        }`}>
                                            {day.status === 'ready' ? 'Ready' : day.status === 'loading' ? 'Loading' : 'Unavailable'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                                Export uses the same published day sets shown here. Missing days stay clearly marked instead of silently dropping out.
                            </p>
                        </div>

                        {/* Direction Selection */}
                        {!isLoopRoute && (
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Direction</label>
                            <div className="flex gap-2">
                                {(['Both', 'North', 'South'] as const).map(dir => (
                                    <button
                                        key={dir}
                                        onClick={() => setSelectedDirection(dir)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                            selectedDirection === dir
                                                ? 'bg-amber-600 text-white'
                                                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        {dir === 'Both' ? 'Both' : `${dir}bound`}
                                    </button>
                                ))}
                            </div>
                        </div>
                        )}

                        {/* Header Text */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                Custom Header (optional)
                            </label>
                            <input
                                type="text"
                                value={headerText}
                                onChange={(e) => setHeaderText(e.target.value)}
                                placeholder={selectedRoute ? `Route ${selectedRoute}` : 'Route title'}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                        </div>

                        {/* Route Map Image */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                Route Map
                            </label>
                            {mapImageUrl ? (
                                <div className="space-y-2">
                                    <div className="relative border border-gray-200 rounded-lg overflow-hidden">
                                        <img
                                            src={mapImageUrl}
                                            alt={`Route ${selectedRoute} map`}
                                            className="w-full h-32 object-contain bg-white"
                                        />
                                        {canManageTeam && (
                                            <button
                                                onClick={handleMapDelete}
                                                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                                                title="Delete map"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <label htmlFor="brochure-map-size" className="text-xs font-bold uppercase tracking-wide text-gray-600">
                                                Front map placement
                                            </label>
                                            <span className="text-xs font-semibold text-gray-500">
                                                {mapImageScalePercent}% · X {mapImageOffsetXPercent} · Y {mapImageOffsetYPercent}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[11px] text-gray-500">
                                            Drag the map to reposition it, or drag a corner handle to resize it.
                                        </p>
                                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => updateMapImagePlacement(85, 0, 0)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                Fit whole
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateMapImagePlacement(100, 0, 0)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                Fill/reset
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateMapImagePlacement(125, 0, 0)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                Larger route
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateMapImagePlacement(savedMapImageScalePercent, savedMapImageOffsetXPercent, savedMapImageOffsetYPercent)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                Saved
                                            </button>
                                        </div>
                                        <input
                                            id="brochure-map-size"
                                            type="range"
                                            min={MAP_IMAGE_SCALE_MIN}
                                            max={MAP_IMAGE_SCALE_MAX}
                                            step={1}
                                            value={mapImageScalePercent}
                                            onChange={(e) => updateMapImageScale(e.target.value)}
                                            className="mt-2 w-full accent-amber-600"
                                        />
                                        <div className="mt-2 space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-gray-500">
                                                Move left/right
                                                <input
                                                    type="range"
                                                    min={MAP_IMAGE_OFFSET_MIN}
                                                    max={MAP_IMAGE_OFFSET_MAX}
                                                    step={1}
                                                    value={mapImageOffsetXPercent}
                                                    onChange={(e) => updateMapImageOffset('x', e.target.value)}
                                                    className="mt-1 w-full accent-amber-600"
                                                />
                                            </label>
                                            <label className="block text-[11px] font-semibold text-gray-500">
                                                Move up/down
                                                <input
                                                    type="range"
                                                    min={MAP_IMAGE_OFFSET_MIN}
                                                    max={MAP_IMAGE_OFFSET_MAX}
                                                    step={1}
                                                    value={mapImageOffsetYPercent}
                                                    onChange={(e) => updateMapImageOffset('y', e.target.value)}
                                                    className="mt-1 w-full accent-amber-600"
                                                />
                                            </label>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={MAP_IMAGE_SCALE_MIN}
                                                max={MAP_IMAGE_SCALE_MAX}
                                                value={mapImageScalePercent}
                                                onChange={(e) => updateMapImageScale(e.target.value)}
                                                className="w-20 rounded-md border border-gray-300 px-2 py-1 text-xs"
                                                aria-label="Front map size percentage"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => updateMapImagePlacement(MAP_IMAGE_SCALE_DEFAULT, 0, 0)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                100% center
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleSaveConfig}
                                            disabled={savingConfig || !canManageTeam}
                                            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Save size={13} />
                                            {savingConfig ? 'Saving...' : 'Save default placement'}
                                        </button>
                                    </div>
                                    {!canManageTeam && (
                                        <p className="text-xs text-gray-500">You can preview size changes. Team owners and admins save brochure map defaults.</p>
                                    )}
                                </div>
                            ) : (
                                canManageTeam ? (
                                    <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                                        !selectedRoute ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleMapUpload}
                                            disabled={!selectedRoute || uploadingMap}
                                            className="hidden"
                                        />
                                        {uploadingMap ? (
                                            <RefreshCw size={20} className="text-gray-400 animate-spin mb-1" />
                                        ) : (
                                            <Image size={20} className="text-gray-400 mb-1" />
                                        )}
                                        <span className="text-xs text-gray-500">
                                            {uploadingMap ? 'Uploading...' : 'Click to upload route map'}
                                        </span>
                                    </label>
                                ) : (
                                    <div className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-lg bg-white px-4 text-center">
                                        <Image size={20} className="text-gray-400 mb-1" />
                                        <span className="text-xs text-gray-500">No map uploaded yet.</span>
                                        <span className="text-[11px] text-gray-400 mt-1">Team owners and admins can add the brochure map.</span>
                                    </div>
                                )
                            )}
                        </div>

                        {(canManageTeam || configWarning) && (
                            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setShowConfigEditor(prev => !prev)}
                                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                                >
                                    <div>
                                        <p className="text-sm font-bold text-gray-700">Brochure Content</p>
                                        <p className="text-xs text-gray-500">
                                            Manage disclaimer, fares, legend text, promo copy, contact details, and map size.
                                        </p>
                                    </div>
                                    {showConfigEditor ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                                </button>

                                {configWarning && (
                                    <div className="px-3 pb-2 text-xs text-amber-700">
                                        {configWarning}
                                    </div>
                                )}

                                {showConfigEditor && (
                                    <div className="border-t border-gray-200 px-3 py-3 space-y-4">
                                        {loadingConfig ? (
                                            <div className="text-sm text-gray-500">Loading brochure settings...</div>
                                        ) : canManageTeam ? (
                                            <>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Disclaimer</label>
                                                    <textarea
                                                        value={configDraft.disclaimer}
                                                        onChange={(e) => setConfigDraft(prev => ({ ...prev, disclaimer: e.target.value }))}
                                                        rows={3}
                                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Fare Effective Date</label>
                                                    <input
                                                        type="text"
                                                        value={configDraft.fareEffectiveDate}
                                                        onChange={(e) => setConfigDraft(prev => ({ ...prev, fareEffectiveDate: e.target.value }))}
                                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Fare Table</label>
                                                    <div className="space-y-2">
                                                        {configDraft.fareRows.map((row, index) => (
                                                            <div key={`${row.label}-${index}`} className="grid grid-cols-2 gap-2">
                                                                <input value={row.label} onChange={(e) => updateFareRow(index, 'label', e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 rounded-md col-span-2" placeholder="Fare label" />
                                                                <input value={row.adult} onChange={(e) => updateFareRow(index, 'adult', e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 rounded-md" placeholder="Adult" />
                                                                <input value={row.student} onChange={(e) => updateFareRow(index, 'student', e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 rounded-md" placeholder="Student" />
                                                                <input value={row.children} onChange={(e) => updateFareRow(index, 'children', e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 rounded-md" placeholder="Children" />
                                                                <input value={row.senior} onChange={(e) => updateFareRow(index, 'senior', e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 rounded-md" placeholder="Senior" />
                                                                <input value={row.family} onChange={(e) => updateFareRow(index, 'family', e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 rounded-md col-span-2" placeholder="Family" />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Fare Note</label>
                                                    <textarea
                                                        value={configDraft.fareNote}
                                                        onChange={(e) => setConfigDraft(prev => ({ ...prev, fareNote: e.target.value }))}
                                                        rows={2}
                                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Legend Items</label>
                                                    <div className="space-y-2">
                                                        {configDraft.legendItems.map((item, index) => (
                                                            <input
                                                                key={`legend-${index}`}
                                                                type="text"
                                                                value={item}
                                                                onChange={(e) => updateStringList('legendItems', index, e.target.value)}
                                                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                                            />
                                                        ))}
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Promo Title</label>
                                                    <input
                                                        type="text"
                                                        value={configDraft.promoTitle}
                                                        onChange={(e) => setConfigDraft(prev => ({ ...prev, promoTitle: e.target.value }))}
                                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Promo Text</label>
                                                    <textarea
                                                        value={configDraft.promoText}
                                                        onChange={(e) => setConfigDraft(prev => ({ ...prev, promoText: e.target.value }))}
                                                        rows={2}
                                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold text-gray-600 mb-1">Contact Footer</label>
                                                    <div className="space-y-2">
                                                        {configDraft.contacts.map((contact, index) => (
                                                            <input
                                                                key={`contact-${index}`}
                                                                type="text"
                                                                value={contact}
                                                                onChange={(e) => updateStringList('contacts', index, e.target.value)}
                                                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                                            />
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveConfig}
                                                        disabled={savingConfig}
                                                        className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60"
                                                    >
                                                        <Save size={14} />
                                                        {savingConfig ? 'Saving...' : 'Save'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleResetConfigDefaults}
                                                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
                                                    >
                                                        <RotateCcw size={14} />
                                                        Defaults
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-sm text-gray-500">
                                                Brochure content is managed by team owners and admins.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Stop Selection */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-bold text-gray-700">
                                    Stops ({selectedStops.length}/{availableStops.length})
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={selectAllStops}
                                        className="text-xs text-amber-600 hover:underline"
                                    >
                                        All
                                    </button>
                                    <button
                                        onClick={selectNoStops}
                                        className="text-xs text-gray-500 hover:underline"
                                    >
                                        None
                                    </button>
                                </div>
                            </div>
                            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                                {availableStops.length === 0 ? (
                                    <p className="p-3 text-sm text-gray-400 text-center">
                                        Select a route to see stops
                                    </p>
                                ) : (
                                    availableStops.map(stop => (
                                        <label
                                            key={stop}
                                            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedStops.includes(stop)}
                                                onChange={() => toggleStop(stop)}
                                                className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                                            />
                                            <span className="text-sm text-gray-700 truncate">{stop}</span>
                                        </label>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Panel - Preview */}
                <div className="flex-1 min-w-0 overflow-auto bg-white p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <Eye size={18} className="text-gray-400" />
                            <h3 className="text-lg font-bold text-gray-900">Preview</h3>
                            <span className="truncate text-sm text-gray-500">Export captures these brochure pages exactly.</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsFullscreenPreview(true)}
                            disabled={!selectedRoute || !hasReadyBrochureDay}
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Maximize2 size={16} />
                            Full screen
                        </button>
                    </div>

                    {!selectedRoute ? (
                        <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-lg">
                            <p className="text-gray-400">Select a route to preview brochure</p>
                        </div>
                    ) : !hasReadyBrochureDay ? (
                        <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-lg">
                            <p className="text-gray-400">No published timetable data is available for this route yet.</p>
                        </div>
                    ) : (
                        <div className="space-y-6 overflow-x-auto pb-4" style={{ fontFamily: 'Arial, sans-serif' }}>
                            {renderBrochurePages()}
                        </div>
                    )}
                </div>
            </div>

            {isFullscreenPreview && selectedRoute && hasReadyBrochureDay ? (
                <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95">
                    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-slate-950 px-5 py-3 text-white">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/55">Brochure preview</p>
                            <h3 className="truncate text-xl font-bold">{brochureTitle}</h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            <button
                                type="button"
                                onClick={generatePDF}
                                disabled={generating || selectedStops.length === 0}
                                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {generating ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
                                Export PDF
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsFullscreenPreview(false)}
                                className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
                            >
                                <X size={16} />
                                Close
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto p-6">
                        <div className="mx-auto w-max space-y-8" style={{ fontFamily: 'Arial, sans-serif' }}>
                            {renderBrochurePages()}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
