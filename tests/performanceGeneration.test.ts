import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPerformanceGenerationId } from '../functions/src/index';
import { performanceGenerationFilePattern } from '../utils/performanceGeneration';
import { isRidershipTrendStoragePath } from '../utils/ridership-trends/model';

const TEAM = 'team-1';
const TREND_PREFIX = `teams/${TEAM}/performanceViews/ridership-trends/`;

describe('performance storage generations', () => {
    // Regression: Oct 2026 imports failed for days because the server wrote
    // `{ms}-{uuid}.json` while every reader accepted only `{ms}.json`.
    it('accepts the generation names the server import writes', () => {
        const serverGeneration = buildPerformanceGenerationId();
        expect(isRidershipTrendStoragePath(`${TREND_PREFIX}${serverGeneration}.json`, TEAM)).toBe(true);
        expect(performanceGenerationFilePattern('-\\d{4}-\\d{2}').test(`${serverGeneration}-2026-10.json`)).toBe(true);
        expect(performanceGenerationFilePattern('-overview-2026-10').test(`${serverGeneration}-overview-2026-10.json`)).toBe(true);
    });

    it('still accepts browser and bootstrap generations', () => {
        expect(isRidershipTrendStoragePath(`${TREND_PREFIX}1791963710000.json`, TEAM)).toBe(true);
    });

    it('rejects other teams, traversal and arbitrary names', () => {
        expect(isRidershipTrendStoragePath(`teams/other/performanceViews/ridership-trends/123.json`, TEAM)).toBe(false);
        expect(isRidershipTrendStoragePath(`${TREND_PREFIX}../secret.json`, TEAM)).toBe(false);
        expect(isRidershipTrendStoragePath(`${TREND_PREFIX}123-not-a-uuid.json`, TEAM)).toBe(false);
        expect(isRidershipTrendStoragePath(`${TREND_PREFIX}abc.json`, TEAM)).toBe(false);
    });

    it('lets Storage rules serve server-written Ridership Trends files', () => {
        const rules = readFileSync('storage.rules', 'utf8');
        const block = /ridership-trends\/\{generation\} \{[\s\S]*?\n {4}\}/.exec(rules)?.[0] ?? '';
        const patterns = [...block.matchAll(/generation[.]matches\('([^']+)'\)/g)].map(match => new RegExp(match[1]));
        expect(patterns).toHaveLength(2);
        for (const pattern of patterns) {
            expect(pattern.test(`${buildPerformanceGenerationId()}.json`)).toBe(true);
            expect(pattern.test('1791963710000.json')).toBe(true);
        }
    });
});
