import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoScheduleChanges } from '../components/connections/GoScheduleChanges';
import { diffGoFeeds } from '../utils/regional-transit/feedDiff';
import { listGtfsSnapshots, loadGoStationSnapshot } from '../utils/services/gtfsArchiveService';

vi.mock('../utils/services/gtfsArchiveService', () => ({ listGtfsSnapshots: vi.fn(), loadGoStationSnapshot: vi.fn() }));
vi.mock('../utils/regional-transit/feedDiff', () => ({ diffGoFeeds: vi.fn() }));

const snap = (snapshotId: string, fetchedAt: string) => ({
    feedId: 'go' as const, snapshotId, fetchedAt, feedVersion: null as string | null,
    feedStartDate: '20260929', feedEndDate: '20261127', bytes: 1, reducedPath: `p/${snapshotId}.json`,
});

let host: HTMLDivElement;
let root: Root;

async function open() {
    await act(async () => { root.render(<GoScheduleChanges />); });
    const details = host.querySelector('details') as HTMLDetailsElement;
    await act(async () => {
        details.open = true;
        details.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
}

describe('GoScheduleChanges', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.resetAllMocks();
    });

    it('explains that more snapshots are needed when only one is saved', async () => {
        vi.mocked(listGtfsSnapshots).mockResolvedValue({ lastCheckedAt: null, snapshots: [snap('a', '2026-10-05T10:00:00Z')] });
        await open();
        expect(host.textContent).toContain('One GO schedule is saved so far');
        expect(loadGoStationSnapshot).not.toHaveBeenCalled();
    });

    it('lists changes between the two newest snapshots', async () => {
        vi.mocked(listGtfsSnapshots).mockResolvedValue({
            lastCheckedAt: '2026-10-06T08:30:00Z',
            snapshots: [snap('new', '2026-12-01T10:00:00Z'), snap('old', '2026-10-05T10:00:00Z')],
        });
        vi.mocked(loadGoStationSnapshot).mockResolvedValue({} as never);
        vi.mocked(diffGoFeeds).mockReturnValue({
            comparisons: [{ dayType: 'Weekday', beforeDate: '2026-09-30', afterDate: '2026-12-02', unchanged: 30, issues: [] }],
            changes: [{ station: 'allandale', direction: 'to-go', dayType: 'Weekday', kind: 'shifted', trainNumber: '1234', headsign: 'Union', beforeMinutes: 365, afterMinutes: 372 }],
        } as never);
        await open();
        expect(host.textContent).toContain('Allandale Waterfront');
        expect(host.textContent).toContain('Moved');
        expect(host.textContent).toContain('6:05 AM → 6:12 AM');
    });

    it('shows an error when the saved schedules cannot be loaded', async () => {
        vi.mocked(listGtfsSnapshots).mockRejectedValue(new Error('Missing permissions'));
        await open();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('Missing permissions');
    });
});
