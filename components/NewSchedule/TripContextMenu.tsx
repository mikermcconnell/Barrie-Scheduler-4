/**
 * Trip Context Menu Component
 * Right-click menu for trip row actions: End Block Here, Start Block Here, Delete, Add Trip.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Plus, MapPinOff, MapPin, Copy, ChevronRight } from 'lucide-react';

export interface TripContextMenuAction {
    type: 'endBlockHere' | 'startBlockHere' | 'deleteTrip' | 'deleteRoundTrip' | 'addTripAfter' | 'duplicateTrip';
    tripId: string;
    tripIds?: string[];
    stopName?: string;
    stopIndex?: number;
}

interface TripContextMenuProps {
    x: number;
    y: number;
    tripId: string;
    tripDirection: 'North' | 'South';
    blockId: string;
    currentStopName?: string;
    currentStopIndex?: number;
    stops: string[];
    rowTripIds?: string[];
    menuLabel?: string;
    addLabel?: string;
    deleteLabel?: string;
    hideTripSpecificActions?: boolean;
    onAction: (action: TripContextMenuAction) => void;
    onClose: () => void;
}

export const TripContextMenu: React.FC<TripContextMenuProps> = ({
    x,
    y,
    tripId,
    tripDirection,
    blockId,
    currentStopName,
    currentStopIndex,
    stops,
    rowTripIds,
    menuLabel,
    addLabel,
    deleteLabel,
    hideTripSpecificActions = false,
    onAction,
    onClose
}) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [activeSubmenu, setActiveSubmenu] = useState<'endBlock' | 'startBlock' | null>(null);
    const [submenuPosition, setSubmenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    // Adjust position to keep menu in viewport
    useEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            if (rect.right > viewportWidth) {
                menuRef.current.style.left = `${x - rect.width}px`;
            }
            if (rect.bottom > viewportHeight) {
                menuRef.current.style.top = `${y - rect.height}px`;
            }
        }
    }, [x, y]);

    const handleAction = (type: TripContextMenuAction['type'], stopName?: string, stopIndex?: number) => {
        onAction({
            type,
            tripId,
            tripIds: rowTripIds,
            stopName,
            stopIndex
        });
        onClose();
    };

    const openSubmenu = (submenu: 'endBlock' | 'startBlock', element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        setSubmenuPosition({
            x: rect.right,
            y: rect.top
        });
        setActiveSubmenu(submenu);
    };

    const handleSubmenuKeyDown = (
        e: React.KeyboardEvent<HTMLButtonElement>,
        submenu: 'endBlock' | 'startBlock'
    ) => {
        if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openSubmenu(submenu, e.currentTarget);
        }
    };

    // Stops for "End Block Here" - all except the last one
    const endBlockStops = stops.slice(0, -1);
    // Stops for "Start Block Here" - all except the first one
    const startBlockStops = stops.slice(1);

    return (
        // z-[10000] ensures context menu appears above fullscreen container (z-[9999])
        <div
            ref={menuRef}
            className="fixed z-[10000] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
            style={{ left: x, top: y }}
            onMouseLeave={() => setActiveSubmenu(null)}
        >
            {/* Header */}
            <div className="px-3 py-2 border-b border-gray-100">
                <div className="text-xs font-semibold text-gray-700">Block {blockId}</div>
                <div className="text-[10px] text-gray-400">{menuLabel ?? `${tripDirection}bound`}</div>
            </div>

            {/* Actions */}
            <div className="py-1">
                {/* Start Block Here - with submenu */}
                {!hideTripSpecificActions && startBlockStops.length > 0 && (
                    <div className="relative">
                        <button
                            onMouseEnter={(e) => openSubmenu('startBlock', e.currentTarget)}
                            onFocus={(e) => openSubmenu('startBlock', e.currentTarget)}
                            onKeyDown={(e) => handleSubmenuKeyDown(e, 'startBlock')}
                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={activeSubmenu === 'startBlock'}
                        >
                            <MapPin size={14} className="text-green-500" />
                            <span className="flex-1">Start Trip Here</span>
                            <ChevronRight size={14} className="text-gray-400" />
                        </button>

                        {/* Submenu for Start Block */}
                        {activeSubmenu === 'startBlock' && (
                            <div
                                className="fixed z-[101] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] max-h-[300px] overflow-y-auto"
                                style={{ left: submenuPosition.x, top: submenuPosition.y }}
                                onMouseEnter={() => setActiveSubmenu('startBlock')}
                            >
                                <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                                    Select Start Stop
                                </div>
                                {startBlockStops.map((stop, idx) => {
                                    const actualIndex = idx + 1; // +1 because we sliced off the first
                                    return (
                                        <button
                                            key={stop}
                                            onClick={() => handleAction('startBlockHere', stop, actualIndex)}
                                            className="w-full px-3 py-1.5 text-left text-xs hover:bg-green-50 text-gray-700 truncate"
                                            title={stop}
                                        >
                                            {stop}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* End Block Here - with submenu */}
                {!hideTripSpecificActions && endBlockStops.length > 0 && (
                    <div className="relative">
                        <button
                            onMouseEnter={(e) => openSubmenu('endBlock', e.currentTarget)}
                            onFocus={(e) => openSubmenu('endBlock', e.currentTarget)}
                            onKeyDown={(e) => handleSubmenuKeyDown(e, 'endBlock')}
                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={activeSubmenu === 'endBlock'}
                        >
                            <MapPinOff size={14} className="text-orange-500" />
                            <span className="flex-1">End Trip Here</span>
                            <ChevronRight size={14} className="text-gray-400" />
                        </button>

                        {/* Submenu for End Block */}
                        {activeSubmenu === 'endBlock' && (
                            <div
                                className="fixed z-[101] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] max-h-[300px] overflow-y-auto"
                                style={{ left: submenuPosition.x, top: submenuPosition.y }}
                                onMouseEnter={() => setActiveSubmenu('endBlock')}
                            >
                                <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                                    Select End Stop
                                </div>
                                {endBlockStops.map((stop, idx) => (
                                    <button
                                        key={stop}
                                        onClick={() => handleAction('endBlockHere', stop, idx)}
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-orange-50 text-gray-700 truncate"
                                        title={stop}
                                    >
                                        {stop}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {!hideTripSpecificActions && (startBlockStops.length > 0 || endBlockStops.length > 0) && (
                    <div className="border-t border-gray-100 my-1" />
                )}

                {/* Add Trip After */}
                <button
                    onClick={() => handleAction('addTripAfter')}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
                >
                    <Plus size={14} className="text-blue-500" />
                    <span>{addLabel ?? 'Add Trip After'}</span>
                </button>

                {/* Duplicate Trip */}
                {!hideTripSpecificActions && (
                    <button
                        onClick={() => handleAction('duplicateTrip')}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
                    >
                        <Copy size={14} className="text-purple-500" />
                        <span>Duplicate Trip</span>
                    </button>
                )}

                <div className="border-t border-gray-100 my-1" />

                {/* Delete Trip */}
                <button
                    onClick={() => handleAction(hideTripSpecificActions ? 'deleteRoundTrip' : 'deleteTrip')}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-red-50 text-red-600"
                >
                    <Trash2 size={14} />
                    <span>{deleteLabel ?? 'Delete Trip'}</span>
                </button>
            </div>
        </div>
    );
};

export default TripContextMenu;
