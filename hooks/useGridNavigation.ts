/**
 * useGridNavigation Hook
 *
 * Provides Excel-like keyboard navigation for the schedule editor grid.
 * Manages active cell state, arrow key movement, Enter/Tab/Escape handling,
 * and copy/paste support.
 */

import { useState, useCallback, useRef } from 'react';

// --- Types ---

export interface CellAddress {
    rowIndex: number;
    colIndex: number;
    tripId: string;
    stopName: string;
    cellType: 'dep' | 'arr' | 'recovery';
    direction: 'North' | 'South';
}

export interface GridColumn {
    stopName: string;
    cellType: 'dep' | 'arr' | 'recovery';
    direction: 'North' | 'South';
}

export interface GridRowInfo {
    northTripId: string | null;
    southTripId: string | null;
    /** Whether the cell at each column is populated (has a time value) */
    populatedCols: boolean[];
}

// --- Navigation Callbacks ---

export interface GridNavigationCallbacks {
    onStartEdit?: (address: CellAddress) => void;
    onNudge?: (address: CellAddress, delta: number) => void;
    onCopy?: (address: CellAddress) => string | null;
    onPaste?: (address: CellAddress, value: string) => void;
}

interface UseGridNavigationOptions {
    columns: GridColumn[];
    rows: GridRowInfo[];
    callbacks: GridNavigationCallbacks;
    disabled?: boolean;
}

// --- Hook ---

export function useGridNavigation({
    columns,
    rows,
    callbacks,
    disabled = false
}: UseGridNavigationOptions) {
    const [activeCell, setActiveCell] = useState<CellAddress | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Build a CellAddress from row/col indices
    const buildAddress = useCallback((rowIndex: number, colIndex: number): CellAddress | null => {
        if (rowIndex < 0 || rowIndex >= rows.length) return null;
        if (colIndex < 0 || colIndex >= columns.length) return null;

        const col = columns[colIndex];
        const row = rows[rowIndex];
        const tripId = col.direction === 'North' ? row.northTripId : row.southTripId;
        if (!tripId) return null;

        return {
            rowIndex,
            colIndex,
            tripId,
            stopName: col.stopName,
            cellType: col.cellType,
            direction: col.direction,
        };
    }, [columns, rows]);

    // Check if a cell is populated (has data)
    const isCellPopulated = useCallback((rowIndex: number, colIndex: number): boolean => {
        if (rowIndex < 0 || rowIndex >= rows.length) return false;
        if (colIndex < 0 || colIndex >= columns.length) return false;
        const row = rows[rowIndex];
        const col = columns[colIndex];
        const tripId = col.direction === 'North' ? row.northTripId : row.southTripId;
        if (!tripId) return false;
        return row.populatedCols[colIndex] ?? false;
    }, [columns, rows]);

    // Find the next populated cell in a direction, skipping empties
    const findNextCell = useCallback((
        startRow: number, startCol: number,
        dRow: number, dCol: number,
        maxSteps = 200
    ): { row: number; col: number } | null => {
        let row = startRow;
        let col = startCol;
        let steps = 0;

        while (steps < maxSteps) {
            steps++;
            col += dCol;
            row += dRow;

            // Column wrapping (for left/right movement only)
            if (dCol !== 0 && dRow === 0) {
                if (col < 0) { row--; col = columns.length - 1; }
                else if (col >= columns.length) { row++; col = 0; }
            }

            // Bounds check
            if (row < 0 || row >= rows.length) return null;
            if (col < 0 || col >= columns.length) return null;

            if (isCellPopulated(row, col)) {
                return { row, col };
            }

            // For vertical movement, keep trying the same column in adjacent rows
            if (dCol === 0 && dRow !== 0) continue;
            // For horizontal movement, keep scanning
            if (dRow === 0 && dCol !== 0) continue;
        }

        return null;
    }, [columns.length, rows.length, isCellPopulated]);

    const findBoundaryCell = useCallback((position: 'first' | 'last'): { row: number; col: number } | null => {
        if (position === 'first') {
            for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                for (let colIndex = 0; colIndex < columns.length; colIndex++) {
                    if (isCellPopulated(rowIndex, colIndex)) {
                        return { row: rowIndex, col: colIndex };
                    }
                }
            }
            return null;
        }

        for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
            for (let colIndex = columns.length - 1; colIndex >= 0; colIndex--) {
                if (isCellPopulated(rowIndex, colIndex)) {
                    return { row: rowIndex, col: colIndex };
                }
            }
        }

        return null;
    }, [columns.length, rows.length, isCellPopulated]);

    // Navigate to a specific cell
    const navigateTo = useCallback((rowIndex: number, colIndex: number, andEdit = false) => {
        const address = buildAddress(rowIndex, colIndex);
        if (!address) return;

        // Recovery cells have no input — never enter edit mode for them
        const shouldEdit = andEdit && address.cellType !== 'recovery';

        setActiveCell(address);
        setIsEditing(shouldEdit);

        // Scroll into view
        requestAnimationFrame(() => {
            const el = containerRef.current?.querySelector(
                `[data-grid-row="${rowIndex}"][data-grid-col="${colIndex}"]`
            ) as HTMLElement | null;
            el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });

        if (shouldEdit) {
            callbacks.onStartEdit?.(address);
        }
    }, [buildAddress, callbacks]);

    const focusFirstCell = useCallback((andEdit = false) => {
        const first = findBoundaryCell('first');
        if (first) {
            navigateTo(first.row, first.col, andEdit);
        }
    }, [findBoundaryCell, navigateTo]);

    const focusLastCell = useCallback((andEdit = false) => {
        const last = findBoundaryCell('last');
        if (last) {
            navigateTo(last.row, last.col, andEdit);
        }
    }, [findBoundaryCell, navigateTo]);

    // Activate a specific cell (called on click)
    const activateCell = useCallback((rowIndex: number, colIndex: number) => {
        if (disabled) return;
        const address = buildAddress(rowIndex, colIndex);
        if (address) {
            setActiveCell(address);
            setIsEditing(false);
        }
    }, [disabled, buildAddress]);

    // Start editing the active cell
    const startEditing = useCallback(() => {
        if (!activeCell) return;
        setIsEditing(true);
        callbacks.onStartEdit?.(activeCell);
    }, [activeCell, callbacks]);

    // Called by StackedTimeInput when edit completes
    const commitEdit = useCallback((moveDirection: 'down' | 'right' | 'left' | 'none' = 'none') => {
        setIsEditing(false);
        if (!activeCell) return;

        if (moveDirection === 'down') {
            const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, 1, 0);
            if (next) {
                const addr = buildAddress(next.row, next.col);
                if (addr) setActiveCell(addr);
            }
        } else if (moveDirection === 'right') {
            const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, 0, 1);
            if (next) {
                const addr = buildAddress(next.row, next.col);
                if (addr) {
                    setActiveCell(addr);
                    // Recovery cells have no input — don't enter edit mode
                    if (addr.cellType !== 'recovery') {
                        setIsEditing(true);
                        callbacks.onStartEdit?.(addr);
                    }
                }
            }
        } else if (moveDirection === 'left') {
            const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, 0, -1);
            if (next) {
                const addr = buildAddress(next.row, next.col);
                if (addr) {
                    setActiveCell(addr);
                    if (addr.cellType !== 'recovery') {
                        setIsEditing(true);
                        callbacks.onStartEdit?.(addr);
                    }
                }
            }
        }
    }, [activeCell, findNextCell, buildAddress, callbacks]);

    // Cancel editing, keep active cell
    const cancelEdit = useCallback(() => {
        setIsEditing(false);
    }, []);

    // Clear active cell
    const clearActiveCell = useCallback(() => {
        setActiveCell(null);
        setIsEditing(false);
    }, []);

    // Handle nudge from StackedTimeInput (ArrowUp/Down while editing)
    const handleNudge = useCallback((delta: number) => {
        if (!activeCell) return;
        callbacks.onNudge?.(activeCell, delta);
    }, [activeCell, callbacks]);

    // Keyboard handler for the table container (when NOT editing)
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (disabled) return;

        // Don't interfere when an input/textarea has focus (click-to-edit or grid-triggered edit)
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (isEditing) return;

        if (!activeCell) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
                e.preventDefault();
                focusFirstCell();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'End') {
                e.preventDefault();
                focusLastCell();
            } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'F2', ' ', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                focusFirstCell(e.key === 'Enter' || e.key === 'F2' || e.key === ' ');
            }
            return;
        }

        // Ctrl+C: Copy
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            e.stopPropagation();
            const value = callbacks.onCopy?.(activeCell);
            if (value) {
                navigator.clipboard.writeText(value).catch(() => {});
            }
            return;
        }

        // Ctrl/Cmd+V: Paste
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.readText().then(text => {
                if (text && callbacks.onPaste) {
                    callbacks.onPaste(activeCell, text.trim());
                }
            }).catch(() => {});
            return;
        }

        // Ctrl/Cmd+Home/End: jump to first/last populated cell in the grid
        if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
            e.preventDefault();
            focusFirstCell();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'End') {
            e.preventDefault();
            focusLastCell();
            return;
        }

        // Don't capture Ctrl/Cmd+Z/Y/S — those are handled at document level
        if (e.ctrlKey || e.metaKey) return;

        switch (e.key) {
            case 'ArrowLeft': {
                e.preventDefault();
                const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, 0, -1);
                if (next) navigateTo(next.row, next.col);
                break;
            }
            case 'ArrowRight': {
                e.preventDefault();
                const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, 0, 1);
                if (next) navigateTo(next.row, next.col);
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                // For recovery cells, nudge directly instead of navigating
                if (activeCell.cellType === 'recovery') {
                    callbacks.onNudge?.(activeCell, 1);
                } else {
                    const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, -1, 0);
                    if (next) navigateTo(next.row, next.col);
                }
                break;
            }
            case 'ArrowDown': {
                e.preventDefault();
                if (activeCell.cellType === 'recovery') {
                    callbacks.onNudge?.(activeCell, -1);
                } else {
                    const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, 1, 0);
                    if (next) navigateTo(next.row, next.col);
                }
                break;
            }
            case 'Enter': {
                e.preventDefault();
                if (activeCell.cellType !== 'recovery') {
                    startEditing();
                }
                break;
            }
            case 'F2':
            case ' ': {
                e.preventDefault();
                if (activeCell.cellType !== 'recovery') {
                    startEditing();
                }
                break;
            }
            case 'Tab': {
                e.preventDefault();
                const dir = e.shiftKey ? -1 : 1;
                const next = findNextCell(activeCell.rowIndex, activeCell.colIndex, 0, dir);
                if (next) {
                    navigateTo(next.row, next.col, true); // move + start editing
                }
                break;
            }
            case 'Escape': {
                clearActiveCell();
                // Return focus to container so keyboard still works
                containerRef.current?.focus();
                break;
            }
            case 'Home': {
                e.preventDefault();
                // Find first populated cell in the row
                for (let c = 0; c < columns.length; c++) {
                    if (isCellPopulated(activeCell.rowIndex, c)) {
                        navigateTo(activeCell.rowIndex, c);
                        break;
                    }
                }
                break;
            }
            case 'End': {
                e.preventDefault();
                // Find last populated cell in the row
                for (let c = columns.length - 1; c >= 0; c--) {
                    if (isCellPopulated(activeCell.rowIndex, c)) {
                        navigateTo(activeCell.rowIndex, c);
                        break;
                    }
                }
                break;
            }
        }
    }, [disabled, isEditing, activeCell, findNextCell, navigateTo, clearActiveCell,
        startEditing, columns.length, isCellPopulated, callbacks, focusFirstCell, focusLastCell]);

    // Helper: check if a given cell is the active cell
    const isCellActive = useCallback((rowIndex: number, colIndex: number): boolean => {
        return activeCell?.rowIndex === rowIndex && activeCell?.colIndex === colIndex;
    }, [activeCell]);

    // Helper: check if a given row is the active row
    const isRowActive = useCallback((rowIndex: number): boolean => {
        return activeCell?.rowIndex === rowIndex;
    }, [activeCell]);

    return {
        activeCell,
        isEditing,
        containerRef,
        activateCell,
        clearActiveCell,
        startEditing,
        commitEdit,
        cancelEdit,
        handleKeyDown,
        handleNudge,
        focusFirstCell,
        focusLastCell,
        isCellActive,
        isRowActive,
        navigateTo,
    };
}
