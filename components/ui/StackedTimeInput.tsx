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
        return <span className={className}>{timeStr || '-'}</span>;
    }
    return (
        <div className={`flex flex-col items-center leading-tight ${className}`}>
            <span className="text-[11px] font-medium text-gray-700">{parsed.time}</span>
            <span className="text-[8px] font-medium text-gray-400">{parsed.period}</span>
        </div>
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
}

export const StackedTimeInput: React.FC<StackedTimeInputProps> = ({
    value,
    onChange,
    onBlur,
    disabled = false,
    focusClass = 'focus:ring-blue-100',
    placeholder = '-'
}) => {
    const [isFocused, setIsFocused] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync edit value when external value changes
    useEffect(() => {
        if (!isFocused) {
            setEditValue(value);
        }
    }, [value, isFocused]);

    const parsed = parseStackedTime(value);

    if (!isFocused && parsed) {
        // Show stacked display - clickable to edit
        return (
            <div
                className="flex flex-col items-center justify-center leading-tight cursor-text w-full h-full py-1"
                onClick={() => {
                    if (!disabled) {
                        setIsFocused(true);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    }
                }}
            >
                <span className="text-[11px] font-medium text-gray-700">{parsed.time}</span>
                <span className="text-[8px] font-medium text-gray-400">{parsed.period}</span>
                {/* Hidden input for focus management */}
                <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => {
                        setEditValue(e.target.value);
                        onChange(sanitizeInput(e.target.value));
                    }}
                    onFocus={() => setIsFocused(true)}
                    onBlur={(e) => {
                        setIsFocused(false);
                        onBlur(e.target.value);
                    }}
                    className="absolute opacity-0 w-0 h-0"
                    disabled={disabled}
                />
            </div>
        );
    }

    // Show regular input - for editing or when value doesn't parse as time
    return (
        <input
            ref={inputRef}
            type="text"
            value={isFocused ? editValue : (value || '')}
            onChange={(e) => {
                setEditValue(e.target.value);
                onChange(sanitizeInput(e.target.value));
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={(e) => {
                setIsFocused(false);
                onBlur(e.target.value);
            }}
            className={`w-full h-full bg-transparent font-medium text-[11px] text-gray-700 text-center focus:bg-white focus:ring-2 ${focusClass} focus:outline-none transition-all placeholder-gray-200 px-2`}
            placeholder={placeholder}
            disabled={disabled}
        />
    );
};
