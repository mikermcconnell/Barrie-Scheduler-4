import { findConnection } from './connectionAnalysis';
import type { ConnectionCell, ConnectionDirection, GoTrainEvent, LocalConnectionRow, RegionalGoFeed } from './types';

/** Two GO timetables to compare against the same published bus schedules. */
export interface GoTimetableComparison {
    source: 'demo' | 'saved';
    before: RegionalGoFeed;
    after: RegionalGoFeed;
    beforeLabel: string;
    afterLabel: string;
    summary: string[];
}

export type ColumnChange = 'same' | 'moved' | 'added' | 'removed';
/** Rider outcome for one route × train cell. Bands rank Comfortable > Long wait > Tight > No connection. */
export type CellOutcome = 'gained' | 'lost' | 'better' | 'worse' | 'changed' | 'unchanged' | 'none' | 'unassessed';

export interface CompareColumn {
    id: string;
    direction: ConnectionDirection;
    trainNumber: string;
    headsign: string;
    before?: GoTrainEvent;
    after?: GoTrainEvent;
    change: ColumnChange;
    /** After minus before train time. */
    shiftMinutes?: number;
}

export interface CompareCell {
    before: ConnectionCell | null;
    after: ConnectionCell | null;
    outcome: CellOutcome;
    /** After minus before rider wait, when both sides connect. */
    waitDelta?: number;
    /** Both sides connect, but through a different bus trip. */
    busChanged: boolean;
}

export interface ConnectionComparison {
    direction: ConnectionDirection;
    columns: CompareColumn[];
    rows: { row: LocalConnectionRow; cells: CompareCell[] }[];
    counts: Record<CellOutcome, number>;
}

const BAND_RANK: Partial<Record<ConnectionCell['status'], number>> = { comfortable: 3, long: 2, tight: 1 };
const SHIFT_THRESHOLD_MINUTES = 0.5;
export const CHANGED_OUTCOMES: CellOutcome[] = ['gained', 'lost', 'better', 'worse', 'changed'];

export function isConnected(cell: ConnectionCell | null | undefined): cell is ConnectionCell & { gapMinutes: number } {
    return Boolean(cell && BAND_RANK[cell.status] && cell.gapMinutes !== undefined);
}

function trainKey(event: GoTrainEvent): string {
    return `${event.direction}|${event.trainNumber || event.tripId}`;
}

/** Pairs before and after trains by train number; repeated numbers pair in time order. */
export function matchTrainColumns(before: GoTrainEvent[], after: GoTrainEvent[]): CompareColumn[] {
    const group = (events: GoTrainEvent[]) => {
        const groups = new Map<string, GoTrainEvent[]>();
        for (const event of [...events].sort((a, b) => a.minutes - b.minutes)) groups.set(trainKey(event), [...(groups.get(trainKey(event)) ?? []), event]);
        return groups;
    };
    const beforeGroups = group(before);
    const afterGroups = group(after);
    const columns: CompareColumn[] = [];
    for (const key of new Set([...beforeGroups.keys(), ...afterGroups.keys()])) {
        const olds = beforeGroups.get(key) ?? [];
        const news = afterGroups.get(key) ?? [];
        for (let index = 0; index < Math.max(olds.length, news.length); index++) {
            const old = olds[index];
            const next = news[index];
            const reference = next ?? old;
            const shiftMinutes = old && next ? next.minutes - old.minutes : undefined;
            columns.push({
                id: `${key}|${index}`, direction: reference.direction, trainNumber: reference.trainNumber, headsign: reference.headsign, before: old, after: next,
                change: !old ? 'added' : !next ? 'removed' : Math.abs(shiftMinutes!) >= SHIFT_THRESHOLD_MINUTES ? 'moved' : 'same',
                shiftMinutes,
            });
        }
    }
    return columns.sort((a, b) => (a.after ?? a.before)!.minutes - (b.after ?? b.before)!.minutes || a.id.localeCompare(b.id));
}

export function compareCell(before: ConnectionCell | null, after: ConnectionCell | null): CompareCell {
    const busChanged = isConnected(before) && isConnected(after) && before.tripId !== after.tripId;
    if (before?.status === 'unavailable' || after?.status === 'unavailable') return { before, after, outcome: 'unassessed', busChanged: false };
    if (!isConnected(before)) return { before, after, outcome: isConnected(after) ? 'gained' : 'none', busChanged };
    if (!isConnected(after)) return { before, after, outcome: 'lost', busChanged };
    const waitDelta = after.gapMinutes - before.gapMinutes;
    const rankDelta = BAND_RANK[after.status]! - BAND_RANK[before.status]!;
    const outcome: CellOutcome = rankDelta > 0 ? 'better' : rankDelta < 0 ? 'worse' : waitDelta !== 0 || busChanged ? 'changed' : 'unchanged';
    return { before, after, outcome, waitDelta, busChanged };
}

/** Assesses every bus row against the before and after trains of one direction. */
export function compareConnections(rows: LocalConnectionRow[], beforeEvents: GoTrainEvent[], afterEvents: GoTrainEvent[], direction: ConnectionDirection): ConnectionComparison {
    const columns = matchTrainColumns(beforeEvents.filter(event => event.direction === direction), afterEvents.filter(event => event.direction === direction));
    const counts: Record<CellOutcome, number> = { gained: 0, lost: 0, better: 0, worse: 0, changed: 0, unchanged: 0, none: 0, unassessed: 0 };
    const compared = rows.map(row => ({
        row,
        cells: columns.map(column => {
            const cell = compareCell(column.before ? findConnection(row, column.before) : null, column.after ? findConnection(row, column.after) : null);
            counts[cell.outcome]++;
            return cell;
        }),
    }));
    return { direction, columns, rows: compared, counts };
}

/** Header tags for the plain Before or After grid, keyed by GO trip ID. */
export function columnTags(columns: CompareColumn[], side: 'before' | 'after'): Map<string, string> {
    const tags = new Map<string, string>();
    for (const column of columns) {
        const event = side === 'before' ? column.before : column.after;
        if (!event || column.change === 'same') continue;
        tags.set(event.tripId, column.change === 'moved' ? `${side === 'before' ? 'Moves' : 'Moved'} ${signed(column.shiftMinutes!)}`
            : column.change === 'added' ? 'New' : 'Cancelled');
    }
    return tags;
}

export function signed(minutes: number): string {
    const rounded = Math.round(minutes);
    return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : '0';
}
