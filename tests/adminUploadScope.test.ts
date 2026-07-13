import { describe, expect, it } from 'vitest';
import { filterUploadsForTeam } from '../utils/adminUploadScope';
import type { SavedFile } from '../utils/services/dataService';

const file = (id: string, resolvedTeamId?: string): SavedFile => ({
    id,
    name: `${id}.csv`,
    type: 'other',
    storagePath: `users/user/files/${id}.csv`,
    downloadUrl: 'https://example.invalid/file',
    size: 10,
    uploadedAt: new Date('2026-07-09T12:00:00Z'),
    resolvedTeamId,
});

describe('admin upload team scope', () => {
    const uploads = [file('a', 'team-a'), file('b', 'team-b'), file('legacy')];

    it('uses resolved upload attribution instead of current member lists', () => {
        expect(filterUploadsForTeam(uploads, 'team-a').map(upload => upload.id)).toEqual(['a']);
    });

    it('returns no uploads when an active team is missing or empty', () => {
        expect(filterUploadsForTeam(uploads)).toEqual([]);
        expect(filterUploadsForTeam(uploads, 'empty-team')).toEqual([]);
    });
});
