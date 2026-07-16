import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  GitCompareArrows,
  History,
  Info,
  X,
} from 'lucide-react';

export type ScheduleReviewIssueSeverity = 'error' | 'warning' | 'info';

export interface ScheduleReviewIssue {
  id: string;
  severity: ScheduleReviewIssueSeverity;
  title: string;
  detail?: string;
  rowId?: string;
  rowLabel?: string;
}

export interface ScheduleReviewChangeCounts {
  added: number;
  removed: number;
  retimed: number;
  blockChanged: number;
}

export interface ScheduleReviewChange {
  id: string;
  title: string;
  rowId?: string;
  rowLabel?: string;
}

export interface ScheduleReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sourceMasterLabel: string;
  sourceMasterVersion?: string | number;
  baselineTripCount?: number;
  changeCounts: ScheduleReviewChangeCounts;
  changes?: ScheduleReviewChange[];
  issues: ScheduleReviewIssue[];
  onJumpToRow?: (rowId: string) => void;
  onNextChange?: () => void;
  showChangedOnly?: boolean;
  onShowChangedOnlyChange?: (show: boolean) => void;
  publishNote: string;
  onPublishNoteChange: (note: string) => void;
  isStale?: boolean;
  staleMessage?: string;
  onCreateCheckpoint?: () => void;
  checkpointDisabled?: boolean;
  checkpoints?: Array<{ id: string; name: string; createdAtLabel: string }>;
  onRestoreCheckpoint?: (checkpointId: string) => void;
  onReadyForReview?: () => void;
  readyForReviewDisabled?: boolean;
  onPublish?: () => void;
  publishDisabled?: boolean;
  isWorking?: boolean;
}

const severityRank: Record<ScheduleReviewIssueSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const severityPresentation = {
  error: {
    label: 'Critical',
    icon: AlertCircle,
    container: 'border-red-200 bg-red-50/70',
    iconClass: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    container: 'border-amber-200 bg-amber-50/70',
    iconClass: 'text-amber-600',
    badge: 'bg-amber-100 text-amber-700',
  },
  info: {
    label: 'Notice',
    icon: Info,
    container: 'border-gray-200 bg-gray-50',
    iconClass: 'text-gray-500',
    badge: 'bg-gray-200 text-gray-700',
  },
} as const;

const changeLabels: Array<[keyof ScheduleReviewChangeCounts, string]> = [
  ['retimed', 'Retimed'],
  ['added', 'Added'],
  ['removed', 'Removed'],
  ['blockChanged', 'Block changed'],
];

const formatSource = (label: string, version?: string | number): string =>
  version === undefined || version === '' ? label : `${label} · v${version}`;

export const ScheduleReviewPanel: React.FC<ScheduleReviewPanelProps> = ({
  isOpen,
  onClose,
  sourceMasterLabel,
  sourceMasterVersion,
  baselineTripCount,
  changeCounts,
  changes = [],
  issues,
  onJumpToRow,
  onNextChange,
  showChangedOnly = false,
  onShowChangedOnlyChange,
  publishNote,
  onPublishNoteChange,
  isStale = false,
  staleMessage = 'A newer master schedule is available. Refresh the comparison before publishing.',
  onCreateCheckpoint,
  checkpointDisabled = false,
  checkpoints = [],
  onRestoreCheckpoint,
  onReadyForReview,
  readyForReviewDisabled = false,
  onPublish,
  publishDisabled = false,
  isWorking = false,
}) => {
  if (!isOpen) return null;

  const totalChanges = Object.values(changeCounts).reduce((sum, count) => sum + count, 0);
  const sortedIssues = issues
    .map((issue, originalIndex) => ({ issue, originalIndex }))
    .sort((a, b) => severityRank[a.issue.severity] - severityRank[b.issue.severity] || a.originalIndex - b.originalIndex)
    .map(({ issue }) => issue);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="schedule-review-title"
      className="flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl"
    >
      <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-gray-900">
            <GitCompareArrows aria-hidden="true" size={18} />
            <h2 id="schedule-review-title" className="text-base font-semibold">Review changes</h2>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Compared with {formatSource(sourceMasterLabel, sourceMasterVersion)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close review changes"
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {isStale && (
          <div role="alert" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-amber-900">
            <Clock3 aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600" size={17} />
            <div>
              <p className="text-sm font-semibold">Source master has changed</p>
              <p className="mt-0.5 text-xs leading-5">{staleMessage}</p>
            </div>
          </div>
        )}

        <section aria-labelledby="schedule-review-summary">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 id="schedule-review-summary" className="text-sm font-semibold text-gray-900">Changes</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {totalChanges} change{totalChanges === 1 ? '' : 's'}
                {baselineTripCount === undefined ? '' : ` across ${baselineTripCount} baseline trips`}
              </p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {changeLabels.map(([key, label]) => (
              <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{changeCounts[key]}</dd>
              </div>
            ))}
          </dl>
          {totalChanges > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {onNextChange && (
                <button
                  type="button"
                  onClick={onNextChange}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Next change
                </button>
              )}
              {onShowChangedOnlyChange && (
                <button
                  type="button"
                  aria-pressed={showChangedOnly}
                  onClick={() => onShowChangedOnlyChange(!showChangedOnly)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${showChangedOnly ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Changed rows only
                </button>
              )}
            </div>
          )}
          {changes.length > 0 && (
            <ol className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-gray-100 pt-2">
              {changes.map(change => (
                <li key={change.id}>
                  <button
                    type="button"
                    onClick={() => change.rowId && onJumpToRow?.(change.rowId)}
                    disabled={!change.rowId || !onJumpToRow}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-default disabled:opacity-60"
                  >
                    <span className="truncate font-medium">{change.title}</span>
                    {change.rowLabel && <span className="shrink-0 text-gray-500">{change.rowLabel}</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="schedule-review-issues">
          <div className="flex items-center justify-between gap-3">
            <h3 id="schedule-review-issues" className="text-sm font-semibold text-gray-900">Issues</h3>
            <span className="text-xs font-medium text-gray-500">{issues.length}</span>
          </div>

          {sortedIssues.length === 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              <CheckCircle2 aria-hidden="true" size={17} />
              No operational issues found
            </div>
          ) : (
            <ol className="mt-3 space-y-2">
              {sortedIssues.map(issue => {
                const presentation = severityPresentation[issue.severity];
                const Icon = presentation.icon;
                const canJump = Boolean(issue.rowId && onJumpToRow);
                return (
                  <li key={issue.id} data-severity={issue.severity} className={`rounded-lg border p-3 ${presentation.container}`}>
                    <div className="flex items-start gap-2.5">
                      <Icon aria-hidden="true" className={`mt-0.5 shrink-0 ${presentation.iconClass}`} size={16} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${presentation.badge}`}>
                            {presentation.label}
                          </span>
                          {issue.rowLabel && <span className="text-xs font-medium text-gray-600">{issue.rowLabel}</span>}
                        </div>
                        <p className="mt-1.5 text-sm font-semibold text-gray-900">{issue.title}</p>
                        {issue.detail && <p className="mt-0.5 text-xs leading-5 text-gray-600">{issue.detail}</p>}
                        {canJump && (
                          <button
                            type="button"
                            onClick={() => onJumpToRow?.(issue.rowId as string)}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 focus:outline-none focus:underline"
                          >
                            Jump to row <ArrowRight aria-hidden="true" size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {onCreateCheckpoint && (
          <section className="rounded-lg border border-gray-200 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <History aria-hidden="true" className="shrink-0 text-gray-500" size={17} />
                <div>
                  <p className="text-sm font-medium text-gray-900">Save a checkpoint</p>
                  <p className="text-xs text-gray-500">Keep a named recovery point before publishing.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCreateCheckpoint}
                disabled={checkpointDisabled || isWorking}
                className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create
              </button>
            </div>
            {checkpoints.length > 0 && (
              <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
                {checkpoints.map(checkpoint => (
                  <li key={checkpoint.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-gray-800">{checkpoint.name}</p>
                      <p className="text-[11px] text-gray-500">{checkpoint.createdAtLabel}</p>
                    </div>
                    {onRestoreCheckpoint && (
                      <button
                        type="button"
                        onClick={() => onRestoreCheckpoint(checkpoint.id)}
                        disabled={isWorking}
                        className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby="schedule-review-note">
          <label id="schedule-review-note" htmlFor="schedule-review-publish-note" className="text-sm font-semibold text-gray-900">
            Publish note
          </label>
          <p className="mt-0.5 text-xs text-gray-500">Briefly describe the reason for these changes.</p>
          <textarea
            id="schedule-review-publish-note"
            value={publishNote}
            onChange={event => onPublishNoteChange(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Example: Adjusted PM peak running times"
            className="mt-2 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <div className="mt-1 text-right text-[11px] tabular-nums text-gray-500">{publishNote.length}/500</div>
        </section>
      </div>

      <footer className="flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4">
        {onReadyForReview && (
          <button
            type="button"
            onClick={onReadyForReview}
            disabled={readyForReviewDisabled || isWorking}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ready for review
          </button>
        )}
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishDisabled || isWorking}
            className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWorking ? 'Working…' : 'Publish new version'}
          </button>
        )}
      </footer>
    </aside>
  );
};
