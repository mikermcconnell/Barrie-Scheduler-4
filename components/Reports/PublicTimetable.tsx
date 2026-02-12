/**
 * Public Timetable Generator
 *
 * Generates rider-friendly brochure timetables from master schedule data.
 * Matches Barrie Transit's official brochure design.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Download, RefreshCw, Eye, Check, FileText, Upload, Trash2, Image } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { useTeam } from '../TeamContext';
import { getAllMasterSchedules, getMasterSchedule, uploadRouteMap, deleteRouteMap, getRouteMapUrl } from '../../utils/services/masterScheduleService';
import type { MasterScheduleEntry, DayType, RouteIdentity } from '../../utils/masterScheduleTypes';
import type { MasterRouteTable, MasterTrip, RoundTripTable } from '../../utils/parsers/masterScheduleParser';
import { buildRoundTripView } from '../../utils/parsers/masterScheduleParser';
import { buildRouteIdentity } from '../../utils/masterScheduleTypes';
import { getRouteConfig, getRouteDirections } from '../../utils/config/routeDirectionConfig';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';

// Extend jsPDF with autoTable
declare module 'jspdf' {
    interface jsPDF {
        autoTable: (options: AutoTableOptions) => jsPDF;
        lastAutoTable: { finalY: number };
    }
}

interface AutoTableOptions {
    head?: string[][];
    body?: string[][];
    startY?: number;
    theme?: 'striped' | 'grid' | 'plain';
    headStyles?: Record<string, unknown>;
    bodyStyles?: Record<string, unknown>;
    columnStyles?: Record<number, Record<string, unknown>>;
    styles?: Record<string, unknown>;
    margin?: { left?: number; right?: number; top?: number; bottom?: number };
    tableWidth?: 'auto' | 'wrap' | number;
    didDrawPage?: (data: { pageNumber: number }) => void;
    didParseCell?: (data: { section: string; row: { index: number }; column: { index: number }; cell: { styles: Record<string, unknown> } }) => void;
}

interface PublicTimetableProps {
    onBack: () => void;
}

type TimetableFormat = 'brochure';

// Helper to format minutes to time string
const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
};

// Parse time string to minutes
const parseTimeToMinutes = (timeStr: string): number | null => {
    if (!timeStr) return null;
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return null;
    let hours = parseInt(match[1]);
    const mins = parseInt(match[2]);
    const period = match[3]?.toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + mins;
};

// Get direction display label for brochure format
// North (2A): "2A Dunlop to Downtown"
// South (2B): "2B Park Place" (no "to" - it's the return direction)
const getDirectionLabel = (routeNumber: string, direction: 'North' | 'South'): string => {
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

// Get short direction label (e.g., "2A Dunlop")
const getShortDirectionLabel = (routeNumber: string, direction: 'North' | 'South'): string => {
    const directions = getRouteDirections(routeNumber);
    if (directions) {
        const info = direction === 'North' ? directions.north : directions.south;
        return info.variant;
    }
    return direction === 'North' ? 'A' : 'B';
};

// Get route display name (e.g., "Dunlop/Park Place" for Route 2)
const getRouteDisplayName = (routeNumber: string): string => {
    const directions = getRouteDirections(routeNumber);
    if (directions) {
        // Extract the area name from north terminus (e.g., "Dunlop" from "Dunlop to Downtown")
        const northTerminus = directions.north.terminus;
        const northArea = northTerminus.includes(' to ')
            ? northTerminus.split(' to ')[0]
            : northTerminus;
        // South terminus is typically the endpoint name
        const southArea = directions.south.terminus;
        return `${northArea}/\n${southArea}`;
    }
    return `Route ${routeNumber}`;
};

// Format time compactly in 24-hour format (e.g., "18:05" instead of "6:05 PM")
const formatCompactTime = (timeStr: string | undefined): string => {
    if (!timeStr) return '-';
    // Parse time and convert to 24-hour format
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return timeStr.replace(/\s*(AM|PM)$/i, '').trim();

    let hours = parseInt(match[1]);
    const mins = match[2];
    const period = match[3]?.toUpperCase();

    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return `${hours}:${mins}`;
};

// Strip numbered suffixes like (2), (3), (4) from stop names for public display
const stripStopSuffix = (stop: string): string => {
    return stop.replace(/\s*\(\d+\)$/, '');
};

/**
 * De-duplicate stops for public brochure display.
 * When a stop appears multiple times (arrival + departure at timing points),
 * keep only the LAST occurrence (departure time) for each unique stop name.
 * Returns: { displayStops: cleaned stop names, stopMapping: original stop name for each display stop }
 */
const deduplicateStopsForBrochure = (stops: string[]): { displayStops: string[]; stopMapping: string[] } => {
    const seenStops = new Map<string, number>(); // cleanName -> last index

    // First pass: find the last occurrence of each stop name
    stops.forEach((stop, idx) => {
        const cleanName = stripStopSuffix(stop);
        seenStops.set(cleanName, idx); // Overwrites, so we get the last occurrence
    });

    // Second pass: build the de-duplicated list in order
    const displayStops: string[] = [];
    const stopMapping: string[] = []; // Maps display index to original stop name (for time lookup)
    const addedStops = new Set<string>();

    stops.forEach((stop, idx) => {
        const cleanName = stripStopSuffix(stop);
        // Only add if this is the last occurrence (the departure)
        if (seenStops.get(cleanName) === idx && !addedStops.has(cleanName)) {
            displayStops.push(cleanName);
            stopMapping.push(stop); // Keep original name for time lookup
            addedStops.add(cleanName);
        }
    });

    return { displayStops, stopMapping };
};

// Format stop name with (Depart)/(Arrive) annotations for brochure
const formatBrochureStopName = (
    stop: string,
    stopIndex: number,
    totalStops: number,
    _direction: 'North' | 'South'
): string => {
    const isFirst = stopIndex === 0;
    const isLast = stopIndex === totalStops - 1;

    // Origin stop (first in direction) gets "(Depart)" - where trip begins
    if (isFirst) return `${stop} (Depart)`;

    // Destination stop (last in direction) gets "(Arrive)" - where trip ends
    if (isLast) return `${stop} (Arrive)`;

    return stop;
};

export const PublicTimetable: React.FC<PublicTimetableProps> = ({ onBack }) => {
    const { team } = useTeam();
    const [entries, setEntries] = useState<MasterScheduleEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);

    // Selection state
    const [selectedRoute, setSelectedRoute] = useState<string>('');
    const [selectedDayType, setSelectedDayType] = useState<DayType>('Weekday');
    const [selectedDirection, setSelectedDirection] = useState<'North' | 'South' | 'Both'>('Both');
    const [selectedStops, setSelectedStops] = useState<string[]>([]);
    const [format] = useState<TimetableFormat>('brochure');
    const [headerText, setHeaderText] = useState('');

    // Route map image
    const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
    const [uploadingMap, setUploadingMap] = useState(false);

    // Loaded schedule data
    const [scheduleData, setScheduleData] = useState<{
        northTable: MasterRouteTable | null;
        southTable: MasterRouteTable | null;
    }>({ northTable: null, southTable: null });

    // All day types data for brochure format (Weekday, Saturday, Sunday)
    const [allDayTypesData, setAllDayTypesData] = useState<{
        weekday: RoundTripTable | null;
        saturday: RoundTripTable | null;
        sunday: RoundTripTable | null;
    }>({ weekday: null, saturday: null, sunday: null });

    // Build round-trip view for brochure format
    const roundTripTable = useMemo((): RoundTripTable | null => {
        if (!scheduleData.northTable || !scheduleData.southTable) return null;
        return buildRoundTripView(scheduleData.northTable, scheduleData.southTable);
    }, [scheduleData]);

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

    // Get day types for selected route
    const dayTypes = useMemo(() => {
        return entries
            .filter(e => e.routeNumber === selectedRoute)
            .map(e => e.dayType);
    }, [entries, selectedRoute]);

    // Load schedule when route/dayType changes
    useEffect(() => {
        const loadSchedule = async () => {
            if (!team?.id || !selectedRoute || !selectedDayType) {
                setScheduleData({ northTable: null, southTable: null });
                return;
            }

            const routeIdentity = buildRouteIdentity(selectedRoute, selectedDayType);
            try {
                const result = await getMasterSchedule(team.id, routeIdentity);
                if (result) {
                    setScheduleData({
                        northTable: result.content.northTable,
                        southTable: result.content.southTable
                    });
                    // Auto-select all stops initially
                    const allStops = new Set<string>();
                    result.content.northTable.stops.forEach(s => allStops.add(s));
                    result.content.southTable.stops.forEach(s => allStops.add(s));
                    setSelectedStops(Array.from(allStops));
                }
            } catch (error) {
                console.error('Error loading schedule:', error);
            }
        };
        loadSchedule();
    }, [team?.id, selectedRoute, selectedDayType]);

    // Load route map image when route changes
    useEffect(() => {
        const loadMapImage = async () => {
            if (!team?.id || !selectedRoute) {
                setMapImageUrl(null);
                return;
            }
            console.log('[RouteMap] Loading for:', { teamId: team.id, route: selectedRoute });
            try {
                const url = await getRouteMapUrl(team.id, selectedRoute);
                console.log('[RouteMap] Load result:', url ? 'Found' : 'Not found', url);
                setMapImageUrl(url);
            } catch (error) {
                console.error('[RouteMap] Load error:', error);
                setMapImageUrl(null);
            }
        };
        loadMapImage();
    }, [team?.id, selectedRoute]);

    // Load all day types for brochure format
    useEffect(() => {
        const loadAllDayTypes = async () => {
            if (!team?.id || !selectedRoute || format !== 'brochure') {
                return;
            }

            const dayTypesToLoad: DayType[] = ['Weekday', 'Saturday', 'Sunday'];
            const results: { weekday: RoundTripTable | null; saturday: RoundTripTable | null; sunday: RoundTripTable | null } = {
                weekday: null,
                saturday: null,
                sunday: null,
            };

            for (const dayType of dayTypesToLoad) {
                try {
                    const routeIdentity = buildRouteIdentity(selectedRoute, dayType);
                    const result = await getMasterSchedule(team.id, routeIdentity);
                    if (result) {
                        const roundTrip = buildRoundTripView(result.content.northTable, result.content.southTable);
                        // Debug terminus detection
                        console.log(`[Brochure] Route ${selectedRoute} ${dayType}:`, {
                            lastNorthStop: roundTrip.northStops[roundTrip.northStops.length - 1],
                            firstSouthStop: roundTrip.southStops[0],
                            terminusDetected: roundTrip.terminusStop,
                            northStops: roundTrip.northStops,
                            southStops: roundTrip.southStops
                        });
                        if (dayType === 'Weekday') results.weekday = roundTrip;
                        else if (dayType === 'Saturday') results.saturday = roundTrip;
                        else if (dayType === 'Sunday') results.sunday = roundTrip;
                    }
                } catch (error) {
                    console.error(`Error loading ${dayType} schedule:`, error);
                }
            }

            setAllDayTypesData(results);
        };
        loadAllDayTypes();
    }, [team?.id, selectedRoute, format]);

    // Handle map image upload
    const handleMapUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !team?.id || !selectedRoute) {
            console.log('[RouteMap] Upload aborted - missing:', { file: !!file, teamId: team?.id, route: selectedRoute });
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        console.log('[RouteMap] Uploading:', { teamId: team.id, route: selectedRoute, fileName: file.name, fileType: file.type });
        setUploadingMap(true);
        try {
            const url = await uploadRouteMap(team.id, selectedRoute, file);
            console.log('[RouteMap] Upload successful:', url);
            setMapImageUrl(url);
        } catch (error) {
            console.error('[RouteMap] Upload failed:', error);
            alert('Failed to upload map image. Check console for details.');
        } finally {
            setUploadingMap(false);
        }
    };

    // Handle map image delete
    const handleMapDelete = async () => {
        if (!team?.id || !selectedRoute || !mapImageUrl) return;

        if (!confirm('Delete route map image?')) return;

        try {
            await deleteRouteMap(team.id, selectedRoute);
            setMapImageUrl(null);
        } catch (error) {
            console.error('Error deleting map:', error);
            alert('Failed to delete map image');
        }
    };

    // Get available stops based on direction
    const availableStops = useMemo(() => {
        const stops = new Set<string>();
        if (selectedDirection === 'North' || selectedDirection === 'Both') {
            scheduleData.northTable?.stops.forEach(s => stops.add(s));
        }
        if (selectedDirection === 'South' || selectedDirection === 'Both') {
            scheduleData.southTable?.stops.forEach(s => stops.add(s));
        }
        return Array.from(stops);
    }, [scheduleData, selectedDirection]);

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

    // Generate PDF
    const generatePDF = async () => {
        if (!scheduleData.northTable && !scheduleData.southTable) return;

        setGenerating(true);
        try {
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'letter'
            });

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 10;

            // Header
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            const title = headerText || `Route ${selectedRoute} - ${selectedDayType}`;
            doc.text(title, pageWidth / 2, margin + 5, { align: 'center' });

            // Generate tables for each direction
            let currentY = margin + 15;

            const generateDirectionTable = (
                table: MasterRouteTable | null,
                direction: 'North' | 'South',
                startY: number
            ): number => {
                if (!table) return startY;

                // Filter stops
                const filteredStops = table.stops.filter(s => selectedStops.includes(s));
                if (filteredStops.length === 0) return startY;

                // Direction subtitle - use route variant label
                doc.setFontSize(12);
                doc.setFont('helvetica', 'bold');
                doc.text(getDirectionLabel(selectedRoute, direction), margin, startY);
                startY += 5;

                // Grid format: stops as columns, trips as rows
                // Build header rows: stop names + stop IDs
                const stopNamesRow = ['', ...filteredStops];
                const stopIdsRow = ['', ...filteredStops.map(stop => table.stopIds?.[stop] || '')];
                const head = [stopNamesRow, stopIdsRow];

                const body = table.trips.map((trip, idx) => {
                    const row = [`Trip ${idx + 1}`];
                    filteredStops.forEach(stop => {
                        const time = trip.stops[stop] || '-';
                        row.push(time);
                    });
                    return row;
                });

                doc.autoTable({
                    head,
                    body,
                    startY,
                    theme: 'grid',
                    headStyles: {
                        fillColor: [66, 139, 202],
                        textColor: 255,
                        fontSize: 8,
                        fontStyle: 'bold'
                    },
                    bodyStyles: {
                        fontSize: 7,
                        cellPadding: 1
                    },
                    columnStyles: {
                        0: { fontStyle: 'bold', cellWidth: 15 }
                    },
                    styles: {
                        overflow: 'linebreak',
                        cellWidth: 'wrap'
                    },
                    margin: { left: margin, right: margin }
                });

                return doc.lastAutoTable.finalY + 10;
            };

            // Generate based on format selection
            if (format === 'brochure' && roundTripTable) {
                // Brochure format: side-by-side directions
                const northStops = roundTripTable.northStops;
                const southStops = roundTripTable.southStops;
                const totalCols = northStops.length + southStops.length;

                // Build header rows
                const directionRow: string[] = [];
                // Fill north columns with north label, south columns with south label
                northStops.forEach((_, idx) => {
                    directionRow.push(idx === 0 ? getDirectionLabel(selectedRoute, 'North') : '');
                });
                southStops.forEach((_, idx) => {
                    directionRow.push(idx === 0 ? getDirectionLabel(selectedRoute, 'South') : '');
                });

                const stopNamesRow = [...northStops, ...southStops];
                const stopIdsRow = [
                    ...northStops.map(s => roundTripTable.northStopIds?.[s] || ''),
                    ...southStops.map(s => roundTripTable.southStopIds?.[s] || '')
                ];

                // Build body rows from round-trips
                const body = roundTripTable.rows.map(row => {
                    const northTrip = row.trips.find(t => t.direction === 'North');
                    const southTrip = row.trips.find(t => t.direction === 'South');

                    const rowData: string[] = [];
                    northStops.forEach(stop => {
                        rowData.push(northTrip?.stops[stop] || '-');
                    });
                    southStops.forEach(stop => {
                        rowData.push(southTrip?.stops[stop] || '-');
                    });
                    return rowData;
                });

                // Create merged header for direction labels
                doc.autoTable({
                    head: [directionRow, stopNamesRow, stopIdsRow],
                    body,
                    startY: currentY,
                    theme: 'grid',
                    headStyles: {
                        fillColor: [66, 139, 202],
                        textColor: 255,
                        fontSize: 6,
                        fontStyle: 'bold',
                        halign: 'center'
                    },
                    bodyStyles: {
                        fontSize: 6,
                        cellPadding: 0.5,
                        halign: 'center'
                    },
                    styles: {
                        overflow: 'linebreak',
                        cellWidth: 'wrap'
                    },
                    margin: { left: margin, right: margin },
                    // Style for the direction row (first header row)
                    didParseCell: (data) => {
                        if (data.section === 'head' && data.row.index === 0) {
                            data.cell.styles.fillColor = [37, 99, 235]; // Darker blue for direction row
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.fontSize = 8;
                        }
                        if (data.section === 'head' && data.row.index === 2) {
                            // ID row - lighter color
                            data.cell.styles.fillColor = [96, 165, 250];
                            data.cell.styles.fontStyle = 'normal';
                        }
                    }
                });

                currentY = doc.lastAutoTable.finalY + 5;

                // Add route map if available
                if (mapImageUrl) {
                    try {
                        // Load and add the image
                        const img = new window.Image();
                        img.crossOrigin = 'anonymous';
                        await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = () => reject(new Error('Failed to load map image'));
                            img.src = mapImageUrl;
                        });

                        // Calculate image dimensions to fit in remaining space
                        const maxWidth = pageWidth - 2 * margin;
                        const maxHeight = pageHeight - currentY - 20;
                        let imgWidth = img.width;
                        let imgHeight = img.height;

                        // Scale to fit
                        const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 0.5);
                        imgWidth *= scale;
                        imgHeight *= scale;

                        // Center the image
                        const imgX = (pageWidth - imgWidth) / 2;
                        doc.addImage(img, 'PNG', imgX, currentY, imgWidth, imgHeight);
                        currentY += imgHeight + 5;
                    } catch (error) {
                        console.error('Error adding map to PDF:', error);
                    }
                }
            } else {
                // Grid or Linear format - use existing direction-based tables
                if (selectedDirection === 'North' || selectedDirection === 'Both') {
                    currentY = generateDirectionTable(scheduleData.northTable, 'North', currentY);
                }
                if (selectedDirection === 'South' || selectedDirection === 'Both') {
                    // Check if we need a new page
                    if (currentY > pageHeight - 50) {
                        doc.addPage();
                        currentY = margin + 10;
                    }
                    currentY = generateDirectionTable(scheduleData.southTable, 'South', currentY);
                }
            }

            // Footer
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(
                `Generated ${new Date().toLocaleDateString()}`,
                pageWidth / 2,
                pageHeight - 5,
                { align: 'center' }
            );

            // Download
            const filename = `timetable_${selectedRoute}_${selectedDayType}.pdf`;
            doc.save(filename);
        } catch (error) {
            console.error('Error generating PDF:', error);
        } finally {
            setGenerating(false);
        }
    };

    // Preview data for display
    const previewTrips = useMemo(() => {
        const trips: Array<{ direction: 'North' | 'South'; trip: MasterTrip; index: number }> = [];

        if (selectedDirection === 'North' || selectedDirection === 'Both') {
            scheduleData.northTable?.trips.slice(0, 5).forEach((trip, idx) => {
                trips.push({ direction: 'North', trip, index: idx });
            });
        }
        if (selectedDirection === 'South' || selectedDirection === 'Both') {
            scheduleData.southTable?.trips.slice(0, 5).forEach((trip, idx) => {
                trips.push({ direction: 'South', trip, index: idx });
            });
        }

        return trips;
    }, [scheduleData, selectedDirection]);

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
                                onChange={(e) => setSelectedRoute(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            >
                                <option value="">Select a route...</option>
                                {routes.map(route => (
                                    <option key={route} value={route}>Route {route}</option>
                                ))}
                            </select>
                        </div>

                        {/* Day Type Selection */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Day Type</label>
                            <div className="flex gap-2">
                                {(['Weekday', 'Saturday', 'Sunday'] as DayType[]).map(day => (
                                    <button
                                        key={day}
                                        onClick={() => setSelectedDayType(day)}
                                        disabled={!dayTypes.includes(day)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                            selectedDayType === day
                                                ? 'bg-amber-600 text-white'
                                                : dayTypes.includes(day)
                                                    ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                        }`}
                                    >
                                        {day}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Direction Selection */}
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

                        {/* Header Text */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                Custom Header (optional)
                            </label>
                            <input
                                type="text"
                                value={headerText}
                                onChange={(e) => setHeaderText(e.target.value)}
                                placeholder={`Route ${selectedRoute} - ${selectedDayType}`}
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
                                        <button
                                            onClick={handleMapDelete}
                                            className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                                            title="Delete map"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
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
                            )}
                        </div>

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
                        <span className="text-sm text-gray-500">(First 5 trips per direction)</span>
                    </div>

                    {!selectedRoute ? (
                        <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-lg">
                            <p className="text-gray-400">Select a route to preview brochure</p>
                        </div>
                    ) : (
                        /* Brochure format: Two-page layout matching Barrie Transit brochure design */
                        <div className="space-y-6" style={{ fontFamily: 'Arial, sans-serif' }}>
                            {/* Helper function to render a timetable */}
                            {(() => {
                                // Get route color for theming
                                const routeColor = getRouteColor(selectedRoute);
                                const textColor = getRouteTextColor(selectedRoute);

                                // Generate color variations (darker/lighter)
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

                                const renderTimetable = (
                                    table: RoundTripTable,
                                    dayType: string,
                                    keyPrefix: string
                                ) => {
                                    // De-duplicate stops for cleaner public display
                                    // This removes duplicate stops (arrival/departure at same location)
                                    // and keeps only the departure time (last occurrence)
                                    const northDeduped = deduplicateStopsForBrochure(table.northStops);
                                    const southDeduped = deduplicateStopsForBrochure(table.southStops);

                                    return (
                                    <div className="flex-1 min-w-0 flex flex-col">
                                        {/* Day Type Header Banner */}
                                        <div
                                            className="text-center py-1.5 font-bold text-sm tracking-wide"
                                            style={{ backgroundColor: colorDark, color: textColor }}
                                        >
                                            {dayType}
                                        </div>

                                        {/* Timetable with vertical headers */}
                                        <div className="overflow-x-auto flex-1">
                                            <table className="w-full border-collapse text-[8px]">
                                                <thead>
                                                    {/* Direction Headers Row - merged into main table for alignment */}
                                                    <tr style={{ backgroundColor: colorMid }}>
                                                        <th
                                                            colSpan={northDeduped.displayStops.length}
                                                            className="text-center py-1 font-bold text-[10px]"
                                                            style={{ color: textColor }}
                                                        >
                                                            {(() => {
                                                                const label = getDirectionLabel(selectedRoute, 'North');
                                                                const parts = label.split(' to ');
                                                                if (parts.length === 2) {
                                                                    return (
                                                                        <>
                                                                            {parts[0]}<br />
                                                                            <span className="font-normal text-[9px]">to {parts[1]}</span>
                                                                        </>
                                                                    );
                                                                }
                                                                return label;
                                                            })()}
                                                        </th>
                                                        {/* Spacer cell - same column as body spacer */}
                                                        <th
                                                            className="p-0"
                                                            style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                                        />
                                                        <th
                                                            colSpan={southDeduped.displayStops.length}
                                                            className="text-center py-1 font-bold text-[10px]"
                                                            style={{ color: textColor }}
                                                        >
                                                            {(() => {
                                                                const label = getDirectionLabel(selectedRoute, 'South');
                                                                const directions = getRouteDirections(selectedRoute);
                                                                if (directions) {
                                                                    const info = directions.south;
                                                                    return (
                                                                        <>
                                                                            {info.variant}<br />
                                                                            <span className="font-normal text-[9px]">to {info.terminus}</span>
                                                                        </>
                                                                    );
                                                                }
                                                                return label;
                                                            })()}
                                                        </th>
                                                    </tr>
                                                    {/* Vertical stop names row */}
                                                    <tr style={{ backgroundColor: colorLight }}>
                                                        {northDeduped.displayStops.map((stop, idx) => (
                                                            <th
                                                                key={`${keyPrefix}-n-${stop}`}
                                                                className="p-0"
                                                                style={{ minWidth: '32px', maxWidth: '38px', height: '90px', color: textColor, borderRight: `1px solid ${colorBorder}` }}
                                                            >
                                                                <div
                                                                    className="h-full w-full flex items-center justify-center"
                                                                >
                                                                    <span
                                                                        className="whitespace-nowrap text-[7px] font-bold"
                                                                        style={{
                                                                            writingMode: 'vertical-rl',
                                                                            transform: 'rotate(180deg)',
                                                                        }}
                                                                    >
                                                                        {formatBrochureStopName(stop, idx, northDeduped.displayStops.length, 'North')}
                                                                    </span>
                                                                </div>
                                                            </th>
                                                        ))}
                                                        {/* Spacer column between 2A and 2B */}
                                                        <th
                                                            key={`${keyPrefix}-spacer`}
                                                            className="p-0"
                                                            style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                                        />
                                                        {southDeduped.displayStops.map((stop, idx) => (
                                                            <th
                                                                key={`${keyPrefix}-s-${stop}`}
                                                                className="p-0"
                                                                style={{ minWidth: '32px', maxWidth: '38px', height: '90px', color: textColor, borderRight: idx < southDeduped.displayStops.length - 1 ? `1px solid ${colorBorder}` : 'none' }}
                                                            >
                                                                <div
                                                                    className="h-full w-full flex items-center justify-center"
                                                                >
                                                                    <span
                                                                        className="whitespace-nowrap text-[7px] font-bold"
                                                                        style={{
                                                                            writingMode: 'vertical-rl',
                                                                            transform: 'rotate(180deg)',
                                                                        }}
                                                                    >
                                                                        {formatBrochureStopName(stop, idx, southDeduped.displayStops.length, 'South')}
                                                                    </span>
                                                                </div>
                                                            </th>
                                                        ))}
                                                    </tr>
                                                    {/* Stop IDs row */}
                                                    <tr style={{ backgroundColor: colorLighter, color: textColor }} className="text-[7px]">
                                                        {northDeduped.stopMapping.map((origStop, idx) => (
                                                            <th
                                                                key={`${keyPrefix}-nid-${origStop}`}
                                                                className="px-0.5 py-0.5 font-bold text-center"
                                                                style={{ borderRight: `1px solid ${colorBorder}` }}
                                                            >
                                                                {table.northStopIds?.[origStop] || ''}
                                                            </th>
                                                        ))}
                                                        {/* Spacer column between 2A and 2B */}
                                                        <th
                                                            key={`${keyPrefix}-spacer-id`}
                                                            className="p-0"
                                                            style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                                        />
                                                        {southDeduped.stopMapping.map((origStop, idx) => (
                                                            <th
                                                                key={`${keyPrefix}-sid-${origStop}`}
                                                                className="px-0.5 py-0.5 font-bold text-center"
                                                                style={{ borderRight: idx < southDeduped.stopMapping.length - 1 ? `1px solid ${colorBorder}` : 'none' }}
                                                            >
                                                                {table.southStopIds?.[origStop] || ''}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {table.rows.map((row, rowIdx) => {
                                                        const northTrip = row.trips.find(t => t.direction === 'North');
                                                        const southTrip = row.trips.find(t => t.direction === 'South');
                                                        // Alternating row color with light tint of route color
                                                        const rowBg = rowIdx % 2 === 0 ? 'white' : lightenColor(routeColor, 45);

                                                        return (
                                                            <tr
                                                                key={`${keyPrefix}-row-${rowIdx}`}
                                                                style={{ backgroundColor: rowBg }}
                                                            >
                                                                {northDeduped.stopMapping.map((origStop, idx) => (
                                                                    <td
                                                                        key={`${keyPrefix}-n-${origStop}-${rowIdx}`}
                                                                        className="px-0.5 py-[1px] text-center text-gray-800 border-r border-gray-200"
                                                                    >
                                                                        {formatCompactTime(northTrip?.stops[origStop])}
                                                                    </td>
                                                                ))}
                                                                {/* Spacer column between 2A and 2B */}
                                                                <td
                                                                    key={`${keyPrefix}-spacer-${rowIdx}`}
                                                                    className="p-0"
                                                                    style={{ width: '4px', minWidth: '4px', maxWidth: '4px', backgroundColor: spacerColor }}
                                                                />
                                                                {southDeduped.stopMapping.map((origStop, idx) => (
                                                                    <td
                                                                        key={`${keyPrefix}-s-${origStop}-${rowIdx}`}
                                                                        className={`px-0.5 py-[1px] text-center text-gray-800 ${idx < southDeduped.stopMapping.length - 1 ? 'border-r border-gray-200' : ''}`}
                                                                    >
                                                                        {formatCompactTime(southTrip?.stops[origStop])}
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

                                // Letter landscape: 11" × 8.5" at 72 DPI = 792px × 612px
                                // Using scaled dimensions for better preview
                                const pageStyle = {
                                    width: '1000px',
                                    height: '773px', // 1000 / (11/8.5) to maintain letter landscape ratio
                                    maxWidth: '100%',
                                };

                                return (
                                    <>
                                        {/* PAGE 1: Sunday + Route Info Panel - Letter Landscape */}
                                        <div className="bg-white border border-gray-300 shadow-lg overflow-hidden mx-auto" style={pageStyle}>
                                            <div className="text-center text-[10px] text-gray-500 py-1 bg-gray-100 border-b">Page 1 - Front (Letter Landscape 11" × 8.5")</div>
                                            {allDayTypesData.sunday ? (
                                                <div className="flex">
                                                    {/* LEFT SIDE - Sunday Timetable */}
                                                    <div className="flex-1 min-w-0 flex flex-col">
                                                        {renderTimetable(allDayTypesData.sunday, 'Sunday & Holidays', 'sunday')}

                                                        {/* Disclaimer */}
                                                        <div className="px-2 py-1 text-[7px] text-gray-700 border-t border-gray-300">
                                                            <p className="font-semibold">Times are approximate. Riders should arrive at the bus stop at least 5 minutes before the scheduled time.</p>
                                                        </div>

                                                        {/* Fare Table */}
                                                        <div className="px-2 py-1.5 border-t border-gray-300 bg-white">
                                                            <p className="text-[8px] font-bold text-gray-800 mb-1">Transit Fares - Effective May 1, 2025</p>
                                                            <table className="w-full text-[6px] border-collapse">
                                                                <thead>
                                                                    <tr className="bg-[#2d6b6b] text-white">
                                                                        <th className="px-1 py-0.5 text-left font-medium border-r border-[#4d8b8b]"></th>
                                                                        <th className="px-1 py-0.5 text-center font-medium border-r border-[#4d8b8b]">Adult (19-64)</th>
                                                                        <th className="px-1 py-0.5 text-center font-medium border-r border-[#4d8b8b]">Student (13-18)</th>
                                                                        <th className="px-1 py-0.5 text-center font-medium border-r border-[#4d8b8b]">Children (0-12)</th>
                                                                        <th className="px-1 py-0.5 text-center font-medium border-r border-[#4d8b8b]">Senior (65+)</th>
                                                                        <th className="px-1 py-0.5 text-center font-medium">Family</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    <tr className="bg-gray-50">
                                                                        <td className="px-1 py-0.5 font-medium border-r border-gray-200">Single Ride</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$3.50</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$3.50</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">Free</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$3.00</td>
                                                                        <td className="px-1 py-0.5 text-center">-</td>
                                                                    </tr>
                                                                    <tr className="bg-white">
                                                                        <td className="px-1 py-0.5 font-medium border-r border-gray-200">10-Ride Card</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$30</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$26</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">-</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$21</td>
                                                                        <td className="px-1 py-0.5 text-center">-</td>
                                                                    </tr>
                                                                    <tr className="bg-gray-50">
                                                                        <td className="px-1 py-0.5 font-medium border-r border-gray-200">Day Pass</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$8.50</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$8.50</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">-</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$8.50</td>
                                                                        <td className="px-1 py-0.5 text-center">$10</td>
                                                                    </tr>
                                                                    <tr className="bg-white">
                                                                        <td className="px-1 py-0.5 font-medium border-r border-gray-200">Monthly Pass</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$93</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$71.25</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">-</td>
                                                                        <td className="px-1 py-0.5 text-center border-r border-gray-200">$54</td>
                                                                        <td className="px-1 py-0.5 text-center">-</td>
                                                                    </tr>
                                                                </tbody>
                                                            </table>
                                                            <p className="text-[5px] text-gray-600 mt-0.5">Seniors Ride Free on Tuesdays and Thursdays. Single fares are valid, with a transfer, for 90 minutes on any route.</p>
                                                        </div>
                                                    </div>

                                                    {/* RIGHT SIDE - Route Map (50% width) */}
                                                    <div className="flex-1 border-l-2 border-[#2d6b6b] flex flex-col bg-white">
                                                        {/* Route Map - Takes up most of the space */}
                                                        <div className="flex-1 p-3 bg-white overflow-hidden min-h-[250px]">
                                                            {mapImageUrl ? (
                                                                <img src={mapImageUrl} alt={`Route ${selectedRoute} map`} className="w-full h-full object-contain" />
                                                            ) : (
                                                                <div className="h-full min-h-[230px] bg-gray-50 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-sm">
                                                                    Upload route map
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Legend */}
                                                        <div className="px-3 py-2 bg-white border-t border-gray-200">
                                                            <p className="font-bold text-sm text-gray-800 mb-1">Legend</p>
                                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-700">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-4 h-4 rounded-full bg-[#2d6b6b] flex items-center justify-center text-white text-[8px] font-bold">#</div>
                                                                    <span>Timing stop & stop ID listed in schedule</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-4 h-4 rounded-full border-2 border-[#2d6b6b] bg-white flex items-center justify-center text-[#2d6b6b] text-[8px] font-bold">#</div>
                                                                    <span>Regular stop & stop ID</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-4 h-4 rounded bg-[#2d6b6b] flex items-center justify-center text-white text-[8px] font-bold">#</div>
                                                                    <span>Connection to other fixed route</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-4 h-4 rounded bg-gray-200 flex items-center justify-center text-gray-600 text-[8px] font-bold">X</div>
                                                                    <span>Connection to Transit ON Demand</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* MyRide Promo */}
                                                        <div className="px-3 py-2 bg-[#e8f4f4] border-t border-gray-200">
                                                            <p className="text-sm text-gray-800 font-semibold">Visit MyRideBarrie.ca</p>
                                                            <p className="text-xs text-gray-600">or download "Transit" for real-time bus information and trip planning.</p>
                                                        </div>

                                                        {/* Contact Footer */}
                                                        <div className="px-3 py-2 bg-[#2d6b6b] text-white flex items-center justify-between text-xs">
                                                            <span>705-726-4242</span>
                                                            <span>servicebarrie@barrie.ca</span>
                                                            <span>Barrie.ca/Transit</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-8 text-center text-gray-400">
                                                    Loading Sunday schedule...
                                                </div>
                                            )}
                                        </div>

                                        {/* PAGE 2: Weekday | Saturday side by side - Letter Landscape */}
                                        <div className="bg-white border border-gray-300 shadow-lg overflow-hidden mx-auto" style={pageStyle}>
                                            <div className="text-center text-[10px] text-gray-500 py-1 bg-gray-100 border-b">Page 2 - Back (Letter Landscape 11" × 8.5")</div>
                                            {allDayTypesData.weekday && allDayTypesData.saturday ? (
                                                <div className="flex pb-3">
                                                    {/* Weekday Timetable */}
                                                    {renderTimetable(allDayTypesData.weekday, 'Weekday', 'weekday')}

                                                    {/* Divider */}
                                                    <div className="w-[2px] bg-[#0D6B4B]" />

                                                    {/* Saturday Timetable */}
                                                    {renderTimetable(allDayTypesData.saturday, 'Saturday', 'saturday')}
                                                </div>
                                            ) : (
                                                <div className="p-8 text-center text-gray-400">
                                                    Loading Weekday and Saturday schedules...
                                                </div>
                                            )}

                                            {/* Footer for Page 2 */}
                                            <div className="px-2 py-2 text-[6px] text-gray-600 border-t border-gray-300 bg-gray-50">
                                                <p className="font-semibold">Times are approximate. Riders should arrive at the bus stop at least 5 minutes before the scheduled time.</p>
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
