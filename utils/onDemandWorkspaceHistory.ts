export interface OnDemandWorkspaceHistoryEntry<TSnapshot> {
  label: string;
  snapshot: TSnapshot;
}

export interface OnDemandWorkspaceHistory<TSnapshot> {
  undoStack: OnDemandWorkspaceHistoryEntry<TSnapshot>[];
  redoStack: OnDemandWorkspaceHistoryEntry<TSnapshot>[];
}

export const DEFAULT_ON_DEMAND_WORKSPACE_HISTORY_LIMIT = 50;

export function pushOnDemandWorkspaceHistory<TSnapshot>(
  history: OnDemandWorkspaceHistory<TSnapshot>,
  entry: OnDemandWorkspaceHistoryEntry<TSnapshot>,
  maxHistory = DEFAULT_ON_DEMAND_WORKSPACE_HISTORY_LIMIT,
): OnDemandWorkspaceHistory<TSnapshot> {
  return {
    undoStack: [...history.undoStack, entry].slice(-maxHistory),
    redoStack: [],
  };
}

export function undoOnDemandWorkspaceHistory<TSnapshot>(
  history: OnDemandWorkspaceHistory<TSnapshot>,
  currentEntry: OnDemandWorkspaceHistoryEntry<TSnapshot>,
): {
  history: OnDemandWorkspaceHistory<TSnapshot>;
  restored: OnDemandWorkspaceHistoryEntry<TSnapshot> | null;
} {
  const restored = history.undoStack.at(-1) ?? null;
  if (!restored) {
    return { history, restored: null };
  }

  return {
    restored,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, currentEntry],
    },
  };
}

export function redoOnDemandWorkspaceHistory<TSnapshot>(
  history: OnDemandWorkspaceHistory<TSnapshot>,
  currentEntry: OnDemandWorkspaceHistoryEntry<TSnapshot>,
): {
  history: OnDemandWorkspaceHistory<TSnapshot>;
  restored: OnDemandWorkspaceHistoryEntry<TSnapshot> | null;
} {
  const restored = history.redoStack.at(-1) ?? null;
  if (!restored) {
    return { history, restored: null };
  }

  return {
    restored,
    history: {
      undoStack: [...history.undoStack, currentEntry],
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}
