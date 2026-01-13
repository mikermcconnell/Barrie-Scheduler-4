/**
 * Public Timetable Generator
 *
 * Generates rider-friendly timetables from master schedule data.
 * Supports both grid (traditional) and linear (mobile) formats.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Download, RefreshCw, Eye, Grid3X3, List, Check } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { useTeam } from '../TeamContext';
import { getAllMasterSchedules, getMasterSchedule } from '../../utils/masterScheduleService';
import type { MasterScheduleEntry, DayType, RouteIdentity } from '../../utils/masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../../utils/masterScheduleParser';
import { buildRouteIdentity } from '../../utils/masterScheduleTypes';

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
}

interface PublicTimetableProps {
    onBack: () => void;
}

type TimetableFormat = 'grid' | 'linear';

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
    const [format, setFormat] = useState<TimetableFormat>('grid');
    const [headerText, setHeaderText] = useState('');

    // Loaded schedule data
    const [scheduleData, setScheduleData] = useState<{
        northTable: MasterRouteTable | null;
        southTable: MasterRouteTable | null;
    }>({ northTable: null, southTable: null });

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
                direction: string,
                startY: number
            ): number => {
                if (!table) return startY;

                // Filter stops
                const filteredStops = table.stops.filter(s => selectedStops.includes(s));
                if (filteredStops.length === 0) return startY;

                // Direction subtitle
                doc.setFontSize(12);
                doc.setFont('helvetica', 'bold');
                doc.text(`${direction}bound`, margin, startY);
                startY += 5;

                if (format === 'grid') {
                    // Grid format: stops as columns, trips as rows
                    const head = [['', ...filteredStops]];
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
                } else {
                    // Linear format: trip by trip listing
                    const body = table.trips.map((trip, idx) => {
                        const times = filteredStops
                            .map(stop => {
                                const time = trip.stops[stop];
                                return time ? `${stop}: ${time}` : null;
                            })
                            .filter(Boolean)
                            .join(' → ');
                        return [`Trip ${idx + 1}`, times];
                    });

                    doc.autoTable({
                        head: [['Trip', 'Route']],
                        body,
                        startY,
                        theme: 'striped',
                        headStyles: {
                            fillColor: [66, 139, 202],
                            textColor: 255,
                            fontSize: 9,
                            fontStyle: 'bold'
                        },
                        bodyStyles: {
                            fontSize: 8,
                            cellPadding: 2
                        },
                        columnStyles: {
                            0: { fontStyle: 'bold', cellWidth: 20 },
                            1: { cellWidth: 'auto' }
                        },
                        margin: { left: margin, right: margin }
                    });

                    return doc.lastAutoTable.finalY + 10;
                }
            };

            // Generate based on direction selection
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
        const trips: Array<{ direction: string; trip: MasterTrip; index: number }> = [];

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

                        {/* Format Selection */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Format</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setFormat('grid')}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                        format === 'grid'
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <Grid3X3 size={16} />
                                    Grid
                                </button>
                                <button
                                    onClick={() => setFormat('linear')}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                        format === 'linear'
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <List size={16} />
                                    Linear
                                </button>
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

                    {previewTrips.length === 0 ? (
                        <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-lg">
                            <p className="text-gray-400">Select a route to preview timetable</p>
                        </div>
                    ) : format === 'grid' ? (
                        <div className="space-y-6">
                            {/* Group by direction */}
                            {['North', 'South'].map(dir => {
                                const dirTrips = previewTrips.filter(t => t.direction === dir);
                                if (dirTrips.length === 0) return null;
                                if (selectedDirection !== 'Both' && selectedDirection !== dir) return null;

                                const table = dir === 'North' ? scheduleData.northTable : scheduleData.southTable;
                                const filteredStops = table?.stops.filter(s => selectedStops.includes(s)) || [];

                                return (
                                    <div key={dir}>
                                        <h4 className="text-sm font-bold text-gray-700 mb-2">{dir}bound</h4>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full border border-gray-200 text-sm">
                                                <thead>
                                                    <tr className="bg-blue-500 text-white">
                                                        <th className="px-2 py-1 border-r border-blue-400 text-left">Trip</th>
                                                        {filteredStops.map(stop => (
                                                            <th key={stop} className="px-2 py-1 border-r border-blue-400 text-left truncate max-w-24">
                                                                {stop}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {dirTrips.map(({ trip, index }) => (
                                                        <tr key={trip.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                            <td className="px-2 py-1 border border-gray-200 font-medium">
                                                                {index + 1}
                                                            </td>
                                                            {filteredStops.map(stop => (
                                                                <td key={stop} className="px-2 py-1 border border-gray-200 text-gray-600">
                                                                    {trip.stops[stop] || '-'}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {previewTrips.map(({ direction, trip, index }) => {
                                const table = direction === 'North' ? scheduleData.northTable : scheduleData.southTable;
                                const filteredStops = table?.stops.filter(s => selectedStops.includes(s)) || [];

                                return (
                                    <div key={trip.id} className="p-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-sm font-bold text-gray-700">
                                                Trip {index + 1}
                                            </span>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                direction === 'North' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                            }`}>
                                                {direction}bound
                                            </span>
                                        </div>
                                        <div className="text-sm text-gray-600">
                                            {filteredStops
                                                .map(stop => {
                                                    const time = trip.stops[stop];
                                                    return time ? `${stop}: ${time}` : null;
                                                })
                                                .filter(Boolean)
                                                .join(' → ')}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
