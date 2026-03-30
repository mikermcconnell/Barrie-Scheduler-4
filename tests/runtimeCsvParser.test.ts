import { describe, expect, it } from 'vitest';
import { parseRuntimeCSV } from '../components/NewSchedule/utils/csvParser';

describe('parseRuntimeCSV', () => {
    it('treats attached 2A/2B suffixes as North/South for suffix-direction routes', async () => {
        const file = {
            text: async () => [
                'Title,Park Place to Downtown',
                'Half-Hour,06:00 - 06:29',
                '2A Observed Runtime-50%,10',
                '2A Observed Runtime-80%,12',
            ].join('\n'),
        } as File;

        const result = await parseRuntimeCSV(file);

        expect(result.detectedRouteNumber).toBe('2');
        expect(result.detectedDirection).toBe('North');
    });

    it('keeps attached 8A/8B suffixes as separate A/B variant directions', async () => {
        const file = {
            text: async () => [
                'Title,Stop A to Stop B',
                'Half-Hour,06:00 - 06:29',
                '8A Observed Runtime-50%,14',
                '8A Observed Runtime-80%,17',
            ].join('\n'),
        } as File;

        const result = await parseRuntimeCSV(file);

        expect(result.detectedRouteNumber).toBe('8');
        expect(result.detectedDirection).toBe('A');
    });
});
