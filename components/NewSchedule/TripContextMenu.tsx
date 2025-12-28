/**
 * Trip Context Menu Component
 * Right-click menu for trip row actions: End Block Here, Start Block Here, Delete, Add Trip.
 */

import React, { useEffect, useRef } from 'react';
import { Trash2, Plus, MapPinOff, MapPin, Scissors } from 'lucide-react';

export interface TripContextMenuAction {
    type: 'endBlockHere' | 'startBlockHere' | 'deleteTrip' | 'addTripAfter';
    tripId: string;
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
    onAction,
    onClose
}) => {
    const menuRef = useRef<HTMLDivElement>(null);

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

    const handleAction = (type: TripContextMenuAction['type']) => {
        onAction({
            type,
            tripId,
            stopName: currentStopName,
            stopIndex: currentStopIndex
        });
        onClose();
    };

    const isFirstStop = currentStopIndex === 0;
    const isLastStop = currentStopIndex === stops.length - 1;

    return (
        <div
            ref={menuRef}
            className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
            style={{ left: x, top: y }}
        >
            {/* Header */}
            <div className="px-3 py-2 border-b border-gray-100">
                <div className="text-xs font-semibold text-gray-700">Block {blockId}</div>
                <div className="text-[10px] text-gray-400">{tripDirection}bound</div>
                {currentStopName && (
                    <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={currentStopName}>
                        @ {currentStopName}
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="py-1">
                {/* Start Block Here - only if not first stop */}
                {currentStopName && !isFirstStop && (
                    <button
                        onClick={() => handleAction('startBlockHere')}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
                    >
                        <MapPin size={14} className="text-green-500" />
                        <span>Start Block Here</span>
                    </button>
                )}

                {/* End Block Here - only if not last stop */}
                {currentStopName && !isLastStop && (
                    <button
                        onClick={() => handleAction('endBlockHere')}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
                    >
                        <MapPinOff size={14} className="text-orange-500" />
                        <span>End Block Here</span>
                    </button>
                )}

                {(currentStopName && !isFirstStop && !isLastStop) && (
                    <div className="border-t border-gray-100 my-1" />
                )}

                {/* Add Trip After */}
                <button
                    onClick={() => handleAction('addTripAfter')}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
                >
                    <Plus size={14} className="text-blue-500" />
                    <span>Add Trip After</span>
                </button>

                <div className="border-t border-gray-100 my-1" />

                {/* Delete Trip */}
                <button
                    onClick={() => handleAction('deleteTrip')}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-red-50 text-red-600"
                >
                    <Trash2 size={14} />
                    <span>Delete Trip</span>
                </button>
            </div>
        </div>
    );
};

export default TripContextMenu;
