/**
 * TimelineView Component
 * Interactive Gantt-style visualization of the schedule.
 * Features:
 * - Horizontal time axis with zoom
 * - Blocks as rows with trip bars
 * - Drag to move trips
 * - Drag edges to resize
 * - Click to select
 * - Overlap detection
 */

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, Clock, AlertTriangle } from 'lucide-react';
import { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';

interface TimelineViewProps {
    schedules: MasterRouteTable[];
    onTripTimeChange?: (tripId: string, newStartTime: number, newDuration: number) => void;
    onTripSelect?: (tripId: string) => void;
    selectedTripId?: string | null;
}

interface TripBar {
    id: string;
    blockId: string;
    direction: 'North' | 'South' | string;
    startTime: number; // minutes from midnight
    endTime: number;
    travelTime: number;
    recoveryTime: number;
    hasOverlap: boolean;
}

interface BlockRow {
    blockId: string;
    trips: TripBar[];
}

interface DragPreview {
    tripId: string;
    startTime: number;
    endTime: number;
}

const HOUR_WIDTH_BASE = 120; // pixels per hour at zoom 1
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ROW_HEIGHT = 40;
const TIME_LABEL_HEIGHT = 32;

export const TimelineView: React.FC<TimelineViewProps> = ({
    schedules,
    onTripTimeChange,
    onTripSelect,
    selectedTripId
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const blockLabelsRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [dragType, setDragType] = useState<'move' | 'resize-start' | 'resize-end' | null>(null);
    const [dragTripId, setDragTripId] = useState<string | null>(null);
    const [dragStartX, setDragStartX] = useState(0);
    const [dragOriginalStart, setDragOriginalStart] = useState(0);
    const [dragOriginalEnd, setDragOriginalEnd] = useState(0);
    const [hoveredTripId, setHoveredTripId] = useState<string | null>(null);
    const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
    const dragMovedRef = useRef(false);
    const dragPreviewRef = useRef<DragPreview | null>(null);

    // Calculate time range from all trips
    const { minHour, maxHour, blockRows, overlaps } = useMemo(() => {
        const allTrips: TripBar[] = [];
        const blockMap: Record<string, TripBar[]> = {};

        schedules.forEach(table => {
            table.trips.forEach(trip => {
                const bar: TripBar = {
                    id: trip.id,
                    blockId: trip.blockId,
                    direction: trip.direction || 'North',
                    startTime: trip.startTime,
                    endTime: trip.endTime,
                    travelTime: trip.travelTime,
                    recoveryTime: trip.recoveryTime,
                    hasOverlap: false
                };
                allTrips.push(bar);
                if (!blockMap[trip.blockId]) blockMap[trip.blockId] = [];
                blockMap[trip.blockId].push(bar);
            });
        });

        // Detect overlaps within each block
        const overlapsSet = new Set<string>();
        Object.values(blockMap).forEach(trips => {
            trips.sort((a, b) => a.startTime - b.startTime);
            for (let i = 0; i < trips.length - 1; i++) {
                if ((trips[i].endTime + trips[i].recoveryTime) > trips[i + 1].startTime) {
                    trips[i].hasOverlap = true;
                    trips[i + 1].hasOverlap = true;
                    overlapsSet.add(trips[i].id);
                    overlapsSet.add(trips[i + 1].id);
                }
            }
        });

        // Calculate time range
        let minH = Number.POSITIVE_INFINITY;
        let maxH = Number.NEGATIVE_INFINITY;
        allTrips.forEach(t => {
            const startHour = Math.floor(t.startTime / 60);
            const endHour = Math.ceil(t.endTime / 60);
            if (startHour < minH) minH = startHour;
            if (endHour > maxH) maxH = endHour;
        });

        if (!Number.isFinite(minH) || !Number.isFinite(maxH)) {
            minH = 0;
            maxH = 24;
        } else {
            minH = Math.max(0, minH - 1);
            maxH = Math.max(minH + 1, maxH + 1);
        }

        // Build block rows sorted by first trip time
        const rows: BlockRow[] = Object.entries(blockMap)
            .map(([blockId, trips]) => ({
                blockId,
                trips: trips.sort((a, b) => a.startTime - b.startTime)
            }))
            .sort((a, b) => {
                const aFirst = a.trips[0]?.startTime || 0;
                const bFirst = b.trips[0]?.startTime || 0;
                return aFirst - bFirst;
            });

        return { minHour: minH, maxHour: maxH, blockRows: rows, overlaps: overlapsSet };
    }, [schedules]);

    const hourWidth = HOUR_WIDTH_BASE * zoom;
    const totalWidth = (maxHour - minHour) * hourWidth;
    const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i);

    // Convert time to pixel position
    const timeToX = useCallback((minutes: number) => {
        return ((minutes / 60) - minHour) * hourWidth;
    }, [minHour, hourWidth]);

    const getTripById = useCallback((tripId: string) => {
        for (const table of schedules) {
            for (const trip of table.trips) {
                if (trip.id === tripId) return trip;
            }
        }
        return null;
    }, [schedules]);

    const commitTripTimeChange = useCallback((tripId: string, startTime: number, endTime: number) => {
        if (endTime <= startTime) return;
        onTripTimeChange?.(tripId, startTime, endTime - startTime);
    }, [onTripTimeChange]);

    // Convert pixel position to time
    // Handle zoom
    const handleZoomIn = () => setZoom(Math.min(MAX_ZOOM, zoom + 0.25));
    const handleZoomOut = () => setZoom(Math.max(MIN_ZOOM, zoom - 0.25));

    // Handle scroll
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (blockLabelsRef.current) {
            blockLabelsRef.current.scrollTop = e.currentTarget.scrollTop;
        }
    };

    // Handle mouse down on trip bar
    const handleMouseDown = (e: React.MouseEvent, tripId: string, type: 'move' | 'resize-start' | 'resize-end') => {
        e.preventDefault();
        e.stopPropagation();

        const trip = getTripById(tripId);
        if (!trip) return;

        setIsDragging(true);
        setDragType(type);
        setDragTripId(tripId);
        setDragStartX(e.clientX);
        setDragOriginalStart(trip.startTime);
        setDragOriginalEnd(trip.endTime);
        dragMovedRef.current = false;
        const preview = {
            tripId,
            startTime: trip.startTime,
            endTime: trip.endTime
        };
        dragPreviewRef.current = preview;
        setDragPreview(preview);

        // Select trip on click
        onTripSelect?.(tripId);
    };

    // Handle mouse move for dragging
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || !dragTripId || !dragType) return;

        const deltaX = e.clientX - dragStartX;
        const deltaMinutes = Math.round(deltaX / hourWidth * 60);

        let newStart = dragOriginalStart;
        let newEnd = dragOriginalEnd;
        let changed = false;

        switch (dragType) {
            case 'move':
                newStart = dragOriginalStart + deltaMinutes;
                newEnd = dragOriginalEnd + deltaMinutes;
                if (newStart < 0) {
                    const duration = dragOriginalEnd - dragOriginalStart;
                    newStart = 0;
                    newEnd = duration;
                }
                changed = deltaMinutes !== 0;
                break;
            case 'resize-start':
                newStart = Math.min(dragOriginalStart + deltaMinutes, dragOriginalEnd - 5);
                newStart = Math.max(0, newStart);
                changed = deltaMinutes !== 0;
                break;
            case 'resize-end':
                newEnd = Math.max(dragOriginalEnd + deltaMinutes, dragOriginalStart + 5);
                changed = deltaMinutes !== 0;
                break;
        }

        if (changed) dragMovedRef.current = true;
        const preview = {
            tripId: dragTripId,
            startTime: newStart,
            endTime: newEnd
        };
        dragPreviewRef.current = preview;
        setDragPreview(preview);
    }, [isDragging, dragTripId, dragType, dragStartX, dragOriginalStart, dragOriginalEnd, hourWidth, getTripById]);

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
        const preview = dragPreviewRef.current;
        if (dragTripId && preview && dragMovedRef.current) {
            commitTripTimeChange(dragTripId, preview.startTime, preview.endTime);
        }
        setIsDragging(false);
        setDragType(null);
        setDragTripId(null);
        setDragPreview(null);
        dragPreviewRef.current = null;
        dragMovedRef.current = false;
    }, [commitTripTimeChange, dragTripId]);

    // Add/remove global mouse listeners
    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Get trip bar color based on direction
    const getTripColor = (direction: string, isSelected: boolean, hasOverlap: boolean) => {
        if (hasOverlap) return 'bg-red-400 hover:bg-red-500';
        if (isSelected) return direction === 'North' ? 'bg-blue-500' : 'bg-green-500';
        return direction === 'North' ? 'bg-gray-500 hover:bg-gray-600' : 'bg-gray-400 hover:bg-gray-500';
    };

    // Format time for tooltip
    const formatTime = (minutes: number) => {
        const dayOffset = Math.floor(minutes / 1440);
        const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
        const h = Math.floor(normalizedMinutes / 60);
        const m = normalizedMinutes % 60;
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m.toString().padStart(2, '0')} ${period}${dayOffset > 0 ? ` (+${dayOffset})` : ''}`;
    };

    const formatHourLabel = (hour: number) => {
        const dayOffset = Math.floor(hour / 24);
        const normalizedHour = ((hour % 24) + 24) % 24;
        const label = normalizedHour === 0 ? '12 AM' :
            normalizedHour < 12 ? `${normalizedHour} AM` :
                normalizedHour === 12 ? '12 PM' :
                    `${normalizedHour - 12} PM`;
        return dayOffset > 0 ? `${label} +${dayOffset}` : label;
    };

    const handleTripKeyDown = (e: React.KeyboardEvent, trip: TripBar) => {
        const step = e.shiftKey ? 5 : 1;
        const isMoveKey = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        const isResizeKey = e.altKey && isMoveKey;

        if (!isMoveKey) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTripSelect?.(trip.id);
            }
            return;
        }

        e.preventDefault();

        const direction = e.key === 'ArrowRight' ? 1 : -1;
        const currentStart = trip.startTime;
        const currentEnd = trip.endTime;

        if (isResizeKey) {
            const nextStart = e.key === 'ArrowLeft'
                ? Math.min(currentStart, currentEnd - 5)
                : currentStart;
            const nextEnd = e.key === 'ArrowRight'
                ? currentEnd + step
                : Math.max(currentStart + 5, currentEnd - step);
            commitTripTimeChange(trip.id, nextStart, nextEnd);
            return;
        }

        const duration = currentEnd - currentStart;
        const nextStart = Math.max(0, currentStart + (direction * step));
        commitTripTimeChange(trip.id, nextStart, nextStart + duration);
    };

    const resolveTripBounds = (trip: TripBar) => {
        if (dragPreview?.tripId === trip.id) {
            return { startTime: dragPreview.startTime, endTime: dragPreview.endTime };
        }
        return { startTime: trip.startTime, endTime: trip.endTime };
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Header with controls */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center gap-4">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Clock size={16} />
                        Timeline View
                    </h3>
                    {overlaps.size > 0 && (
                        <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                            <AlertTriangle size={12} />
                            {overlaps.size} overlapping trips
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
                    <button
                        onClick={handleZoomOut}
                        disabled={zoom <= MIN_ZOOM}
                        className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Zoom out"
                    >
                        <ZoomOut size={16} />
                    </button>
                    <button
                        onClick={handleZoomIn}
                        disabled={zoom >= MAX_ZOOM}
                        className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Zoom in"
                    >
                        <ZoomIn size={16} />
                    </button>
                </div>
            </div>

            {/* Timeline container */}
            <div className="flex flex-1 overflow-hidden">
                {/* Block labels (sticky left column) */}
                <div className="w-24 flex-shrink-0 border-r border-gray-200 bg-gray-50">
                    <div className="h-8 border-b border-gray-200 flex items-center justify-center text-xs font-semibold text-gray-500 uppercase">
                        Block
                    </div>
                    <div
                        ref={blockLabelsRef}
                        className="overflow-y-auto"
                        style={{ height: `calc(100% - ${TIME_LABEL_HEIGHT}px)` }}
                    >
                        {blockRows.map(row => (
                            <div
                                key={row.blockId}
                                className="flex items-center justify-center border-b border-gray-100 text-xs font-medium text-gray-700"
                                style={{ height: ROW_HEIGHT }}
                            >
                                {row.blockId}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Timeline content */}
                <div
                    ref={containerRef}
                    className="flex-1 overflow-auto"
                    onScroll={handleScroll}
                >
                    <div style={{ minWidth: totalWidth, position: 'relative' }}>
                        {/* Time axis */}
                        <div
                            className="sticky top-0 z-10 bg-white border-b border-gray-200 flex"
                            style={{ height: TIME_LABEL_HEIGHT }}
                        >
                            {hours.map(hour => (
                                <div
                                    key={hour}
                                    className="flex-shrink-0 border-r border-gray-100 flex items-end justify-start px-1 pb-1"
                                    style={{ width: hourWidth }}
                                >
                                    <span className="text-[10px] text-gray-500">
                                        {formatHourLabel(hour)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Trip rows */}
                        <div className="relative">
                            {/* Grid lines */}
                            <div className="absolute inset-0 pointer-events-none">
                                {hours.map(hour => (
                                    <div
                                        key={hour}
                                        className="absolute top-0 bottom-0 border-l border-gray-100"
                                        style={{ left: (hour - minHour) * hourWidth }}
                                    />
                                ))}
                            </div>

                            {/* Block rows with trips */}
                            {blockRows.map((row, rowIndex) => (
                                <div
                                    key={row.blockId}
                                    className={`relative ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                    style={{ height: ROW_HEIGHT }}
                                >
                                    {row.trips.map(trip => {
                                        const bounds = resolveTripBounds(trip);
                                        const left = timeToX(bounds.startTime);
                                        const width = timeToX(bounds.endTime) - left;
                                        const isSelected = selectedTripId === trip.id;
                                        const isHovered = hoveredTripId === trip.id;

                                        return (
                                            <div
                                                key={trip.id}
                                                className={`absolute top-2 rounded-sm cursor-pointer transition-all ${getTripColor(trip.direction, isSelected, trip.hasOverlap)} ${isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : ''} ${isDragging && dragTripId === trip.id ? 'opacity-75' : ''}`}
                                                style={{
                                                    left,
                                                    width: Math.max(width, 4),
                                                    height: ROW_HEIGHT - 16,
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`Trip ${trip.blockId} ${trip.direction} ${formatTime(bounds.startTime)} to ${formatTime(bounds.endTime)}`}
                                                onMouseDown={(e) => handleMouseDown(e, trip.id, 'move')}
                                                onKeyDown={(e) => handleTripKeyDown(e, trip)}
                                                onMouseEnter={() => setHoveredTripId(trip.id)}
                                                onMouseLeave={() => setHoveredTripId(null)}
                                                title={`${trip.direction}: ${formatTime(bounds.startTime)} - ${formatTime(bounds.endTime)} (${trip.travelTime} min)`}
                                            >
                                                {/* Resize handles */}
                                                {width > 20 && (
                                                    <>
                                                        <div
                                                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 rounded-l-sm"
                                                            onMouseDown={(e) => {
                                                                e.stopPropagation();
                                                                handleMouseDown(e, trip.id, 'resize-start');
                                                            }}
                                                        />
                                                        <div
                                                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 rounded-r-sm"
                                                            onMouseDown={(e) => {
                                                                e.stopPropagation();
                                                                handleMouseDown(e, trip.id, 'resize-end');
                                                            }}
                                                        />
                                                    </>
                                                )}

                                                {/* Trip label */}
                                                {width > 40 && (
                                                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-medium truncate px-1">
                                                        {trip.direction[0]}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs">
                <div className="flex items-center gap-1.5">
                    <div className="w-4 h-3 bg-gray-500 rounded-sm" />
                    <span className="text-gray-600">Northbound</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-4 h-3 bg-gray-400 rounded-sm" />
                    <span className="text-gray-600">Southbound</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-4 h-3 bg-red-400 rounded-sm" />
                    <span className="text-gray-600">Overlapping</span>
                </div>
                <div className="flex-1" />
                <span className="text-gray-400">Drag bars to adjust times. Drag edges to resize.</span>
            </div>
        </div>
    );
};

export default TimelineView;
