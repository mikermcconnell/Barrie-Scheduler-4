import type { CellOutcome } from '../../utils/regional-transit/connectionCompare';
import type { ConnectionCell } from '../../utils/regional-transit/types';

/** Band names used across the connection page, ranked Comfortable > Long wait > Tight > No connection. */
export const BAND_NAMES: Record<ConnectionCell['status'], string> = {
    comfortable: 'Comfortable', long: 'Long wait', tight: 'Tight', 'no-connection': 'No connection', unavailable: 'No connection',
};
export const BAND_RANGES: Partial<Record<ConnectionCell['status'], string>> = { comfortable: '6–15 min', long: '16–30 min', tight: '1–5 min' };
export const LEGEND_BANDS = ['comfortable', 'long', 'tight', 'no-connection'] as const;

export function bandLabel(status: ConnectionCell['status']): string {
    return BAND_RANGES[status] ? `${BAND_NAMES[status]} · ${BAND_RANGES[status]}` : BAND_NAMES[status];
}

export const OUTCOME_LABELS: Record<CellOutcome, string> = {
    better: 'Better', worse: 'Worse', gained: 'Gained', lost: 'Lost', changed: 'Wait changed',
    unchanged: 'Unchanged', none: 'No connection', unassessed: 'Not assessed',
};
export const OUTCOME_MARKS: Partial<Record<CellOutcome, string>> = { better: '▲', worse: '▼', gained: '+', lost: '×' };
export const SUMMARY_OUTCOMES = ['better', 'worse', 'gained', 'lost', 'changed', 'unchanged'] as const satisfies readonly CellOutcome[];
