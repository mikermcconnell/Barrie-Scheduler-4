/**
 * Public Timetable Generator
 *
 * Generates rider-friendly brochure timetables from master schedule data.
 * Matches Barrie Transit's official brochure design.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Download, RefreshCw, Eye, Trash2, Image, ChevronDown, ChevronUp, Save, RotateCcw } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { getAllMasterSchedules, getMasterSchedule, uploadRouteMap, deleteRouteMap, getRouteMapUrl } from '../../utils/services/masterScheduleService';
import type { MasterScheduleEntry, DayType } from '../../utils/masterScheduleTypes';
import type { RoundTripTable } from '../../utils/parsers/masterScheduleParser';
import { buildRoundTripView } from '../../utils/parsers/masterScheduleParser';
import { buildRouteIdentity } from '../../utils/masterScheduleTypes';
import { getRouteConfig, getRouteDirections } from '../../utils/config/routeDirectionConfig';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';
import {
    BROCHURE_DAY_ORDER,
    deduplicateStopsForBrochure,
    formatBrochureStopName as formatBrochureStopLabel,
    formatCompactTime,
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

// Get direction display label for brochure format
// North (2A): "2A Dunlop to Downtown"
// South (2B): "2B Park Place" (no "to" - it's the return direction)
const getDirectionLabel = (routeNumber: string, direction: 'North' | 'South'): string => {
    const config = getRouteConfig(routeNumber);
    if (config?.segments.length === 1) {
        return config.segments[0].variant;
    }

    const directions = getRouteDirections(routeNumber);
    if (directions) {
        const info = direction === 'North' ? directions.north : directions.south;
        if (info.terminus) {
            // North direction uses "to" (going TO downtown)
            // South direction just shows the terminus name (returning to origin)
            if (direction === 'North') {
                // If terminus already contains "to", don't add another "to"
                if (info.terminus.toLowerCase().includes(' to ')) {
                    return `${info.variant} ${info.terminus}`;
                }
                return `${info.variant} to ${info.terminus}`;
            } else {
                return `${info.variant} ${info.terminus}`;
            }
        }
        return info.variant;
    }
    // Fallback for unknown routes
    return `${direction}bound`;
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
    const routeBadgeTextColor = selectedRoute ? getRouteTextColor(selectedRoute) : '#ffffff';
    const brochureServiceSummary = selectedRoute
        ? selectedDirection === 'Both'
            ? (isLoopRoute ? 'Loop service' : 'All published directions')
            : getDirectionLabel(selectedRoute, selectedDirection)
        : '';
    const brochureAvailableDays = Object.values(brochureDays)
        .filter(day => day.status === 'ready')
        .map(day => day.label);
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

    const renderDayTimetable = (
        day: BrochureDayRecord[keyof BrochureDayRecord],
        keyPrefix: string
    ): React.ReactElement => {
        if (day.status !== 'ready' || !day.table) {
            return (
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="text-center py-1.5 font-bold text-sm tracking-wide bg-gray-200 text-gray-700">
                        {day.label}
                    </div>
                    <div className="flex-1 flex items-center justify-center border border-gray-200 bg-gray-50 text-center px-6 py-10 text-sm text-gray-500">
                        {day.status === 'loading' ? `Loading ${day.label}...` : day.message ?? `${day.label} timetable unavailable.`}
                    </div>
                </div>
            );
        }

        const routeColor = getRouteColor(selectedRoute);
        const textColor = getRouteTextColor(selectedRoute);
        const darkenColor = (hex: string, percent: number): string => {
            const num = parseInt(hex.slice(1), 16);
            const r = Math.max(0, (num >> 16) - Math.round(255 * percent / 100));
            const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(255 * percent / 100));
            const b = Math.max(0, (num & 0x0000FF) - Math.round(255 * percent / 100));
            return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
        };
        const lightenColor = (hex: string, percent: number): string => {
            const num = parseInt(hex.slice(1), 16);
            const r = Math.min(255, (num >> 16) + Math.round(255 * percent / 100));
            const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(255 * percent / 100));
            const b = Math.min(255, (num & 0x0000FF) + Math.round(255 * percent / 100));
            return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
        };

        const colorDark = darkenColor(routeColor, 15);
        const colorMid = routeColor;
        const colorLight = lightenColor(routeColor, 15);
        const colorLighter = lightenColor(routeColor, 30);
        const colorBorder = lightenColor(routeColor, 20);
        const spacerColor = darkenColor(routeColor, 30);

        const northDeduped = deduplicateStopsForBrochure(day.table.northStops);
        const southDeduped = deduplicateStopsForBrochure(day.table.southStops);

        const northVisibleStops = northDeduped.stopMapping
            .map((origStop, idx) => ({ origStop, label: northDeduped.displayStops[idx] }))
            .filter(stop => selectedStops.includes(stop.origStop));
        const southVisibleStops = southDeduped.stopMapping
            .map((origStop, idx) => ({ origStop, label: southDeduped.displayStops[idx] }))
            .filter(stop => selectedStops.includes(stop.origStop));

        const showNorth = (selectedDirection === 'Both' || selectedDirection === 'North') && northVisibleStops.length > 0;
        const showSouth = (selectedDirection === 'Both' || selectedDirection === 'South') && southVisibleStops.length > 0;
        const showSpacer = showNorth && showSouth;

        if (!showNorth && !showSouth) {
            return (
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="text-center py-1.5 font-bold text-sm tracking-wide bg-gray-200 text-gray-700">
                        {day.label}
                    </div>
                    <div className="flex-1 flex items-center justify-center border border-gray-200 bg-gray-50 text-center px-6 py-10 text-sm text-gray-500">
                        The current stop and direction filters hide all timetable columns for {day.label}.
                    </div>
                </div>
            );
        }

        return (
            <div className="flex-1 min-w-0 flex flex-col">
                <div
                    className="text-center py-1.5 font-bold text-sm tracking-wide"
                    style={{ backgroundColor: colorDark, color: textColor }}
                >
                    {day.label}
                </div>

                <div className="overflow-x-auto flex-1">
                    <table className="w-full border-collapse text-[8px]">
                        <thead>
                            <tr style={{ backgroundColor: colorMid }}>
                                {showNorth && (
                                    <th
                                        colSpan={northVisibleStops.length}
                                        className="text-center py-1 font-bold text-[10px]"
                                        style={{ color: textColor }}
                                    >
                                        {getDirectionLabel(selectedRoute, 'North')}
                                    </th>
                                )}
                                {showSpacer && (
                                    <th
                                        className="p-0"
                                        style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                    />
                                )}
                                {showSouth && (
                                    <th
                                        colSpan={southVisibleStops.length}
                                        className="text-center py-1 font-bold text-[10px]"
                                        style={{ color: textColor }}
                                    >
                                        {getDirectionLabel(selectedRoute, 'South')}
                                    </th>
                                )}
                            </tr>
                            <tr style={{ backgroundColor: colorLight }}>
                                {showNorth && northVisibleStops.map((stop, idx) => (
                                    <th
                                        key={`${keyPrefix}-n-${stop.origStop}`}
                                        className="p-0"
                                        style={{ minWidth: '32px', maxWidth: '38px', height: '90px', color: textColor, borderRight: `1px solid ${colorBorder}` }}
                                    >
                                        <div className="h-full w-full flex items-center justify-center">
                                            <span
                                                className="whitespace-nowrap text-[7px] font-bold"
                                                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                                            >
                                                {formatBrochureStopLabel(stop.label, idx, northVisibleStops.length)}
                                            </span>
                                        </div>
                                    </th>
                                ))}
                                {showSpacer && (
                                    <th
                                        key={`${keyPrefix}-spacer`}
                                        className="p-0"
                                        style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                    />
                                )}
                                {showSouth && southVisibleStops.map((stop, idx) => (
                                    <th
                                        key={`${keyPrefix}-s-${stop.origStop}`}
                                        className="p-0"
                                        style={{ minWidth: '32px', maxWidth: '38px', height: '90px', color: textColor, borderRight: idx < southVisibleStops.length - 1 ? `1px solid ${colorBorder}` : 'none' }}
                                    >
                                        <div className="h-full w-full flex items-center justify-center">
                                            <span
                                                className="whitespace-nowrap text-[7px] font-bold"
                                                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                                            >
                                                {formatBrochureStopLabel(stop.label, idx, southVisibleStops.length)}
                                            </span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                            <tr style={{ backgroundColor: colorLighter, color: textColor }} className="text-[7px]">
                                {showNorth && northVisibleStops.map((stop, idx) => (
                                    <th
                                        key={`${keyPrefix}-nid-${stop.origStop}`}
                                        className="px-0.5 py-0.5 font-bold text-center"
                                        style={{ borderRight: idx < northVisibleStops.length - 1 ? `1px solid ${colorBorder}` : 'none' }}
                                    >
                                        {day.table?.northStopIds?.[stop.origStop] || ''}
                                    </th>
                                ))}
                                {showSpacer && (
                                    <th
                                        key={`${keyPrefix}-spacer-id`}
                                        className="p-0"
                                        style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                    />
                                )}
                                {showSouth && southVisibleStops.map((stop, idx) => (
                                    <th
                                        key={`${keyPrefix}-sid-${stop.origStop}`}
                                        className="px-0.5 py-0.5 font-bold text-center"
                                        style={{ borderRight: idx < southVisibleStops.length - 1 ? `1px solid ${colorBorder}` : 'none' }}
                                    >
                                        {day.table?.southStopIds?.[stop.origStop] || ''}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {day.table.rows.map((row, rowIdx) => {
                                const northTrip = row.trips.find(t => t.direction === 'North');
                                const southTrip = row.trips.find(t => t.direction === 'South');
                                const rowBg = rowIdx % 2 === 0 ? 'white' : lightenColor(routeColor, 45);

                                return (
                                    <tr key={`${keyPrefix}-row-${rowIdx}`} style={{ backgroundColor: rowBg }}>
                                        {showNorth && northVisibleStops.map((stop, idx) => (
                                            <td
                                                key={`${keyPrefix}-n-${stop.origStop}-${rowIdx}`}
                                                className={`px-0.5 py-[1px] text-center text-gray-800 ${idx < northVisibleStops.length - 1 ? 'border-r border-gray-200' : ''}`}
                                            >
                                                {formatCompactTime(northTrip?.stops[stop.origStop])}
                                            </td>
                                        ))}
                                        {showSpacer && (
                                            <td
                                                key={`${keyPrefix}-spacer-${rowIdx}`}
                                                className="p-0"
                                                style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                            />
                                        )}
                                        {showSouth && southVisibleStops.map((stop, idx) => (
                                            <td
                                                key={`${keyPrefix}-s-${stop.origStop}-${rowIdx}`}
                                                className={`px-0.5 py-[1px] text-center text-gray-800 ${idx < southVisibleStops.length - 1 ? 'border-r border-gray-200' : ''}`}
                                            >
                                                {formatCompactTime(southTrip?.stops[stop.origStop])}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
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
                                const routeColor = getRouteColor(selectedRoute);
                                const pageStyle = {
                                    width: '1000px',
                                    height: '773px',
                                    maxWidth: '100%',
                                };

                                return (
                                    <>
                                        <div
                                            ref={brochurePage1Ref}
                                            className="bg-white border border-gray-300 shadow-lg overflow-hidden mx-auto"
                                            style={pageStyle}
                                        >
                                            <div data-export-ignore="true" className="text-center text-[10px] text-gray-500 py-1 bg-gray-100 border-b">
                                                Page 1 - Front (Letter Landscape 11" × 8.5")
                                            </div>
                                            <div className="flex h-[calc(100%-25px)]">
                                                <div className="flex-1 min-w-0 flex flex-col">
                                                    {renderDayTimetable(brochureDays.sunday, 'sunday')}
                                                    <div className="px-2 py-1 text-[7px] text-gray-700 border-t border-gray-300">
                                                        <p className="font-semibold break-words">{brochureConfig.disclaimer}</p>
                                                    </div>
                                                    <div className="px-2 py-1.5 border-t border-gray-300 bg-white">
                                                        <p className="text-[8px] font-bold text-gray-800 mb-1">
                                                            Transit Fares - Effective {brochureConfig.fareEffectiveDate}
                                                        </p>
                                                        <table className="w-full text-[6px] border-collapse">
                                                            <thead>
                                                                <tr className="bg-[#2d6b6b] text-white">
                                                                    {PUBLIC_TIMETABLE_FARE_HEADERS.map((header, index) => (
                                                                        <th key={header || `fare-head-${index}`} className={`px-1 py-0.5 ${index === 0 ? 'text-left' : 'text-center'} font-medium ${index < PUBLIC_TIMETABLE_FARE_HEADERS.length - 1 ? 'border-r border-[#4d8b8b]' : ''}`}>
                                                                            {header}
                                                                        </th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {brochureConfig.fareRows.map((row, rowIndex) => (
                                                                    <tr key={row.label} className={rowIndex % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                                                                        {[row.label, row.adult, row.student, row.children, row.senior, row.family].map((cell, cellIndex) => (
                                                                            <td key={`${row.label}-${cellIndex}`} className={`px-1 py-0.5 ${cellIndex === 0 ? 'font-medium text-left' : 'text-center'} ${cellIndex < PUBLIC_TIMETABLE_FARE_HEADERS.length - 1 ? 'border-r border-gray-200' : ''}`}>
                                                                                <span className="break-words">{cell}</span>
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                        <p className="text-[5px] text-gray-600 mt-0.5 break-words">{brochureConfig.fareNote}</p>
                                                    </div>
                                                </div>

                                                <div className="flex-1 border-l-2 flex flex-col bg-white" style={{ borderColor: routeColor }}>
                                                    <div className="border-b border-slate-200 bg-white">
                                                        <div className="flex items-start gap-3 px-4 py-2.5">
                                                            <div
                                                                className="mt-0.5 h-10 w-1 shrink-0 rounded-full"
                                                                style={{ backgroundColor: routeColor }}
                                                            />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <span
                                                                                className="inline-flex items-center justify-center rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-sm"
                                                                                style={{ backgroundColor: routeColor, color: routeBadgeTextColor }}
                                                                            >
                                                                                Route {selectedRoute}
                                                                            </span>
                                                                            <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                                                                Barrie Transit
                                                                            </span>
                                                                        </div>
                                                                        <p className="mt-1.5 text-[17px] font-semibold tracking-tight text-slate-900">
                                                                            {brochureTitle}
                                                                        </p>
                                                                        <p className="mt-0.5 text-[11px] font-medium text-slate-600">
                                                                            {brochurePublicSummary}
                                                                        </p>
                                                                    </div>

                                                                    {brochureEffectiveDate ? (
                                                                        <div className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-right">
                                                                            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                                                                Effective
                                                                            </p>
                                                                            <p className="mt-0.5 text-[10px] font-semibold text-slate-700">
                                                                                {brochureEffectiveDate}
                                                                            </p>
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex-1 min-h-0 bg-slate-50 px-2.5 py-2.5 overflow-hidden">
                                                        <div className="h-full rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                                                            <div className="mb-1.5 flex items-center gap-1.5 text-slate-500">
                                                                <Image className="h-3 w-3" />
                                                                <p className="text-[9px] font-semibold uppercase tracking-[0.12em]">
                                                                    Route map
                                                                </p>
                                                            </div>
                                                            <div className="flex h-[calc(100%-18px)] items-center justify-center overflow-hidden rounded-md bg-slate-50">
                                                                {mapImageUrl ? (
                                                                    <img
                                                                        src={mapImageUrl}
                                                                        alt={`Route ${selectedRoute} map`}
                                                                        className="block max-w-full max-h-full object-contain"
                                                                    />
                                                                ) : (
                                                                    <div className="h-full min-h-[230px] w-full border-2 border-dashed border-gray-300 flex flex-col items-center justify-center px-6 text-center text-gray-400 text-sm">
                                                                        <p className="font-medium text-gray-500">Route map not available yet</p>
                                                                        <p className="mt-1 text-xs text-gray-400">Use the timetable panel to check stop times and service days.</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="border-t border-slate-200 bg-white px-3 py-2">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="min-w-0 flex flex-wrap gap-1.5 text-[9px] text-slate-600">
                                                                {[brochureServiceSummary, ...brochureAvailableDays].filter(Boolean).map((item) => (
                                                                    <span
                                                                        key={item}
                                                                        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium"
                                                                    >
                                                                        {item}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            <div className="shrink-0 text-[9px] font-medium text-slate-500">
                                                                Major stops shown on map
                                                            </div>
                                                        </div>

                                                        <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-slate-100 pt-1.5">
                                                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-slate-600">
                                                                {brochureConfig.legendItems.slice(0, 3).map((item, index) => (
                                                                    <div key={item} className="flex items-center gap-1.5">
                                                                        <div className={`h-3 w-3 rounded-sm flex items-center justify-center text-[7px] font-bold ${
                                                                            index === 0 ? 'bg-[#2d6b6b] text-white rounded-full' :
                                                                                index === 1 ? 'border border-[#2d6b6b] bg-white text-[#2d6b6b] rounded-full' :
                                                                                    'bg-[#2d6b6b] text-white'
                                                                        }`}>
                                                                            {index < 2 ? '•' : '#'}
                                                                        </div>
                                                                        <span>{item}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className="max-w-[38%] text-right text-[9px] text-slate-600 break-words">
                                                                {brochureConfig.contacts[0] || brochureConfig.contacts[1] || 'barrietransit.ca'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div
                                            ref={brochurePage2Ref}
                                            className="bg-white border border-gray-300 shadow-lg overflow-hidden mx-auto"
                                            style={pageStyle}
                                        >
                                            <div data-export-ignore="true" className="text-center text-[10px] text-gray-500 py-1 bg-gray-100 border-b">
                                                Page 2 - Back (Letter Landscape 11" × 8.5")
                                            </div>
                                            <div className="flex pb-3 h-[calc(100%-25px)]">
                                                {renderDayTimetable(brochureDays.weekday, 'weekday')}
                                                <div className="w-[2px] bg-[#0D6B4B]" />
                                                {renderDayTimetable(brochureDays.saturday, 'saturday')}
                                            </div>

                                            <div className="px-2 py-2 text-[6px] text-gray-600 border-t border-gray-300 bg-gray-50">
                                                <p className="font-semibold break-words">{brochureConfig.disclaimer}</p>
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
