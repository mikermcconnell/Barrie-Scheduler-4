/**
 * Stacked Time Input Components
 *
 * UI components for displaying and editing times in a compact stacked format.
 * Shows time (e.g., "6:30") on top and period ("AM") below.
 */

import React, { useState, useEffect, useRef } from 'react';
import { parseStackedTime, sanitizeInput } from '../../utils/scheduleEditorUtils';

// --- StackedTimeCell ---
// Display-only component for showing times in stacked format

interface StackedTimeCellProps {
    timeStr: string | undefined;
    className?: string;
}

export const StackedTimeCell: React.FC<StackedTimeCellProps> = ({ timeStr, className = '' }) => {
    const parsed = parseStackedTime(timeStr);
    if (!parsed) {
        return <span className={`whitespace-nowrap ${className}`}>{timeStr || '-'}</span>;
    }
    return (
        <span className={`text-[11px] font-medium text-gray-700 whitespace-nowrap ${className}`}>
            {`${parsed.time} ${parsed.period}`}
        </span>
    );
};

// --- StackedTimeInput ---
// Editable input that shows stacked format when not editing

export interface StackedTimeInputProps {
    value: string;
    onChange: (value: string) => void;
    onBlur: (value: string) => void;
    disabled?: boolean;
    focusClass?: string;
    placeholder?: string;
    /** Callback for time adjustment (+/- minutes) via W/S or Arrow keys */
    onAdjust?: (delta: number) => void;
    /** Callback for cell navigation via A/D or Arrow keys */
    onNavigate?: (direction: 'left' | 'right' | 'up' | 'down') => void;
}

export const StackedTimeInput: React.FC<StackedTimeInputProps> = ({
    value,
    onChange,
    onBlur,
    disabled = false,
    focusClass = 'focus:ring-blue-100',
    placeholder = '-',
    onAdjust,
    onNavigate
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync when external value changes (only when not editing)
    useEffect(() => {
        if (!isEditing) {
            setEditValue(value);
        }
    }, [value, isEditing]);

    // Focus input when entering edit mode
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleStartEdit = () => {
        if (disabled) return;
        setEditValue(value);
        setIsEditing(true);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const sanitized = sanitizeInput(e.target.value);
        setEditValue(sanitized);
        onChange(sanitized);
    };

    const handleBlur = () => {
        setIsEditing(false);
        onBlur(editValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            setIsEditing(false);
            onBlur(editValue);
        } else if (e.key === 'Escape') {
            setEditValue(value); // Revert
            setIsEditing(false);
        } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
            // Adjust time +1 minute
            if (onAdjust) {
                e.preventDefault();
                onAdjust(1);
            } else if (onNavigate && (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W')) {
                e.preventDefault();
                onNavigate('up');
            }
        } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
            // Adjust time -1 minute
            if (onAdjust) {
                e.preventDefault();
                onAdjust(-1);
            } else if (onNavigate) {
                e.preventDefault();
                onNavigate('down');
            }
        } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            // Navigate left
            if (onNavigate) {
                e.preventDefault();
                onNavigate('left');
            }
        } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            // Navigate right
            if (onNavigate) {
                e.preventDefault();
                onNavigate('right');
            }
        }
    };

    const parsed = parseStackedTime(value);

    // Editing mode - show visible text input
    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className={`w-full h-full bg-white font-medium text-[11px] text-gray-900 text-center ring-2 ${focusClass} outline-none px-1`}
                placeholder={placeholder}
                disabled={disabled}
            />
        );
    }

    // Display mode - show formatted time, click to edit
    return (
        <div
            className={`flex items-center justify-center w-full h-full py-1 whitespace-nowrap ${disabled ? 'cursor-default' : 'cursor-text hover:bg-gray-50'}`}
            onClick={handleStartEdit}
        >
            {parsed ? (
                <span className="text-[11px] font-medium text-gray-700">{`${parsed.time} ${parsed.period}`}</span>
            ) : (
                <span className="text-[11px] text-gray-400">{value || placeholder}</span>
            )}
        </div>
    );
};
