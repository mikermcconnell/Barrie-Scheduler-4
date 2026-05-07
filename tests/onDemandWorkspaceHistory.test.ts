import { describe, expect, it } from 'vitest';
import {
  pushOnDemandWorkspaceHistory,
  redoOnDemandWorkspaceHistory,
  undoOnDemandWorkspaceHistory,
  type OnDemandWorkspaceHistory,
} from '../utils/onDemandWorkspaceHistory';

interface TestSnapshot {
  value: string;
}

const entry = (label: string, value: string) => ({
  label,
  snapshot: { value },
});

describe('onDemandWorkspaceHistory', () => {
  it('supports multiple undo actions and redo actions in order', () => {
    let history: OnDemandWorkspaceHistory<TestSnapshot> = { undoStack: [], redoStack: [] };
    history = pushOnDemandWorkspaceHistory(history, entry('first change', 'start'));
    history = pushOnDemandWorkspaceHistory(history, entry('second change', 'middle'));

    const firstUndo = undoOnDemandWorkspaceHistory(history, entry('current state', 'end'));
    expect(firstUndo.restored?.snapshot.value).toBe('middle');
    expect(firstUndo.history.undoStack.map(item => item.snapshot.value)).toEqual(['start']);
    expect(firstUndo.history.redoStack.map(item => item.snapshot.value)).toEqual(['end']);

    const secondUndo = undoOnDemandWorkspaceHistory(firstUndo.history, firstUndo.restored!);
    expect(secondUndo.restored?.snapshot.value).toBe('start');
    expect(secondUndo.history.undoStack).toHaveLength(0);
    expect(secondUndo.history.redoStack.map(item => item.snapshot.value)).toEqual(['end', 'middle']);

    const firstRedo = redoOnDemandWorkspaceHistory(secondUndo.history, secondUndo.restored!);
    expect(firstRedo.restored?.snapshot.value).toBe('middle');
    expect(firstRedo.history.undoStack.map(item => item.snapshot.value)).toEqual(['start']);
    expect(firstRedo.history.redoStack.map(item => item.snapshot.value)).toEqual(['end']);

    const secondRedo = redoOnDemandWorkspaceHistory(firstRedo.history, firstRedo.restored!);
    expect(secondRedo.restored?.snapshot.value).toBe('end');
    expect(secondRedo.history.undoStack.map(item => item.snapshot.value)).toEqual(['start', 'middle']);
    expect(secondRedo.history.redoStack).toHaveLength(0);
  });

  it('clears redo history when a new change is captured', () => {
    let history: OnDemandWorkspaceHistory<TestSnapshot> = {
      undoStack: [entry('first change', 'start')],
      redoStack: [entry('redoable change', 'end')],
    };

    history = pushOnDemandWorkspaceHistory(history, entry('new change', 'new-start'));

    expect(history.undoStack.map(item => item.snapshot.value)).toEqual(['start', 'new-start']);
    expect(history.redoStack).toHaveLength(0);
  });

  it('caps stored undo history to the configured limit', () => {
    let history: OnDemandWorkspaceHistory<TestSnapshot> = { undoStack: [], redoStack: [] };

    history = pushOnDemandWorkspaceHistory(history, entry('one', '1'), 2);
    history = pushOnDemandWorkspaceHistory(history, entry('two', '2'), 2);
    history = pushOnDemandWorkspaceHistory(history, entry('three', '3'), 2);

    expect(history.undoStack.map(item => item.snapshot.value)).toEqual(['2', '3']);
  });
});
