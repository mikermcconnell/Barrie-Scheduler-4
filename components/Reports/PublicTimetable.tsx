/**
 * Public Timetable Generator
 *
 * Generates rider-friendly brochure timetables from master schedule data.
 * Matches Barrie Transit's official brochure design.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Download, RefreshCw, Eye, Trash2, Image, ChevronDown, ChevronUp, Save, RotateCcw, Phone, Mail, Globe, Clock3 } from 'lucide-react';
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
const MAP_LEGEND_ITEMS = [
    { label: 'Timepoint stop', markerClassName: 'border-2 border-[#0b5d4f] bg-white' },
    { label: 'Regular stop', markerClassName: 'border border-slate-500 bg-white' },
    { label: 'Transfer point', markerClassName: 'bg-[#0b5d4f] text-white' },
    { label: 'Route path', line: true },
] as const;

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

const chunkTrips = (trips: MasterTrip[], chunkSize: number): MasterTrip[][] => {
    const chunks: MasterTrip[][] = [];
    for (let index = 0; index < trips.length; index += chunkSize) {
        chunks.push(trips.slice(index, index + chunkSize));
    }
    return chunks;
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

export const PublicTimetable: React.FC<PublicTimetableProps> = ({ onBack }) => {
    const { team, canManageTeam } = useTeam();
    const { user } = useAuth();
    const toast = useToast();
    const brochurePage1Ref = useRef<HTMLDivElement | null>(null);
    const brochurePage2Ref = useRef<HTMLDivElement | null>(null);
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

    // Get unique routes
    const routes = useMemo(() => {
        const routeSet = new Set(entries.map(e => e.routeNumber));
        return Array.from(routeSet).sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            return numA - numB;
        });
    }, [entries]);

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
            toast.success('Brochure Settings Saved', 'Preview and export now use the updated managed content.');
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

    const summarizeDayService = (day: BrochureDayRecord[keyof BrochureDayRecord]) => {
        if (day.status !== 'ready' || !day.table) {
            return {
                label: day.label.replace(' & Holidays', ''),
                hours: 'Not published',
                headway: 'Unavailable',
                isAvailable: false,
            };
        }

        const panels = buildDayDirectionPanels(day);
        const allTrips = panels.flatMap(panel => panel.trips);

        if (allTrips.length === 0) {
            return {
                label: day.label.replace(' & Holidays', ''),
                hours: 'Adjust stop filters',
                headway: 'Hidden by filters',
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
        const dayFrequency = formatFrequencyLabel(estimateHeadwayMinutes(panels.flatMap(panel => panel.trips)));
        const columnsPerChunk = panels.length > 1 ? 5 : 6;

        if (day.status !== 'ready' || !day.table) {
            return (
                <div className="flex-1 min-w-0 flex flex-col rounded-[26px] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
                    <div className="flex items-center justify-between rounded-t-[26px] bg-[#0b5d4f] px-5 py-3 text-white">
                        <span className="text-[18px] font-extrabold uppercase tracking-[0.04em]">{day.label.replace(' & Holidays', '')}</span>
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
                <div className="flex-1 min-w-0 flex flex-col rounded-[26px] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
                    <div className="flex items-center justify-between rounded-t-[26px] bg-[#0b5d4f] px-5 py-3 text-white">
                        <span className="text-[18px] font-extrabold uppercase tracking-[0.04em]">{day.label.replace(' & Holidays', '')}</span>
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
            <div className="flex-1 min-w-0 flex flex-col rounded-[26px] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
                <div className="flex items-center justify-between rounded-t-[26px] bg-[#0b5d4f] px-5 py-3 text-white">
                    <span className="text-[18px] font-extrabold uppercase tracking-[0.04em]">
                        {day.label.replace(' & Holidays', '')}
                    </span>
                    <span className="text-[11px] font-semibold tracking-wide opacity-90">{dayFrequency}</span>
                </div>

                <div className="flex flex-1 flex-col rounded-b-[26px] border border-t-0 border-slate-200 bg-white px-4 pb-3 pt-3">
                    <p className="mb-3 text-[11px] text-slate-600">All timepoints and every trip are shown.</p>

                    <div className={`grid flex-1 gap-3 ${panels.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {panels.map((panel) => {
                            const badgeClassName = panel.key.includes('north')
                                ? 'bg-[#1f5da8] text-white'
                                : panel.key.includes('south')
                                    ? 'bg-[#1f6a45] text-white'
                                    : '';
                            const loopBadgeStyle = panel.key.includes('north') || panel.key.includes('south')
                                ? undefined
                                : { backgroundColor: getRouteColor(selectedRoute), color: getRouteTextColor(selectedRoute) };

                            return (
                                <div key={`${keyPrefix}-${panel.key}`} className="flex min-h-0 flex-col gap-3">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`inline-flex min-w-[34px] items-center justify-center rounded-md px-2 py-1 text-[12px] font-extrabold ${badgeClassName}`}
                                            style={loopBadgeStyle}
                                        >
                                            {panel.badge}
                                        </span>
                                        <span className="text-[13px] font-semibold text-slate-800">{panel.title}</span>
                                    </div>

                                    <div className="flex flex-1 flex-col gap-3">
                                        {chunkTrips(panel.trips, columnsPerChunk).map((tripChunk, chunkIndex) => (
                                            <div key={`${keyPrefix}-${panel.key}-${chunkIndex}`} className="overflow-hidden rounded-[18px] border border-slate-200">
                                                <table className="w-full table-fixed border-collapse text-[10px]">
                                                    <thead>
                                                        <tr className="bg-[#f3f5f4]">
                                                            <th className="w-[36%] px-2.5 py-2 text-left text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
                                                                Stop
                                                            </th>
                                                            {tripChunk.map((trip, tripIndex) => {
                                                                const firstTime = panel.stops.map(stop => trip.stops[stop.origStop]).find(Boolean);
                                                                return (
                                                                    <th
                                                                        key={`${keyPrefix}-${panel.key}-head-${chunkIndex}-${tripIndex}`}
                                                                        className="border-l border-slate-200 px-1 py-2 text-center text-[9px] font-bold text-slate-700"
                                                                    >
                                                                        {formatBrochureHeaderTime(firstTime)}
                                                                    </th>
                                                                );
                                                            })}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {panel.stops.map((stop, stopIndex) => (
                                                            <tr
                                                                key={`${keyPrefix}-${panel.key}-row-${stop.origStop}`}
                                                                className={stopIndex % 2 === 0 ? 'bg-white' : 'bg-[#faf9f7]'}
                                                            >
                                                                <td className="border-t border-slate-200 px-2.5 py-2 align-top">
                                                                    <div className="font-semibold text-slate-800">{stop.label}</div>
                                                                    {stop.stopId ? (
                                                                        <div className="mt-0.5 text-[9px] font-medium text-slate-400">{stop.stopId}</div>
                                                                    ) : null}
                                                                </td>
                                                                {tripChunk.map((trip, tripIndex) => (
                                                                    <td
                                                                        key={`${keyPrefix}-${panel.key}-cell-${stop.origStop}-${chunkIndex}-${tripIndex}`}
                                                                        className="border-l border-t border-slate-200 px-1.5 py-2 text-center font-medium text-slate-700"
                                                                    >
                                                                        {getTripDisplayTime(trip, stop.origStop)}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-4 border-t border-slate-200 pt-3">
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

        return (
            <div className="flex h-full">
                <div className="flex-1 min-w-0 rounded-[26px] bg-white px-7 py-6 shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h1 className="text-[62px] font-black leading-[0.95] tracking-[-0.05em] text-[#0b5d4f]">
                                {selectedRoute ? `Route ${selectedRoute}` : 'Route'}
                            </h1>
                            <div className="mt-3 space-y-1">
                                {coverDirectionLines.length > 0 ? coverDirectionLines.map((line, index) => (
                                    <div key={`${line.badge}-${index}`} className="flex items-center gap-3">
                                        <span
                                            className={`inline-flex min-w-[42px] items-center justify-center rounded-lg px-2 py-1 text-[16px] font-extrabold ${
                                                index === 0 ? 'bg-[#1f5da8] text-white' : 'bg-[#1f6a45] text-white'
                                            }`}
                                        >
                                            {line.badge}
                                        </span>
                                        <span className="text-[18px] font-semibold text-slate-800">{line.text}</span>
                                    </div>
                                )) : (
                                    <p className="text-[18px] font-semibold text-slate-700">{brochurePublicSummary}</p>
                                )}
                            </div>
                        </div>

                        {brochureEffectiveDate ? (
                            <div className="rounded-2xl bg-[#0b5d4f] px-4 py-3 text-right text-white shadow-sm">
                                <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-80">Effective</p>
                                <p className="mt-1 text-[14px] font-semibold">{brochureEffectiveDate}</p>
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-5 overflow-hidden rounded-[22px] border border-[#d5ddd8] bg-[#f6f4ef]">
                        <div
                            className={`relative overflow-hidden ${isLandscapeMapRoute ? 'h-[220px]' : 'h-[270px]'}`}
                        >
                            {mapImageUrl ? (
                                <img
                                    src={mapImageUrl}
                                    alt={`Route ${selectedRoute} map`}
                                    className="h-full w-full object-contain"
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center bg-[#f8f7f3] text-center text-sm text-slate-400">
                                    Route map not uploaded yet
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-4">
                        <p className="text-[20px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">Legend</p>
                        <div className="mt-2 flex flex-wrap gap-2 rounded-[18px] border border-slate-200 bg-white px-3 py-2.5 text-[11px] text-slate-600">
                            {MAP_LEGEND_ITEMS.map(item => (
                                <div key={item.label} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-1">
                                    {item.line ? (
                                        <span className="block h-[2px] w-8 rounded-full bg-[#0b5d4f]" />
                                    ) : (
                                        <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${item.markerClassName}`}>
                                            {item.label === 'Transfer point' ? '+' : ''}
                                        </span>
                                    )}
                                    <span>{item.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4">
                        <p className="text-[20px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">Service Summary</p>
                        <div className="mt-2 grid grid-cols-3 gap-3">
                            {serviceCards.map(card => (
                                <div key={card.label} className="rounded-[18px] border border-slate-200 bg-[#eef2ef] px-3 py-3 text-center shadow-sm">
                                    <p className="text-[13px] font-extrabold uppercase tracking-[0.06em] text-[#0b5d4f]">{card.label}</p>
                                    <p className="mt-2 text-[12px] font-semibold text-slate-700">{card.hours}</p>
                                    <p className="mt-1 text-[12px] font-medium text-slate-600">{card.headway}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4">
                        <p className="text-[20px] font-extrabold uppercase tracking-[0.03em] text-[#0b5d4f]">Fares</p>
                        <p className="mt-1 text-[11px] text-slate-500">Exact fare required. Operators do not carry change.</p>
                        <div className="mt-2 overflow-hidden rounded-[18px] border border-slate-200">
                            <table className="w-full border-collapse text-[10px]">
                                <thead>
                                    <tr className="bg-[#0b5d4f] text-white">
                                        {PUBLIC_TIMETABLE_FARE_HEADERS.map((header, index) => (
                                            <th
                                                key={header || `fare-head-${index}`}
                                                className={`px-2 py-2 text-[10px] font-bold uppercase tracking-[0.08em] ${
                                                    index === 0 ? 'text-left' : 'text-center'
                                                }`}
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
                                                    className={`border-t border-slate-200 px-2 py-1.5 ${
                                                        cellIndex === 0 ? 'font-semibold text-slate-700' : 'text-center text-slate-600'
                                                    }`}
                                                >
                                                    {cell}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">{brochureConfig.fareNote}</p>
                    </div>

                    <div className="mt-5 rounded-[20px] bg-[#0b5d4f] px-5 py-4 text-white">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="text-[14px] font-black uppercase tracking-[0.14em]">Barrie Transit</div>
                                <div className="mt-1 text-[12px] text-white/80">{brochureTitle}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-x-4 gap-y-2 text-[11px]">
                                {footerContacts.map((contact) => (
                                    <div key={contact} className="flex items-center gap-1.5">
                                        {getContactIcon(contact)}
                                        <span>{contact}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="ml-5 flex-1 min-w-0">
                    {renderDayTimetable(brochureDays.sunday, 'sunday')}
                </div>
            </div>
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
                        ← Back to Reports
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
                <div className="w-80 border-r border-gray-200 overflow-y-auto p-4 bg-gray-50">
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
                                    {!canManageTeam && (
                                        <p className="text-xs text-gray-500">Team owners and admins manage brochure map images.</p>
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
                                            Manage disclaimer, fares, legend text, promo copy, and contact details.
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
                                                                <input value={row.label} onChange={(e) => updateFareRow(index, 'label', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-300 rounded-md col-span-2" placeholder="Fare label" />
                                                                <input value={row.adult} onChange={(e) => updateFareRow(index, 'adult', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-300 rounded-md" placeholder="Adult" />
                                                                <input value={row.student} onChange={(e) => updateFareRow(index, 'student', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-300 rounded-md" placeholder="Student" />
                                                                <input value={row.children} onChange={(e) => updateFareRow(index, 'children', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-300 rounded-md" placeholder="Children" />
                                                                <input value={row.senior} onChange={(e) => updateFareRow(index, 'senior', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-300 rounded-md" placeholder="Senior" />
                                                                <input value={row.family} onChange={(e) => updateFareRow(index, 'family', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-300 rounded-md col-span-2" placeholder="Family" />
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
                <div className="flex-1 overflow-auto p-6 bg-white">
                    <div className="flex items-center gap-2 mb-4">
                        <Eye size={18} className="text-gray-400" />
                        <h3 className="text-lg font-bold text-gray-900">Preview</h3>
                        <span className="text-sm text-gray-500">Export captures these brochure pages exactly.</span>
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
                        <div className="space-y-6" style={{ fontFamily: 'Arial, sans-serif' }}>
                            {(() => {
                                const pageStyle = {
                                    width: '1180px',
                                    height: '770px',
                                    maxWidth: '100%',
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
                                                className="h-[calc(100%-44px)] overflow-hidden rounded-[30px] border border-[#d6d6d2] bg-[#ece8e1] p-7 shadow-[0_20px_55px_rgba(15,23,42,0.18)]"
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
                                                className="h-[calc(100%-44px)] overflow-hidden rounded-[30px] border border-[#d6d6d2] bg-[#ece8e1] p-7 shadow-[0_20px_55px_rgba(15,23,42,0.18)]"
                                            >
                                                <div className="flex h-full gap-5">
                                                    <div className="flex-1 min-w-0">
                                                        {renderDayTimetable(brochureDays.weekday, 'weekday')}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        {renderDayTimetable(brochureDays.saturday, 'saturday')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
