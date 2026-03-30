/**
 * Stacked Time Input Components
 *
 * UI components for displaying and editing times in a compact stacked format.
 * Shows time (e.g., "6:30") on top and period ("AM") below.
 */

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { parseStackedTime, sanitizeInput } from '../../utils/schedule/scheduleEditorUtils';

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
        <span className={`text-xs font-medium text-gray-800 whitespace-nowrap ${className}`}>
            {`${parsed.time} ${parsed.period}`}
        </span>
    );
};

// --- StackedTimeInput ---
// Editable input that shows stacked format when not editing

export interface StackedTimeInputHandle {
    startEdit: () => void;
}

export interface StackedTimeInputProps {
    value: string;
    onChange: (value: string) => void;
    onBlur: (value: string) => void;
    disabled?: boolean;
    focusClass?: string;
    placeholder?: string;
    /** Show blue selection outline (grid navigation active cell) */
    isActive?: boolean;
    /** Called when this cell is clicked (to set it as active in grid) */
    onActivate?: () => void;
    /** Called on ArrowUp/Down while editing: nudge time +-1 min */
    onNudge?: (delta: number) => void;
    /** Called on Enter/Tab/Escape to let grid navigation move the active cell */
    onNavigateAway?: (direction: 'down' | 'right' | 'left' | 'cancel') => void;
    /** External trigger to start editing (from grid navigation Enter key) */
    externalEdit?: boolean;
    /** Accessible label describing the cell and current value */
    ariaLabel?: string;
}

export const StackedTimeInput = forwardRef<StackedTimeInputHandle, StackedTimeInputProps>(({
    value,
    onChange,
    onBlur,
    disabled = false,
    focusClass = 'focus:ring-blue-100',
    placeholder = '-',
    isActive = false,
    onActivate,
    onNudge,
    onNavigateAway,
    externalEdit = false,
    ariaLabel,
}, ref) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);
    const previousExternalEditRef = useRef(false);
    // Suppress blur-on-unmount when keyboard handler already handled save/cancel
    const blurSuppressedRef = useRef(false);

    // Expose startEdit via imperative handle
    useImperativeHandle(ref, () => ({
        startEdit: () => {
            if (!disabled) {
                setEditValue(value);
                setIsEditing(true);
            }
        }
    }), [disabled, value]);

    // External edit trigger from grid navigation
    useEffect(() => {
        const shouldStartExternalEdit = externalEdit && !previousExternalEditRef.current && !disabled;
        previousExternalEditRef.current = externalEdit;

        if (shouldStartExternalEdit) {
            setEditValue(value);
            setIsEditing(true);
        }
    }, [externalEdit, disabled, value]);

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
        onActivate?.();
        setEditValue(value);
        setIsEditing(true);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const sanitized = sanitizeInput(e.target.value);
        setEditValue(sanitized);
        onChange(sanitized);
    };

    const handleBlur = () => {
        // Skip if keyboard handler already handled save/cancel (prevents blur-on-unmount double-fire)
        if (blurSuppressedRef.current) {
            blurSuppressedRef.current = false;
            return;
        }
        setIsEditing(false);
        onBlur(editValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            blurSuppressedRef.current = true;
            setIsEditing(false);
            onBlur(editValue);
            onNavigateAway?.('down');
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            blurSuppressedRef.current = true;
            setEditValue(value); // Revert
            setIsEditing(false);
            onNavigateAway?.('cancel');
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            blurSuppressedRef.current = true;
            setIsEditing(false);
            onBlur(editValue);
            onNavigateAway?.(e.shiftKey ? 'left' : 'right');
        } else if (e.key === 'ArrowUp' && onNudge) {
            e.preventDefault();
            e.stopPropagation();
            onNudge(1);
        } else if (e.key === 'ArrowDown' && onNudge) {
            e.preventDefault();
            e.stopPropagation();
            onNudge(-1);
        }
    };

    const handleClick = () => {
        if (disabled) return;
        onActivate?.();
        if (!isEditing) {
            setEditValue(value);
            setIsEditing(true);
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
                className={`w-full h-full bg-white font-medium text-xs text-gray-900 text-center ring-2 ${focusClass} outline-none px-1`}
                placeholder={placeholder}
                disabled={disabled}
                aria-label={ariaLabel}
            />
        );
    }

    // Display mode - show formatted time, click to edit
    return (
        <button
            type="button"
            className={`flex items-center justify-center w-full h-full py-1 whitespace-nowrap border-0 bg-transparent appearance-none ${
                disabled ? 'cursor-default' : 'cursor-text hover:bg-gray-50'
            }`}
            onClick={handleClick}
            onFocus={onActivate}
            disabled={disabled}
            tabIndex={-1}
            aria-label={ariaLabel}
        >
            {parsed ? (
                <span className="text-xs font-medium text-gray-800">{`${parsed.time} ${parsed.period}`}</span>
            ) : (
                <span className="text-xs text-gray-500">{value || placeholder}</span>
            )}
        </button>
    );
});

StackedTimeInput.displayName = 'StackedTimeInput';
