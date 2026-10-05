import React, { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { diffGoFeeds, type GoFeedDiff, type TrainChange } from '../../utils/regional-transit/feedDiff';
import type { GtfsArchiveStatus, GtfsSnapshotSummary } from '../../utils/services/gtfsArchiveService';

const STATION_NAMES = { allandale: 'Allandale Waterfront', south: 'Barrie South' } as const;
const KIND_LABELS: Record<TrainChange['kind'], string> = { added: 'Added', removed: 'Removed', shifted: 'Moved' };

function clock(minutes?: number): string {
    if (minutes === undefined) return '';
    const whole = Math.round(minutes);
    const day = Math.floor(whole / 1440);
    const within = whole - day * 1440;
    const hours = Math.floor(within / 60);
    return `${hours % 12 || 12}:${String(within % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}${day > 0 ? ' +1 day' : ''}`;
}

function gtfsDate(value: string | null): string {
    return value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : 'unknown';
}

function snapshotLabel(snapshot: GtfsSnapshotSummary): string {
    return `Saved ${snapshot.fetchedAt.slice(0, 10)} · valid ${gtfsDate(snapshot.feedStartDate)} to ${gtfsDate(snapshot.feedEndDate)}`;
}

function message(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'Something went wrong.';
}

export const GoScheduleChanges: React.FC = () => {
    const [opened, setOpened] = useState(false);
    const [archive, setArchive] = useState<GtfsArchiveStatus | null>(null);
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const [beforeId, setBeforeId] = useState('');
    const [afterId, setAfterId] = useState('');
    const [diff, setDiff] = useState<GoFeedDiff | null>(null);
    const [diffError, setDiffError] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);

    useEffect(() => {
        if (!opened) return;
        let cancelled = false;
        (async () => {
            try {
                const { listGtfsSnapshots } = await import('../../utils/services/gtfsArchiveService');
                const status = await listGtfsSnapshots('go');
                if (cancelled) return;
                setArchive(status);
                setAfterId(status.snapshots[0]?.snapshotId ?? '');
                setBeforeId(status.snapshots[1]?.snapshotId ?? '');
            } catch (error) {
                if (!cancelled) setArchiveError(message(error));
            }
        })();
        return () => { cancelled = true; };
    }, [opened]);

    const compare = useCallback(async (before: GtfsSnapshotSummary, after: GtfsSnapshotSummary, isCurrent: () => boolean) => {
        setDiffLoading(true);
        setDiffError(null);
        try {
            const { loadGoStationSnapshot } = await import('../../utils/services/gtfsArchiveService');
            const [beforeFeed, afterFeed] = await Promise.all([loadGoStationSnapshot(before), loadGoStationSnapshot(after)]);
            if (isCurrent()) setDiff(diffGoFeeds(beforeFeed, afterFeed));
        } catch (error) {
            if (isCurrent()) { setDiff(null); setDiffError(message(error)); }
        } finally {
            if (isCurrent()) setDiffLoading(false);
        }
    }, []);

    useEffect(() => {
        const before = archive?.snapshots.find(item => item.snapshotId === beforeId);
        const after = archive?.snapshots.find(item => item.snapshotId === afterId);
        if (!before || !after || before.snapshotId === after.snapshotId) { setDiff(null); return; }
        let current = true;
        void compare(before, after, () => current);
        return () => { current = false; };
    }, [archive, beforeId, afterId, compare]);

    const snapshots = archive?.snapshots ?? [];
    const options = snapshots.map(item => <option key={item.snapshotId} value={item.snapshotId}>{snapshotLabel(item)}</option>);

    return <details className="regional-go-notes regional-go-changes" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
        <summary><History size={15} aria-hidden="true" /> GO schedule changes</summary>
        <div>
            {archiveError && <p className="regional-go-error" role="alert">Saved GO schedules could not be loaded. {archiveError}</p>}
            {opened && !archive && !archiveError && <p className="regional-go-empty" role="status">Loading saved GO schedules…</p>}
            {archive && snapshots.length === 0 && <p>No GO schedules have been saved yet. The first one is saved by the daily check.</p>}
            {archive && snapshots.length === 1 && <p>One GO schedule is saved so far ({snapshotLabel(snapshots[0])}). Changes will show here after Metrolinx publishes a new schedule.</p>}
            {snapshots.length > 1 && <>
                <div className="regional-go-changes-pickers">
                    <label>Older<select value={beforeId} onChange={event => setBeforeId(event.target.value)}>{options}</select></label>
                    <label>Newer<select value={afterId} onChange={event => setAfterId(event.target.value)}>{options}</select></label>
                </div>
                {beforeId === afterId && <p>Choose two different saved schedules to compare.</p>}
                {diffLoading && <p className="regional-go-empty" role="status">Comparing…</p>}
                {diffError && <p className="regional-go-error" role="alert">Comparison failed. {diffError}</p>}
                {diff && !diffLoading && <>
                    <p>{diff.comparisons.filter(item => item.beforeDate || item.afterDate).map(item => `${item.dayType}: ${item.beforeDate ?? 'no service'} vs ${item.afterDate ?? 'no service'}`).join(' · ')}. One normal service day per day type; trains are matched by train number.</p>
                    {diff.comparisons.flatMap(item => item.issues).map(issue => <p className="regional-go-notice" key={issue}>{issue}</p>)}
                    {diff.changes.length === 0
                        ? <p>No changes at Allandale Waterfront or Barrie South. {diff.comparisons.reduce((sum, item) => sum + item.unchanged, 0)} train calls are the same.</p>
                        : <table className="regional-go-changes-table">
                            <thead><tr><th>Day</th><th>Station</th><th>Direction</th><th>Train</th><th>Change</th><th>Time</th></tr></thead>
                            <tbody>{diff.changes.map((change, index) => <tr key={`${change.dayType}-${change.station}-${change.direction}-${change.trainNumber}-${change.kind}-${index}`}>
                                <td>{change.dayType}</td>
                                <td>{STATION_NAMES[change.station]}</td>
                                <td>{change.direction === 'to-go' ? 'To GO' : 'From GO'}</td>
                                <td>{change.trainNumber || '—'}{change.headsign ? ` · ${change.headsign}` : ''}</td>
                                <td>{KIND_LABELS[change.kind]}</td>
                                <td>{change.kind === 'shifted' ? `${clock(change.beforeMinutes)} → ${clock(change.afterMinutes)}` : clock(change.afterMinutes ?? change.beforeMinutes)}</td>
                            </tr>)}</tbody>
                        </table>}
                </>}
            </>}
            {archive?.lastCheckedAt && <p className="regional-go-source-note">Last checked for a new GO schedule {new Date(archive.lastCheckedAt).toLocaleString()}.</p>}
        </div>
    </details>;
};

export default GoScheduleChanges;
