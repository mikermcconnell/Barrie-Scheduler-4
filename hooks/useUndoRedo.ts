import { useState, useCallback } from 'react';

interface UseUndoRedoOptions {
    maxHistory?: number;
}

export interface UndoRedoState<T> {
    past: T[];
    present: T;
    future: T[];
}

export function useUndoRedo<T>(initialState: T, options: UseUndoRedoOptions = {}) {
    const { maxHistory = 50 } = options;

    const [state, setState] = useState<UndoRedoState<T>>({
        past: [],
        present: initialState,
        future: []
    });

    const canUndo = state.past.length > 0;
    const canRedo = state.future.length > 0;

    const undo = useCallback(() => {
        setState(currentState => {
            if (currentState.past.length === 0) return currentState;

            const previous = currentState.past[currentState.past.length - 1];
            const newPast = currentState.past.slice(0, currentState.past.length - 1);

            return {
                past: newPast,
                present: previous,
                future: [currentState.present, ...currentState.future]
            };
        });
    }, []);

    const redo = useCallback(() => {
        setState(currentState => {
            if (currentState.future.length === 0) return currentState;

            const next = currentState.future[0];
            const newFuture = currentState.future.slice(1);

            return {
                past: [...currentState.past, currentState.present],
                present: next,
                future: newFuture
            };
        });
    }, []);

    const set = useCallback((newPresent: T) => {
        console.log('useUndoRedo set called');
        setState(currentState => {
            // If the new state is exactly the same as current, don't add to history
            // Use JSON stringify for simple deep equality check (sufficient for this use case)
            const currentJson = JSON.stringify(currentState.present);
            const newJson = JSON.stringify(newPresent);
            const isEqual = currentJson === newJson;
            console.log('useUndoRedo equality check:', isEqual, 'currentLen:', currentJson.length, 'newLen:', newJson.length);

            if (isEqual) {
                console.log('useUndoRedo: states are equal, returning current state');
                return currentState;
            }

            const newPast = [...currentState.past, currentState.present];
            if (newPast.length > maxHistory) {
                newPast.shift(); // Remove oldest
            }

            console.log('useUndoRedo: states are different, updating state');
            return {
                past: newPast,
                present: newPresent,
                future: [] // Clear future on new change
            };
        });
    }, [maxHistory]);

    // Reset history (e.g., when loading a new file)
    const reset = useCallback((newInitialState: T) => {
        setState({
            past: [],
            present: newInitialState,
            future: []
        });
    }, []);

    return {
        state: state.present,
        set,
        undo,
        redo,
        canUndo,
        canRedo,
        reset,
        historyState: state // Expose full state if needed
    };
}
