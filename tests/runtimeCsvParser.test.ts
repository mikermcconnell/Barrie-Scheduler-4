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

    it('leaves sample count mode unset because uploaded runtime CSVs do not provide raw sample counts', async () => {
        const file = {
            text: async () => [
                'Title,Stop A to Stop B',
                'Half-Hour,06:00 - 06:29',
                '10 Observed Runtime-50%,14',
                '10 Observed Runtime-80%,17',
            ].join('\n'),
        } as File;

        const result = await parseRuntimeCSV(file);

        expect(result.sampleCountMode).toBeUndefined();
        expect(result.segments[0].timeBuckets['06:00 - 06:29'].n).toBe(0);
    });

    it('accepts an explicit positive-integer observation count row', async () => {
        const file = {
            text: async () => [
                'Title,Stop A to Stop B',
                'Half-Hour,06:00 - 06:29',
                '10 Observed Runtime-50%,14',
                '10 Observed Runtime-80%,17',
                '10 Observed Runtime-Count,12',
            ].join('\n'),
        } as File;

        const result = await parseRuntimeCSV(file);

        expect(result.sampleCountMode).toBe('observations');
        expect(result.segments[0].timeBuckets['06:00 - 06:29'].n).toBe(12);
    });

    it('parses BOM-prefixed CRLF exports with quoted commas and escaped quotes', async () => {
        const file = {
            text: async () => [
                '\ufeffTitle,"Barrie, Terminal to ""Main"" Stop"',
                'Half-Hour,"06:00 - 06:29"',
                '10 Observed Runtime-50%,"14.5"',
                '10 Observed Runtime-80%,"17.25"',
                '10 Observed Runtime-Count,"12"',
            ].join('\r\n'),
        } as File;

        const result = await parseRuntimeCSV(file);

        expect(result.detectedRouteNumber).toBe('10');
        expect(result.detectedDirection).toBe('Loop');
        expect(result.segments[0].segmentName).toBe('Barrie, Terminal to "Main" Stop');
        expect(result.segments[0].timeBuckets['06:00 - 06:29']).toEqual({
            p50: 14.5,
            p80: 17.25,
            n: 12,
        });
    });

    it('rejects an unterminated quoted field', async () => {
        const file = {
            text: async () => 'Title,"A to B\nHalf-Hour,06:00 - 06:29',
        } as File;

        await expect(parseRuntimeCSV(file)).rejects.toThrow('Unclosed quoted field');
    });
});
