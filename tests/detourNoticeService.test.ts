import { describe, expect, it } from 'vitest';
import { createDetourNotice } from '../utils/detours/detourFactory';
import {
    duplicateDetourNotice,
    markDetourPosted,
    saveDetourNotice,
    type DetourNoticePersistenceAdapter,
    type MarkDetourPostedInput,
    type SaveDetourNoticeInput,
} from '../utils/detours/detourNoticeService';
import type { DetourNotice, DetourNoticeSummary } from '../utils/detours/detourTypes';

class MemoryAdapter implements DetourNoticePersistenceAdapter {
    records = new Map<string, DetourNotice>();
    next = 1;
    createId(): string { return `notice-${this.next++}`; }
    async save(input: SaveDetourNoticeInput): Promise<DetourNotice> {
        const actual = this.records.get(input.notice.id)?.revision ?? 0;
        if (actual !== input.expectedRevision) throw new Error('conflict');
        const saved = { ...input.notice, revision: actual + 1 };
        this.records.set(saved.id, saved);
        return saved;
    }
    async load(_teamId: string, noticeId: string): Promise<DetourNotice | null> { return this.records.get(noticeId) ?? null; }
    async list(): Promise<DetourNoticeSummary[]> { return []; }
    async delete(_teamId: string, noticeId: string): Promise<void> { this.records.delete(noticeId); }
    async markPosted(_input: MarkDetourPostedInput): Promise<DetourNotice> { throw new Error('not needed'); }
}

describe('detour notice service', () => {
    it('allocates an ID and advances the expected revision', async () => {
        const adapter = new MemoryAdapter();
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        const saved = await saveDetourNotice({ notice, userId: 'user-a', expectedRevision: 0 }, adapter);
        expect(saved).toMatchObject({ id: 'notice-1', revision: 1 });
    });

    it('duplicates content as an unpublished independent draft', async () => {
        const adapter = new MemoryAdapter();
        const original = createDetourNotice({ id: 'notice-original', teamId: 'team-a', userId: 'user-a' });
        original.title = 'Livingstone Detour';
        original.revision = 4;
        original.status = 'posted';
        adapter.records.set(original.id, original);
        const copy = await duplicateDetourNotice('team-a', original.id, 'user-b', adapter);
        expect(copy).toMatchObject({ id: 'notice-1', title: 'Livingstone Detour (Copy)', status: 'draft', revision: 1 });
        expect(copy.publications).toEqual([]);
    });

    it('rejects non-MyRide and insecure publication URLs before persistence', async () => {
        const adapter = new MemoryAdapter();
        const base = {
            teamId: 'team-a',
            noticeId: 'notice-1',
            userId: 'user-a',
            expectedRevision: 1,
            filenames: { pdf: 'notice.pdf', png: 'notice.png' },
        };
        expect(() => markDetourPosted({ ...base, myRideUrl: 'http://www.myridebarrie.ca/News/1' }, adapter))
            .toThrow('MyRide URL is invalid');
        expect(() => markDetourPosted({ ...base, myRideUrl: 'https://example.com/News/1' }, adapter))
            .toThrow('MyRide URL is invalid');
    });
});
