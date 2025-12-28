/**
 * Segment Time Editor Component
 * Inline editing with ↑/↓ arrows and direct input for segment travel times.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface SegmentTimeEditorProps {
    tripId: string;
    stopName: string;
    currentMinutes: number;
    onAdjust: (tripId: string, stopName: string, delta: number) => void;
    label?: string;
    className?: string;
}

export const SegmentTimeEditor: React.FC<SegmentTimeEditorProps> = ({
    tripId,
    stopName,
    currentMinutes,
    onAdjust,
    label,
    className = ''
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState(String(currentMinutes));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setInputValue(String(currentMinutes));
    }, [currentMinutes]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleIncrement = (e: React.MouseEvent) => {
        e.stopPropagation();
        onAdjust(tripId, stopName, 1);
    };

    const handleDecrement = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (currentMinutes > 0) {
            onAdjust(tripId, stopName, -1);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    };

    const handleInputBlur = () => {
        const newValue = parseInt(inputValue);
        if (!isNaN(newValue) && newValue >= 0 && newValue !== currentMinutes) {
            const delta = newValue - currentMinutes;
            onAdjust(tripId, stopName, delta);
        } else {
            setInputValue(String(currentMinutes));
        }
        setIsEditing(false);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleInputBlur();
        } else if (e.key === 'Escape') {
            setInputValue(String(currentMinutes));
            setIsEditing(false);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            onAdjust(tripId, stopName, 1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentMinutes > 0) {
                onAdjust(tripId, stopName, -1);
            }
        }
    };

    return (
        <div className={`inline-flex items-center gap-0.5 ${className}`}>
            {/* Decrement Button */}
            <button
                onClick={handleDecrement}
                disabled={currentMinutes <= 0}
                className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Decrease 1 minute"
            >
                <ChevronDown size={12} />
            </button>

            {/* Value Display / Input */}
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="number"
                    min="0"
                    value={inputValue}
                    onChange={handleInputChange}
                    onBlur={handleInputBlur}
                    onKeyDown={handleInputKeyDown}
                    className="w-8 h-5 text-center text-[10px] font-medium border border-blue-300 rounded focus:ring-1 focus:ring-blue-400 focus:outline-none"
                />
            ) : (
                <button
                    onClick={() => setIsEditing(true)}
                    className="min-w-[20px] px-1 py-0.5 text-center text-[10px] font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
                    title={label || 'Click to edit'}
                >
                    {currentMinutes}
                </button>
            )}

            {/* Increment Button */}
            <button
                onClick={handleIncrement}
                className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                title="Increase 1 minute"
            >
                <ChevronUp size={12} />
            </button>
        </div>
    );
};

export default SegmentTimeEditor;
