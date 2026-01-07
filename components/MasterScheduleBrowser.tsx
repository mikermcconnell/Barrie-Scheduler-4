/**
 * Master Schedule Browser - Excel-like Tabbed Interface
 *
 * Main UI for viewing all route schedules with tabbed navigation.
 * Includes Overview tab with service hours and route-specific schedule views.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Loader2,
    CalendarOff,
    Maximize2,
    Minimize2,
    Download
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { useTeam } from './TeamContext';
import { useToast } from './ToastContext';
import { TeamManagement } from './TeamManagement';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import {
    getAllMasterSchedules,
    getMasterSchedule,
    deleteMasterSchedule,
    loadForTweaker
} from '../utils/masterScheduleService';
import type {
    MasterScheduleEntry,
    MasterScheduleContent,
    RouteIdentity,
    DayType
} from '../utils/masterScheduleTypes';
import { buildRouteIdentity } from '../utils/masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../utils/masterScheduleParser';
import { buildRoundTripView } from '../utils/masterScheduleParser';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';
import { PlatformSummary } from './PlatformSummary';
import { ScheduleEditor } from './ScheduleEditor';

// Constants
const ROUTE_ORDER = ['400', '100', '101', '2', '7', '8A', '8B', '10', '11', '12'] as const;
const DAY_TYPES: DayType[] = ['Weekday', 'Saturday', 'Sunday'];
const ANNUAL_MULTIPLIERS: Record<DayType, number> = {
    Weekday: 252,
    Saturday: 52,
    Sunday: 61,
};

interface MasterScheduleBrowserProps {
    onLoadToTweaker?: (schedules: MasterRouteTable[]) => void;
    onClose?: () => void;
}

// Helper: Calculate trip duration handling midnight rollover
function getTripDuration(startTime: number, endTime: number): number {
    if (endTime >= startTime) {
        return endTime - startTime;
    }
    // Trip crosses midnight - add 24 hours (1440 minutes) to endTime
    return (endTime + 1440) - startTime;
}

// Helper: Calculate daily service hours from schedule content (sum of all cycle times)
function calculateDailyServiceHours(content: MasterScheduleContent): number {
    const allTrips = [...content.northTable.trips, ...content.southTable.trips];
    if (allTrips.length === 0) return 0;

    // Use pre-calculated cycleTime from each trip (includes interline adjustments)
    let totalCycleMinutes = 0;
    allTrips.forEach(trip => {
        if (trip.cycleTime > 0 && trip.cycleTime < 1440) { // Sanity check: less than 24 hours
            totalCycleMinutes += trip.cycleTime;
        }
    });

    return totalCycleMinutes / 60; // Convert minutes to hours
}

// Helper: Format time from minutes
function formatTimeFromMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// Helper: Format hours for display with comma separators
function formatHours(hours: number): string {
    return hours.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'h';
}

export const MasterScheduleBrowser: React.FC<MasterScheduleBrowserProps> = ({
    onLoadToTweaker,
    onClose
}) => {
    const { team, hasTeam } = useTeam();
    const toast = useToast();

    // State
    const [selectedRoute, setSelectedRoute] = useState<string | 'overview' | 'platforms'>('overview');
    const [selectedDayType, setSelectedDayType] = useState<DayType>('Weekday');
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [schedules, setSchedules] = useState<MasterScheduleEntry[]>([]);
    const [contentCache, setContentCache] = useState<Map<RouteIdentity, MasterScheduleContent>>(new Map());
    const [loading, setLoading] = useState(true);
    const [loadingContent, setLoadingContent] = useState(false);

    // Version History State
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [selectedRouteIdentity, setSelectedRouteIdentity] = useState<RouteIdentity | null>(null);
    const [selectedCurrentVersion, setSelectedCurrentVersion] = useState<number>(1);

    const loadSchedules = useCallback(async () => {
        if (!team) return;

        setLoading(true);
        try {
            const data = await getAllMasterSchedules(team.id);
            setSchedules(data);
        } catch (error) {
            console.error('Error loading master schedules:', error);
            toast?.error('Failed to load master schedules');
        } finally {
            setLoading(false);
        }
    }, [team, toast]);

    // Load all schedules on mount
    useEffect(() => {
        if (hasTeam && team) {
            loadSchedules();
        } else {
            setLoading(false);
        }
    }, [hasTeam, team, loadSchedules]);

    const loadContentIfNeeded = useCallback(async (routeIdentity: RouteIdentity) => {
        if (contentCache.has(routeIdentity) || !team) return;

        setLoadingContent(true);
        try {
            const result = await getMasterSchedule(team.id, routeIdentity);
            if (result) {
                setContentCache(prev => new Map(prev).set(routeIdentity, result.content));
            }
        } catch (error) {
            console.error('Error loading schedule content:', error);
        } finally {
            setLoadingContent(false);
        }
    }, [contentCache, team]);

    // Lazy load content when route+dayType changes
    useEffect(() => {
        if (selectedRoute !== 'overview' && selectedRoute !== 'platforms' && team) {
            const routeIdentity = buildRouteIdentity(selectedRoute, selectedDayType);
            loadContentIfNeeded(routeIdentity);
        }
    }, [selectedRoute, selectedDayType, team, loadContentIfNeeded]);

    // Preload all content for overview tab to show accurate service hours
    useEffect(() => {
        if (selectedRoute === 'overview' && team && schedules.length > 0) {
            // Load all schedule content in parallel
            schedules.forEach(entry => {
                const routeIdentity = buildRouteIdentity(entry.routeNumber, entry.dayType);
                loadContentIfNeeded(routeIdentity);
            });
        }
    }, [selectedRoute, team, schedules, loadContentIfNeeded]);

    // Handlers
    const handleDelete = async (routeIdentity: RouteIdentity, routeNumber: string, dayType: DayType) => {
        if (!team) return;

        if (!confirm(`Delete ${routeNumber} (${dayType})? This will remove all versions.`)) {
            return;
        }

        try {
            await deleteMasterSchedule(team.id, routeIdentity);
            toast?.success('Schedule deleted');
            // Remove from cache
            setContentCache(prev => {
                const newCache = new Map(prev);
                newCache.delete(routeIdentity);
                return newCache;
            });
            await loadSchedules();
        } catch (error) {
            console.error('Error deleting schedule:', error);
            toast?.error('Failed to delete schedule');
        }
    };

    const handleLoadToTweaker = async (routeIdentity: RouteIdentity) => {
        if (!team) return;

        try {
            const tables = await loadForTweaker(team.id, routeIdentity);
            if (onLoadToTweaker) {
                onLoadToTweaker(tables);
                toast?.success('Loading into Schedule Tweaker...');
                // Note: Don't call onClose() here - let the parent handle view switching to tweaker
            } else {
                toast?.error('Load to Tweaker not configured');
            }
        } catch (error) {
            console.error('Error loading to tweaker:', error);
            toast?.error('Failed to load schedule');
        }
    };

    const handleShowHistory = (routeIdentity: RouteIdentity, currentVersion: number) => {
        setSelectedRouteIdentity(routeIdentity);
        setSelectedCurrentVersion(currentVersion);
        setShowVersionHistory(true);
    };

    const handleHistoryClose = () => {
        setShowVersionHistory(false);
        setSelectedRouteIdentity(null);
        loadSchedules();
    };

    // Data organization
    const organizedSchedules = ROUTE_ORDER.reduce((acc, route) => {
        acc[route] = {
            Weekday: schedules.find(s => s.routeNumber === route && s.dayType === 'Weekday'),
            Saturday: schedules.find(s => s.routeNumber === route && s.dayType === 'Saturday'),
            Sunday: schedules.find(s => s.routeNumber === route && s.dayType === 'Sunday'),
        };
        return acc;
    }, {} as Record<string, Record<DayType, MasterScheduleEntry | undefined>>);

    // No Team State
    if (!hasTeam) {
        return (
            <div className="p-8">
                <TeamManagement onClose={onClose} />
            </div>
        );
    }

    // Version History Panel
    if (showVersionHistory && selectedRouteIdentity && team) {
        return (
            <VersionHistoryPanel
                teamId={team.id}
                routeIdentity={selectedRouteIdentity}
                currentVersion={selectedCurrentVersion}
                onClose={handleHistoryClose}
            />
        );
    }

    // Helper: Calculate service hours from content (uses pre-calculated cycleTime per trip)
    const calculateServiceHours = (content: MasterScheduleContent | undefined): number => {
        if (!content) return 0;

        let totalCycleMinutes = 0;

        // Use pre-calculated cycleTime from each trip (includes interline adjustments)
        const allTrips = [...content.northTable.trips, ...content.southTable.trips];
        allTrips.forEach(trip => {
            if (trip.cycleTime > 0 && trip.cycleTime < 1440) { // Sanity check: less than 24 hours
                totalCycleMinutes += trip.cycleTime;
            }
        });

        return totalCycleMinutes / 60; // Convert to hours
    };

    // ========== EXCEL EXPORT ==========
    const handleExportOverview = async () => {
        try {
        console.log('Starting export...', { contentCacheSize: contentCache.size, schedulesCount: schedules.length });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Barrie Transit Scheduler';
        workbook.created = new Date();

        // Helper functions
        const hexToArgb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();
        const getContrastText = (bgHex: string): string => {
            const hex = bgHex.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? 'FF1F2937' : 'FFFFFFFF';
        };
        const toHours = (min: number) => (min / 60).toFixed(1);

        // Common styles
        const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFE5E7EB' } };
        const allBorders: Partial<ExcelJS.Borders> = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
        const centerAlign: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };

        // Generate sheet names for linking
        const getSheetName = (route: string, dayType: DayType) => `R${route} ${dayType}`;

        // Track which sheets exist (have content)
        const existingSheets: { route: string; dayType: DayType; sheetName: string }[] = [];

        // ===== SHEET 1: Service Hours Summary =====
        const summarySheet = workbook.addWorksheet('Overview');

        // Build data rows
        const dataRows = ROUTE_ORDER.map(route => {
            const routeSchedules = organizedSchedules[route];
            const weekdayContent = routeSchedules.Weekday ? contentCache.get(buildRouteIdentity(route, 'Weekday')) : undefined;
            const saturdayContent = routeSchedules.Saturday ? contentCache.get(buildRouteIdentity(route, 'Saturday')) : undefined;
            const sundayContent = routeSchedules.Sunday ? contentCache.get(buildRouteIdentity(route, 'Sunday')) : undefined;

            const weekdayDaily = weekdayContent ? calculateServiceHours(weekdayContent) : 0;
            const saturdayDaily = saturdayContent ? calculateServiceHours(saturdayContent) : 0;
            const sundayDaily = sundayContent ? calculateServiceHours(sundayContent) : 0;

            const weekdayAnnual = weekdayDaily * ANNUAL_MULTIPLIERS.Weekday;
            const saturdayAnnual = saturdayDaily * ANNUAL_MULTIPLIERS.Saturday;
            const sundayAnnual = sundayDaily * ANNUAL_MULTIPLIERS.Sunday;
            const totalAnnual = weekdayAnnual + saturdayAnnual + sundayAnnual;

            return {
                route,
                weekdayDaily, weekdayAnnual,
                saturdayDaily, saturdayAnnual,
                sundayDaily, sundayAnnual,
                totalAnnual,
                hasWeekday: !!weekdayContent,
                hasSaturday: !!saturdayContent,
                hasSunday: !!sundayContent
            };
        });

        const totals = dataRows.reduce((acc, row) => ({
            weekdayDaily: acc.weekdayDaily + row.weekdayDaily,
            weekdayAnnual: acc.weekdayAnnual + row.weekdayAnnual,
            saturdayDaily: acc.saturdayDaily + row.saturdayDaily,
            saturdayAnnual: acc.saturdayAnnual + row.saturdayAnnual,
            sundayDaily: acc.sundayDaily + row.sundayDaily,
            sundayAnnual: acc.sundayAnnual + row.sundayAnnual,
            totalAnnual: acc.totalAnnual + row.totalAnnual,
        }), { weekdayDaily: 0, weekdayAnnual: 0, saturdayDaily: 0, saturdayAnnual: 0, sundayDaily: 0, sundayAnnual: 0, totalAnnual: 0 });

        // Title row
        const titleRow = summarySheet.addRow(['BARRIE TRANSIT - MASTER SCHEDULE EXPORT']);
        summarySheet.mergeCells(1, 1, 1, 8);
        titleRow.height = 32;
        titleRow.getCell(1).font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
        titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
        titleRow.getCell(1).alignment = centerAlign;

        // Subtitle with date
        const subtitleRow = summarySheet.addRow([`Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`]);
        summarySheet.mergeCells(2, 1, 2, 8);
        subtitleRow.height = 22;
        subtitleRow.getCell(1).font = { size: 11, color: { argb: 'FF6B7280' } };
        subtitleRow.getCell(1).alignment = centerAlign;

        // Empty row
        summarySheet.addRow([]);

        // Day type headers row
        const dayTypeRow = summarySheet.addRow(['', 'WEEKDAY', '', 'SATURDAY', '', 'SUNDAY', '', 'TOTAL']);
        summarySheet.mergeCells(4, 2, 4, 3);
        summarySheet.mergeCells(4, 4, 4, 5);
        summarySheet.mergeCells(4, 6, 4, 7);
        dayTypeRow.height = 24;
        dayTypeRow.eachCell((cell, colNum) => {
            cell.font = { bold: true, size: 11, color: { argb: 'FF1F2937' } };
            cell.alignment = centerAlign;
            cell.border = allBorders;
            if (colNum === 2 || colNum === 3) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            if (colNum === 4 || colNum === 5) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            if (colNum === 6 || colNum === 7) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9D5FF' } };
            if (colNum === 8) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        });

        // Sub-headers row
        const subHeaderRow = summarySheet.addRow(['Route', 'Daily', 'Annual', 'Daily', 'Annual', 'Daily', 'Annual', 'Annual']);
        subHeaderRow.height = 20;
        subHeaderRow.eachCell((cell, colNum) => {
            cell.font = { bold: true, size: 10, color: { argb: 'FF6B7280' } };
            cell.alignment = centerAlign;
            cell.border = allBorders;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        });

        // Data rows with hyperlinks
        const dataStartRow = 6;
        dataRows.forEach((row, idx) => {
            const routeColor = getRouteColor(row.route);
            const excelRow = summarySheet.addRow([
                `Route ${row.route}`,
                row.weekdayDaily > 0 ? Number(row.weekdayDaily.toFixed(1)) : '-',
                row.weekdayAnnual > 0 ? Number(row.weekdayAnnual.toFixed(1)) : '-',
                row.saturdayDaily > 0 ? Number(row.saturdayDaily.toFixed(1)) : '-',
                row.saturdayAnnual > 0 ? Number(row.saturdayAnnual.toFixed(1)) : '-',
                row.sundayDaily > 0 ? Number(row.sundayDaily.toFixed(1)) : '-',
                row.sundayAnnual > 0 ? Number(row.sundayAnnual.toFixed(1)) : '-',
                row.totalAnnual > 0 ? Number(row.totalAnnual.toFixed(1)) : '-'
            ]);
            excelRow.height = 22;
            const bgColor = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
            excelRow.eachCell((cell, colNum) => {
                cell.alignment = colNum === 1 ? { horizontal: 'left', vertical: 'middle' } : centerAlign;
                cell.border = allBorders;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                cell.font = { size: 10 };
                if (colNum === 1) {
                    cell.font = { bold: true, size: 10, color: { argb: hexToArgb(routeColor) }, underline: true };
                    // Link to weekday sheet if exists
                    if (row.hasWeekday) {
                        const sheetName = getSheetName(row.route, 'Weekday');
                        cell.value = { text: `Route ${row.route}`, hyperlink: `#'${sheetName}'!A1` };
                    }
                }
                if (colNum === 8) {
                    cell.font = { bold: true, size: 10 };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
                }
            });
        });

        // Totals row
        const totalsRow = summarySheet.addRow([
            'TOTAL',
            Number(totals.weekdayDaily.toFixed(1)),
            Number(totals.weekdayAnnual.toFixed(1)),
            Number(totals.saturdayDaily.toFixed(1)),
            Number(totals.saturdayAnnual.toFixed(1)),
            Number(totals.sundayDaily.toFixed(1)),
            Number(totals.sundayAnnual.toFixed(1)),
            Number(totals.totalAnnual.toFixed(1))
        ]);
        totalsRow.height = 26;
        totalsRow.eachCell((cell, colNum) => {
            cell.font = { bold: true, size: 11, color: { argb: 'FF1F2937' } };
            cell.alignment = colNum === 1 ? { horizontal: 'left', vertical: 'middle' } : centerAlign;
            cell.border = allBorders;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
            if (colNum === 8) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
                cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
            }
        });

        // Footer note
        summarySheet.addRow([]);
        const footerRow = summarySheet.addRow([`Annual multipliers: Weekday × ${ANNUAL_MULTIPLIERS.Weekday} | Saturday × ${ANNUAL_MULTIPLIERS.Saturday} | Sunday × ${ANNUAL_MULTIPLIERS.Sunday}`]);
        summarySheet.mergeCells(footerRow.number, 1, footerRow.number, 8);
        footerRow.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF9CA3AF' } };
        footerRow.getCell(1).alignment = centerAlign;

        // ===== QUICK NAVIGATION SECTION =====
        summarySheet.addRow([]);
        summarySheet.addRow([]);
        const navTitleRow = summarySheet.addRow(['QUICK NAVIGATION - Click to jump to schedule']);
        summarySheet.mergeCells(navTitleRow.number, 1, navTitleRow.number, 4);
        navTitleRow.height = 26;
        navTitleRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
        navTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        navTitleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        navTitleRow.getCell(1).border = allBorders;

        // Navigation header row
        const navHeaderRow = summarySheet.addRow(['Route', 'Weekday', 'Saturday', 'Sunday']);
        navHeaderRow.height = 22;
        navHeaderRow.eachCell((cell, colNum) => {
            cell.font = { bold: true, size: 10, color: { argb: 'FF374151' } };
            cell.alignment = centerAlign;
            cell.border = allBorders;
            if (colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
            if (colNum === 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            if (colNum === 3) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            if (colNum === 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9D5FF' } };
        });

        // Navigation links for each route
        dataRows.forEach((row, idx) => {
            const routeColor = getRouteColor(row.route);
            const navRow = summarySheet.addRow([
                row.route,
                row.hasWeekday ? '→ View' : '-',
                row.hasSaturday ? '→ View' : '-',
                row.hasSunday ? '→ View' : '-'
            ]);
            navRow.height = 20;
            const bgColor = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
            navRow.eachCell((cell, colNum) => {
                cell.alignment = centerAlign;
                cell.border = allBorders;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                cell.font = { size: 10 };
                if (colNum === 1) {
                    cell.font = { bold: true, size: 10, color: { argb: hexToArgb(routeColor) } };
                }
                // Add hyperlinks
                if (colNum === 2 && row.hasWeekday) {
                    cell.value = { text: '→ View', hyperlink: `#'${getSheetName(row.route, 'Weekday')}'!A1` };
                    cell.font = { size: 10, color: { argb: 'FF2563EB' }, underline: true };
                }
                if (colNum === 3 && row.hasSaturday) {
                    cell.value = { text: '→ View', hyperlink: `#'${getSheetName(row.route, 'Saturday')}'!A1` };
                    cell.font = { size: 10, color: { argb: 'FFD97706' }, underline: true };
                }
                if (colNum === 4 && row.hasSunday) {
                    cell.value = { text: '→ View', hyperlink: `#'${getSheetName(row.route, 'Sunday')}'!A1` };
                    cell.font = { size: 10, color: { argb: 'FF7C3AED' }, underline: true };
                }
            });
        });

        // Column widths for overview
        summarySheet.getColumn(1).width = 14;
        [2, 3, 4, 5, 6, 7, 8].forEach(col => summarySheet.getColumn(col).width = 12);

        // ===== INDIVIDUAL ROUTE SHEETS =====
        // Helper: Get time band color (uses assignedBand from New Schedule wizard: A, B, C, D, E)
        const getTimeBandColor = (band: string | undefined): string => {
            switch (band) {
                case 'A': return 'FFEF4444';   // Red (slowest/peak)
                case 'B': return 'FFF97316';   // Orange
                case 'C': return 'FFFBBF24';   // Yellow
                case 'D': return 'FF22C55E';   // Green
                case 'E': return 'FF3B82F6';   // Blue (fastest/off-peak)
                default: return 'FFF3F4F6';    // Light gray for blank/unknown
            }
        };

        // Helper: Sort trips like Schedule Tweaker - by block ID numerically, then by start time
        const sortTripsLikeTweaker = (trips: MasterTrip[]): MasterTrip[] => {
            return [...trips].sort((a, b) => {
                // Extract numeric parts from block ID for proper sorting (e.g., "100-1" vs "100-2")
                const aBlockParts = a.blockId.replace(/\D/g, '-').split('-').filter(Boolean).map(Number);
                const bBlockParts = b.blockId.replace(/\D/g, '-').split('-').filter(Boolean).map(Number);

                // Compare block parts
                for (let i = 0; i < Math.max(aBlockParts.length, bBlockParts.length); i++) {
                    const diff = (aBlockParts[i] || 0) - (bBlockParts[i] || 0);
                    if (diff !== 0) return diff;
                }

                // Same block - sort by start time
                return a.startTime - b.startTime;
            });
        };

        // Helper: Calculate headway from previous trip
        const calculateHeadways = (sortedTrips: MasterTrip[]): Map<string, number> => {
            const headways = new Map<string, number>();
            for (let i = 1; i < sortedTrips.length; i++) {
                const headway = sortedTrips[i].startTime - sortedTrips[i - 1].startTime;
                headways.set(sortedTrips[i].id, headway);
            }
            return headways;
        };

        for (const route of ROUTE_ORDER) {
            for (const dayType of DAY_TYPES) {
                const content = contentCache.get(buildRouteIdentity(route, dayType));
                if (!content) continue;

                // Validate content structure
                if (!content.northTable?.trips || !content.southTable?.trips) {
                    console.warn(`Skipping ${route} ${dayType}: missing table data`);
                    continue;
                }

                const sheetName = getSheetName(route, dayType);
                existingSheets.push({ route, dayType, sheetName });
                const ws = workbook.addWorksheet(sheetName);

                const routeColor = getRouteColor(route);
                const routeColorArgb = hexToArgb(routeColor);
                const routeTextColor = getContrastText(routeColor);

                // Get all trips from both directions
                const northTrips = content.northTable.trips || [];
                const southTrips = content.southTable.trips || [];
                const northStops = content.northTable.stops || [];
                const southStops = content.southTable.stops || [];
                const allTrips = [...northTrips, ...southTrips];
                // Sort by start time for service window calculation
                const tripsByTime = [...allTrips].sort((a, b) => a.startTime - b.startTime);

                // Calculate summary stats
                const totalTrips = allTrips.length;
                const northTripCount = northTrips.length;
                const southTripCount = southTrips.length;
                const uniqueBlocks = new Set(allTrips.map(t => t.blockId));
                const peakVehicles = uniqueBlocks.size;
                const totalTravelTime = allTrips.reduce((sum, t) => sum + t.travelTime, 0);
                const totalRecoveryTime = allTrips.reduce((sum, t) => sum + t.recoveryTime, 0);
                const totalCycleTime = totalTravelTime + totalRecoveryTime;
                const recoveryRatio = totalTravelTime > 0 ? ((totalRecoveryTime / totalTravelTime) * 100).toFixed(0) : '0';
                const firstTripTime = tripsByTime.length > 0 ? formatTimeFromMinutes(tripsByTime[0].startTime) : '-';
                const lastTripTime = tripsByTime.length > 0 ? formatTimeFromMinutes(tripsByTime[tripsByTime.length - 1].endTime) : '-';
                const serviceSpanMins = tripsByTime.length > 0 ? tripsByTime[tripsByTime.length - 1].endTime - tripsByTime[0].startTime : 0;
                const avgHeadway = totalTrips > 1 ? Math.round(serviceSpanMins / (totalTrips - 1)) : 0;

                // ===== ROW 1: ROUTE HEADER =====
                const routeHeaderRow = ws.addRow([`ROUTE ${route} - ${dayType.toUpperCase()} SCHEDULE`]);
                ws.mergeCells(1, 1, 1, 12);
                routeHeaderRow.height = 36;
                routeHeaderRow.getCell(1).font = { bold: true, size: 20, color: { argb: routeTextColor } };
                routeHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
                routeHeaderRow.getCell(1).alignment = centerAlign;

                // ===== ROW 2: Back to Overview link =====
                const backRow = ws.addRow(['← Back to Overview']);
                ws.mergeCells(2, 1, 2, 2);
                backRow.getCell(1).value = { text: '← Back to Overview', hyperlink: "#'Overview'!A1" };
                backRow.getCell(1).font = { size: 10, color: { argb: 'FF2563EB' }, underline: true };
                backRow.height = 20;

                ws.addRow([]); // Row 3: spacer

                // ===== ROW 4-5: DAY SUMMARY BANNER (improved layout) =====
                const bannerLabels = ['SERVICE WINDOW', 'BLOCKS', 'TRIPS (N+S)', 'TRAVEL TIME', 'RECOVERY TIME', 'CYCLE TIME', 'RECOVERY %', 'AVG HEADWAY'];
                const bannerLabelRow = ws.addRow(bannerLabels);
                bannerLabelRow.height = 18;
                bannerLabelRow.eachCell((cell) => {
                    cell.font = { size: 9, color: { argb: 'FF6B7280' } };
                    cell.alignment = centerAlign;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
                    cell.border = { top: thinBorder, left: thinBorder, right: thinBorder };
                });

                const serviceWindow = `${firstTripTime} – ${lastTripTime}`;
                const tripBreakdown = `${totalTrips} (${northTripCount}N + ${southTripCount}S)`;

                const bannerValues = [
                    serviceWindow,
                    peakVehicles.toString(),
                    tripBreakdown,
                    `${toHours(totalTravelTime)}h`,
                    `${toHours(totalRecoveryTime)}h`,
                    `${toHours(totalCycleTime)}h`,
                    `${recoveryRatio}%`,
                    `${avgHeadway} min`
                ];
                const bannerValueRow = ws.addRow(bannerValues);
                bannerValueRow.height = 28;
                bannerValueRow.eachCell((cell, colNum) => {
                    cell.font = { bold: true, size: 13, color: { argb: 'FF1F2937' } };
                    cell.alignment = centerAlign;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
                    cell.border = { bottom: thinBorder, left: thinBorder, right: thinBorder };
                    // Highlight Cycle Time column
                    if (colNum === 6) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
                        cell.font = { bold: true, size: 13, color: { argb: 'FF059669' } };
                    }
                });

                ws.addRow([]); // Row 6: spacer

                // ===== NORTHBOUND TRIPS TABLE =====
                if (northTrips.length > 0) {
                    // Section header
                    const northHeaderRow = ws.addRow([`NORTHBOUND TRIPS (${northTrips.length} trips)`]);
                    ws.mergeCells(northHeaderRow.number, 1, northHeaderRow.number, 10);
                    northHeaderRow.height = 24;
                    northHeaderRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
                    northHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                    northHeaderRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
                    northHeaderRow.getCell(1).border = allBorders;

                    // Build column headers: Block, Band, Stop columns..., Hdwy, Travel, Recovery, Cycle, Ratio
                    const northColHeaders = ['Block', 'Band', ...northStops, 'Hdwy', 'Travel', 'Recovery', 'Cycle', 'Ratio'];
                    const northColHeaderRow = ws.addRow(northColHeaders);
                    northColHeaderRow.height = 24;
                    northColHeaderRow.eachCell((cell, colNum) => {
                        cell.font = { bold: true, size: 9, color: { argb: 'FF374151' } };
                        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                        cell.border = allBorders;
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
                        // Metrics columns get different color
                        if (colNum > northStops.length + 2) {
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
                        }
                    });

                    // Sort north trips by block ID then start time - same order as Schedule Tweaker
                    const sortedNorthTrips = sortTripsLikeTweaker(northTrips);

                    // Calculate headways for this direction
                    const northByTime = [...northTrips].sort((a, b) => a.startTime - b.startTime);
                    const northHeadways = calculateHeadways(northByTime);

                    // Data rows
                    sortedNorthTrips.forEach((trip, rowIdx) => {
                        const timeBand = trip.assignedBand || ''; // Use actual band from data, blank if not set
                        const tripRatio = trip.travelTime > 0 ? Math.round((trip.recoveryTime / trip.travelTime) * 100) : 0;
                        const headway = northHeadways.get(trip.id) || '';

                        const rowData: (string | number)[] = [
                            trip.blockId,
                            timeBand,
                            ...northStops.map(stop => trip.stops?.[stop] || ''),
                            headway,
                            trip.travelTime,
                            trip.recoveryTime,
                            trip.cycleTime,
                            `${tripRatio}%`
                        ];

                        const dataRow = ws.addRow(rowData);
                        dataRow.height = 18;
                        const bgColor = rowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
                        dataRow.eachCell((cell, colNum) => {
                            cell.font = { size: 10 };
                            cell.alignment = centerAlign;
                            cell.border = allBorders;
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };

                            // Block column bold
                            if (colNum === 1) {
                                cell.font = { bold: true, size: 10, color: { argb: 'FF374151' } };
                            }
                            // Band column with color (only if band is set)
                            if (colNum === 2 && timeBand) {
                                const bandColor = getTimeBandColor(timeBand);
                                cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
                                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bandColor } };
                            }
                            // Metrics columns
                            if (colNum > northStops.length + 2) {
                                cell.font = { size: 10, color: { argb: 'FF6B7280' } };
                            }
                        });
                    });

                    // North totals row - show hours instead of minutes
                    const northTotalTravel = northTrips.reduce((sum, t) => sum + t.travelTime, 0);
                    const northTotalRecovery = northTrips.reduce((sum, t) => sum + t.recoveryTime, 0);
                    const northTotalCycle = northTotalTravel + northTotalRecovery;
                    const northAvgRatio = northTotalTravel > 0 ? Math.round((northTotalRecovery / northTotalTravel) * 100) : 0;
                    const northAvgHeadway = northTrips.length > 1 ? Math.round((northByTime[northByTime.length - 1].startTime - northByTime[0].startTime) / (northTrips.length - 1)) : 0;

                    const northTotalsData: (string | number)[] = [
                        'TOTALS', '',
                        ...northStops.map(() => ''),
                        northAvgHeadway > 0 ? `${northAvgHeadway}` : '',
                        `${toHours(northTotalTravel)}h`,
                        `${toHours(northTotalRecovery)}h`,
                        `${toHours(northTotalCycle)}h`,
                        `${northAvgRatio}%`
                    ];
                    const northTotalsRow = ws.addRow(northTotalsData);
                    northTotalsRow.height = 22;
                    northTotalsRow.eachCell((cell, colNum) => {
                        cell.font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
                        cell.alignment = centerAlign;
                        cell.border = allBorders;
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
                    });

                    ws.addRow([]); // spacer
                }

                // ===== SOUTHBOUND TRIPS TABLE =====
                if (southTrips.length > 0) {
                    // Section header
                    const southHeaderRow = ws.addRow([`SOUTHBOUND TRIPS (${southTrips.length} trips)`]);
                    ws.mergeCells(southHeaderRow.number, 1, southHeaderRow.number, 10);
                    southHeaderRow.height = 24;
                    southHeaderRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF5B21B6' } };
                    southHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
                    southHeaderRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
                    southHeaderRow.getCell(1).border = allBorders;

                    // Build column headers: Block, Band, Stop columns..., Hdwy, Travel, Recovery, Cycle, Ratio
                    const southColHeaders = ['Block', 'Band', ...southStops, 'Hdwy', 'Travel', 'Recovery', 'Cycle', 'Ratio'];
                    const southColHeaderRow = ws.addRow(southColHeaders);
                    southColHeaderRow.height = 24;
                    southColHeaderRow.eachCell((cell, colNum) => {
                        cell.font = { bold: true, size: 9, color: { argb: 'FF374151' } };
                        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                        cell.border = allBorders;
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
                        // Metrics columns get different color
                        if (colNum > southStops.length + 2) {
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
                        }
                    });

                    // Sort south trips by block ID then start time - same order as Schedule Tweaker
                    const sortedSouthTrips = sortTripsLikeTweaker(southTrips);

                    // Calculate headways for this direction
                    const southByTime = [...southTrips].sort((a, b) => a.startTime - b.startTime);
                    const southHeadways = calculateHeadways(southByTime);

                    // Data rows
                    sortedSouthTrips.forEach((trip, rowIdx) => {
                        const timeBand = trip.assignedBand || ''; // Use actual band from data, blank if not set
                        const tripRatio = trip.travelTime > 0 ? Math.round((trip.recoveryTime / trip.travelTime) * 100) : 0;
                        const headway = southHeadways.get(trip.id) || '';

                        const rowData: (string | number)[] = [
                            trip.blockId,
                            timeBand,
                            ...southStops.map(stop => trip.stops?.[stop] || ''),
                            headway,
                            trip.travelTime,
                            trip.recoveryTime,
                            trip.cycleTime,
                            `${tripRatio}%`
                        ];

                        const dataRow = ws.addRow(rowData);
                        dataRow.height = 18;
                        const bgColor = rowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
                        dataRow.eachCell((cell, colNum) => {
                            cell.font = { size: 10 };
                            cell.alignment = centerAlign;
                            cell.border = allBorders;
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };

                            // Block column bold
                            if (colNum === 1) {
                                cell.font = { bold: true, size: 10, color: { argb: 'FF374151' } };
                            }
                            // Band column with color (only if band is set)
                            if (colNum === 2 && timeBand) {
                                const bandColor = getTimeBandColor(timeBand);
                                cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
                                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bandColor } };
                            }
                            // Metrics columns
                            if (colNum > southStops.length + 2) {
                                cell.font = { size: 10, color: { argb: 'FF6B7280' } };
                            }
                        });
                    });

                    // South totals row - show hours instead of minutes
                    const southTotalTravel = southTrips.reduce((sum, t) => sum + t.travelTime, 0);
                    const southTotalRecovery = southTrips.reduce((sum, t) => sum + t.recoveryTime, 0);
                    const southTotalCycle = southTotalTravel + southTotalRecovery;
                    const southAvgRatio = southTotalTravel > 0 ? Math.round((southTotalRecovery / southTotalTravel) * 100) : 0;
                    const southAvgHeadway = southTrips.length > 1 ? Math.round((southByTime[southByTime.length - 1].startTime - southByTime[0].startTime) / (southTrips.length - 1)) : 0;

                    const southTotalsData: (string | number)[] = [
                        'TOTALS', '',
                        ...southStops.map(() => ''),
                        southAvgHeadway > 0 ? `${southAvgHeadway}` : '',
                        `${toHours(southTotalTravel)}h`,
                        `${toHours(southTotalRecovery)}h`,
                        `${toHours(southTotalCycle)}h`,
                        `${southAvgRatio}%`
                    ];
                    const southTotalsRow = ws.addRow(southTotalsData);
                    southTotalsRow.height = 22;
                    southTotalsRow.eachCell((cell, colNum) => {
                        cell.font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
                        cell.alignment = centerAlign;
                        cell.border = allBorders;
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
                    });
                }

                // ===== COLUMN WIDTHS (dynamic based on content) =====
                const maxStopNameLength = Math.max(
                    ...northStops.map(s => s.length),
                    ...southStops.map(s => s.length),
                    10 // minimum
                );
                const stopColWidth = Math.min(Math.max(maxStopNameLength * 1.2, 11), 18); // Between 11 and 18

                ws.getColumn(1).width = 10;  // Block
                ws.getColumn(2).width = 6;   // Band
                // Stop columns - dynamic width
                const maxStops = Math.max(northStops.length, southStops.length);
                for (let i = 3; i <= maxStops + 2; i++) {
                    ws.getColumn(i).width = stopColWidth;
                }
                // Metrics columns (after stops)
                ws.getColumn(maxStops + 3).width = 6;   // Hdwy
                ws.getColumn(maxStops + 4).width = 7;   // Travel
                ws.getColumn(maxStops + 5).width = 9;   // Recovery
                ws.getColumn(maxStops + 6).width = 7;   // Cycle
                ws.getColumn(maxStops + 7).width = 6;   // Ratio

                // ===== FREEZE PANES =====
                // Freeze first 2 columns (Block, Time Band) and first 6 rows (header + summary)
                ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 6 }];
            }
        }

        // Download
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Barrie_Transit_Master_Schedule_${new Date().toISOString().split('T')[0]}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);

        toast?.success('Master schedule export complete');
        } catch (error) {
            console.error('Export failed:', error);
            toast?.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    // ========== RENDER OVERVIEW TAB ==========
    const renderOverview = () => {
        const rows = ROUTE_ORDER.map(route => {
            const routeSchedules = organizedSchedules[route];
            const weekdayEntry = routeSchedules.Weekday;
            const saturdayEntry = routeSchedules.Saturday;
            const sundayEntry = routeSchedules.Sunday;

            // Get content from cache to calculate actual service hours
            const weekdayContent = weekdayEntry ? contentCache.get(buildRouteIdentity(route, 'Weekday')) : undefined;
            const saturdayContent = saturdayEntry ? contentCache.get(buildRouteIdentity(route, 'Saturday')) : undefined;
            const sundayContent = sundayEntry ? contentCache.get(buildRouteIdentity(route, 'Sunday')) : undefined;

            // Calculate actual service hours from trip data, or estimate from tripCount if not loaded
            const weekdayDaily = weekdayContent
                ? calculateServiceHours(weekdayContent)
                : (weekdayEntry ? weekdayEntry.tripCount * 0.5 : 0); // Fallback estimate
            const saturdayDaily = saturdayContent
                ? calculateServiceHours(saturdayContent)
                : (saturdayEntry ? saturdayEntry.tripCount * 0.5 : 0);
            const sundayDaily = sundayContent
                ? calculateServiceHours(sundayContent)
                : (sundayEntry ? sundayEntry.tripCount * 0.5 : 0);

            // Annual calculations per day type
            const weekdayAnnual = weekdayDaily * ANNUAL_MULTIPLIERS.Weekday;
            const saturdayAnnual = saturdayDaily * ANNUAL_MULTIPLIERS.Saturday;
            const sundayAnnual = sundayDaily * ANNUAL_MULTIPLIERS.Sunday;
            const totalAnnual = weekdayAnnual + saturdayAnnual + sundayAnnual;

            return {
                route,
                weekdayDaily: weekdayEntry ? weekdayDaily : null,
                weekdayAnnual: weekdayEntry ? weekdayAnnual : null,
                saturdayDaily: saturdayEntry ? saturdayDaily : null,
                saturdayAnnual: saturdayEntry ? saturdayAnnual : null,
                sundayDaily: sundayEntry ? sundayDaily : null,
                sundayAnnual: sundayEntry ? sundayAnnual : null,
                totalAnnual: totalAnnual > 0 ? totalAnnual : null,
                // Track if data is estimated vs actual
                weekdayEstimated: weekdayEntry && !weekdayContent,
                saturdayEstimated: saturdayEntry && !saturdayContent,
                sundayEstimated: sundayEntry && !sundayContent,
            };
        });

        const totals = rows.reduce((acc, row) => ({
            weekdayDaily: acc.weekdayDaily + (row.weekdayDaily || 0),
            weekdayAnnual: acc.weekdayAnnual + (row.weekdayAnnual || 0),
            saturdayDaily: acc.saturdayDaily + (row.saturdayDaily || 0),
            saturdayAnnual: acc.saturdayAnnual + (row.saturdayAnnual || 0),
            sundayDaily: acc.sundayDaily + (row.sundayDaily || 0),
            sundayAnnual: acc.sundayAnnual + (row.sundayAnnual || 0),
            totalAnnual: acc.totalAnnual + (row.totalAnnual || 0),
        }), { weekdayDaily: 0, weekdayAnnual: 0, saturdayDaily: 0, saturdayAnnual: 0, sundayDaily: 0, sundayAnnual: 0, totalAnnual: 0 });

        return (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">System Overview</h2>
                        <p className="text-xs text-gray-600">Service hours across all routes (daily and annual)</p>
                    </div>
                    <button
                        onClick={handleExportOverview}
                        className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        <Download size={16} />
                        Export Excel
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="sticky top-0 z-10 bg-gray-50">
                            {/* Day Type Headers */}
                            <tr className="border-b border-gray-200">
                                <th rowSpan={2} className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase bg-gray-50">Route</th>
                                <th colSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-blue-50">Weekday</th>
                                <th colSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-amber-50">Saturday</th>
                                <th colSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-purple-50">Sunday</th>
                                <th rowSpan={2} className="px-4 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-green-50">Total<br/>Annual</th>
                            </tr>
                            {/* Daily/Annual Sub-Headers */}
                            <tr className="border-b border-gray-200 text-[10px]">
                                <th className="px-2 py-1 text-center font-medium text-gray-500 border-l border-gray-200 bg-blue-50/50">Daily</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 bg-blue-50/50">Annual</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 border-l border-gray-200 bg-amber-50/50">Daily</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 bg-amber-50/50">Annual</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 border-l border-gray-200 bg-purple-50/50">Daily</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 bg-purple-50/50">Annual</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {rows.map(row => (
                                <tr key={row.route} className="hover:bg-gray-50">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold"
                                                style={{
                                                    backgroundColor: getRouteColor(row.route),
                                                    color: getRouteTextColor(row.route)
                                                }}
                                            >
                                                {row.route}
                                            </div>
                                            <span className="font-medium text-gray-900 text-sm">Route {row.route}</span>
                                        </div>
                                    </td>
                                    {/* Weekday */}
                                    <td className={`px-2 py-2 text-center text-sm border-l border-gray-100 ${row.weekdayEstimated ? 'text-gray-400 italic' : 'text-gray-900'}`} title={row.weekdayEstimated ? 'Estimated - loading...' : undefined}>
                                        {row.weekdayDaily !== null ? formatHours(row.weekdayDaily) : '--'}
                                    </td>
                                    <td className={`px-2 py-2 text-center text-sm ${row.weekdayEstimated ? 'text-gray-300 italic' : 'text-gray-600'}`}>
                                        {row.weekdayAnnual !== null ? formatHours(row.weekdayAnnual) : '--'}
                                    </td>
                                    {/* Saturday */}
                                    <td className={`px-2 py-2 text-center text-sm border-l border-gray-100 ${row.saturdayEstimated ? 'text-gray-400 italic' : 'text-gray-900'}`} title={row.saturdayEstimated ? 'Estimated - loading...' : undefined}>
                                        {row.saturdayDaily !== null ? formatHours(row.saturdayDaily) : '--'}
                                    </td>
                                    <td className={`px-2 py-2 text-center text-sm ${row.saturdayEstimated ? 'text-gray-300 italic' : 'text-gray-600'}`}>
                                        {row.saturdayAnnual !== null ? formatHours(row.saturdayAnnual) : '--'}
                                    </td>
                                    {/* Sunday */}
                                    <td className={`px-2 py-2 text-center text-sm border-l border-gray-100 ${row.sundayEstimated ? 'text-gray-400 italic' : 'text-gray-900'}`} title={row.sundayEstimated ? 'Estimated - loading...' : undefined}>
                                        {row.sundayDaily !== null ? formatHours(row.sundayDaily) : '--'}
                                    </td>
                                    <td className={`px-2 py-2 text-center text-sm ${row.sundayEstimated ? 'text-gray-300 italic' : 'text-gray-600'}`}>
                                        {row.sundayAnnual !== null ? formatHours(row.sundayAnnual) : '--'}
                                    </td>
                                    {/* Total Annual */}
                                    <td className="px-2 py-2 text-center text-sm font-bold text-gray-900 border-l border-gray-200 bg-green-50/30">
                                        {row.totalAnnual !== null ? formatHours(row.totalAnnual) : '--'}
                                    </td>
                                </tr>
                            ))}
                            {/* Totals Row */}
                            <tr className="bg-gray-100 font-bold">
                                <td className="px-3 py-2 text-gray-900 text-sm">TOTAL</td>
                                <td className="px-2 py-2 text-center text-gray-900 text-sm border-l border-gray-200">{formatHours(totals.weekdayDaily)}</td>
                                <td className="px-2 py-2 text-center text-gray-700 text-sm">{formatHours(totals.weekdayAnnual)}</td>
                                <td className="px-2 py-2 text-center text-gray-900 text-sm border-l border-gray-200">{formatHours(totals.saturdayDaily)}</td>
                                <td className="px-2 py-2 text-center text-gray-700 text-sm">{formatHours(totals.saturdayAnnual)}</td>
                                <td className="px-2 py-2 text-center text-gray-900 text-sm border-l border-gray-200">{formatHours(totals.sundayDaily)}</td>
                                <td className="px-2 py-2 text-center text-gray-700 text-sm">{formatHours(totals.sundayAnnual)}</td>
                                <td className="px-2 py-2 text-center text-gray-900 text-sm border-l border-gray-200 bg-green-100">{formatHours(totals.totalAnnual)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-500">
                    Annual: Weekday × {ANNUAL_MULTIPLIERS.Weekday} | Saturday × {ANNUAL_MULTIPLIERS.Saturday} | Sunday × {ANNUAL_MULTIPLIERS.Sunday} days
                </div>
            </div>
        );
    };

    // ========== RENDER TABLE VIEW (uses ScheduleEditor in readOnly mode) ==========
    const renderScheduleTable = () => {
        const routeIdentity = buildRouteIdentity(selectedRoute as string, selectedDayType);
        const entry = schedules.find(s => s.id === routeIdentity);
        const content = contentCache.get(routeIdentity);

        // No schedule exists
        if (!entry) {
            return (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <CalendarOff className="mx-auto mb-4 text-gray-300" size={48} />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Schedule Needed</h3>
                    <p className="text-gray-600">
                        No schedule has been uploaded for Route {selectedRoute} on {selectedDayType}.
                    </p>
                </div>
            );
        }

        // Loading content
        if (loadingContent && !content) {
            return (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <Loader2 className="animate-spin text-brand-green mx-auto" size={32} />
                </div>
            );
        }

        if (!content) {
            return null;
        }

        // Convert to array format expected by ScheduleEditor
        // ScheduleEditor needs "(North)" and "(South)" suffixes in routeName to pair tables
        const northTable: MasterRouteTable = {
            ...content.northTable,
            routeName: `${selectedRoute} (North) (${selectedDayType})`
        };
        const southTable: MasterRouteTable = {
            ...content.southTable,
            routeName: `${selectedRoute} (South) (${selectedDayType})`
        };
        const schedulesForEditor: MasterRouteTable[] = [northTable, southTable];

        // Fullscreen mode - render as fixed overlay
        if (isFullScreen) {
            return (
                <div className="fixed inset-0 z-[9999] bg-white flex flex-col">
                    {/* Fullscreen Header */}
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold"
                                style={{
                                    backgroundColor: getRouteColor(selectedRoute as string),
                                    color: getRouteTextColor(selectedRoute as string)
                                }}
                            >
                                {selectedRoute}
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-gray-900">Route {selectedRoute}</h2>
                                <p className="text-xs text-gray-500">{selectedDayType} Schedule</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsFullScreen(false)}
                            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Exit full screen"
                        >
                            <Minimize2 size={18} />
                            <span className="text-sm font-medium">Exit Full Screen</span>
                        </button>
                    </div>
                    {/* Schedule Content */}
                    <div className="flex-1 overflow-hidden">
                        <ScheduleEditor
                            schedules={schedulesForEditor}
                            readOnly={true}
                            embedded={true}
                            draftName={`Route ${selectedRoute} - ${selectedDayType}`}
                            onClose={() => setIsFullScreen(false)}
                            forceSimpleView={false}
                        />
                    </div>
                </div>
            );
        }

        return (
            <div className="h-full">
                <ScheduleEditor
                    schedules={schedulesForEditor}
                    readOnly={true}
                    embedded={true}
                    draftName={`Route ${selectedRoute} - ${selectedDayType}`}
                    onClose={() => setSelectedRoute('overview')}
                    forceSimpleView={false}
                />
            </div>
        );
    };

    // ========== MAIN RENDER ==========
    // Use compact padding when viewing a specific route (always table view now)
    const isTableView = selectedRoute !== 'overview' && selectedRoute !== 'platforms';

    return (
        <div className={`${isTableView ? 'p-4' : 'p-8'} max-w-7xl mx-auto h-full flex flex-col overflow-hidden`}>
            {/* Header - Compact when viewing schedule table */}
            <div className={`${isTableView ? 'mb-2' : 'mb-6'} flex items-center justify-between flex-shrink-0`}>
                <div className="flex items-center gap-4">
                    <h1 className={`${isTableView ? 'text-xl' : 'text-3xl'} font-bold text-gray-900`}>Master Schedule</h1>
                    {!isTableView && <p className="text-gray-600">Source of truth for all route schedules</p>}
                </div>

            </div>

            {/* Route Tabs - Compact in table view */}
            <div className={`bg-gray-100/80 p-1 rounded-lg flex items-center gap-1 ${isTableView ? 'mb-2' : 'mb-4'} overflow-x-auto flex-shrink-0`}>
                <button
                    onClick={() => setSelectedRoute('overview')}
                    className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${
                        selectedRoute === 'overview'
                            ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                    }`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setSelectedRoute('platforms')}
                    className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${
                        selectedRoute === 'platforms'
                            ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                    }`}
                >
                    Platforms
                </button>
                {ROUTE_ORDER.map(route => (
                    <button
                        key={route}
                        onClick={() => setSelectedRoute(route)}
                        className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
                            selectedRoute === route
                                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                        }`}
                        style={selectedRoute === route ? {
                            borderBottom: `3px solid ${getRouteColor(route)}`
                        } : undefined}
                    >
                        <div
                            className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold"
                            style={{
                                backgroundColor: getRouteColor(route),
                                color: getRouteTextColor(route)
                            }}
                        >
                            {route}
                        </div>
                        {route}
                    </button>
                ))}
            </div>

            {/* Day Type Sub-Tabs (shown for routes and platforms, not overview) - Compact in table view */}
            {selectedRoute !== 'overview' && (
                <div className={`${isTableView ? 'mb-2' : 'mb-4'} flex-shrink-0`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className={`${isTableView ? 'text-base' : 'text-xl'} font-bold text-gray-900`}>
                                {selectedRoute === 'platforms' ? 'Platform Summary' : `Route ${selectedRoute}`}
                            </h2>
                            <span className="text-gray-400">•</span>
                            <div className="bg-gray-100/80 p-1 rounded-lg flex items-center">
                                {DAY_TYPES.map(dayType => (
                                    <button
                                        key={dayType}
                                        onClick={() => setSelectedDayType(dayType)}
                                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                                            selectedDayType === dayType
                                                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                                        }`}
                                    >
                                        {dayType}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Fullscreen toggle - only for routes */}
                        {selectedRoute !== 'platforms' && (
                            <button
                                onClick={() => setIsFullScreen(true)}
                                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Full screen"
                            >
                                <Maximize2 size={18} />
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-12 flex-1">
                    <Loader2 className="animate-spin text-brand-green" size={32} />
                </div>
            )}

            {/* Content Area - fills remaining height */}
            {!loading && (
                <div className="flex-1 min-h-0 overflow-hidden">
                    {selectedRoute === 'overview' && <div className="h-full overflow-y-auto">{renderOverview()}</div>}
                    {selectedRoute === 'platforms' && (
                        <div className="h-full overflow-y-auto">
                            <PlatformSummary
                                dayType={selectedDayType}
                                schedules={schedules}
                                contentCache={contentCache}
                            />
                        </div>
                    )}
                    {selectedRoute !== 'overview' && selectedRoute !== 'platforms' && renderScheduleTable()}
                </div>
            )}
        </div>
    );
};
