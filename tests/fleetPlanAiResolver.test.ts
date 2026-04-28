import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleFleetPlanAiResolver } from '../api/fleet-plan-ai-resolver';
import { buildFleetPlanResolutionSuggestions } from '../utils/fleet-plan/fleetPlanIssueResolver';
import { validateFleetPlanWorkbook } from '../utils/fleet-plan/fleetPlanValidation';
import type { FleetPlanRow, FleetPlanWorkbook } from '../utils/fleet-plan/types';

function row(overrides: Partial<FleetPlanRow>): FleetPlanRow {
    return {
        id: 'row-1',
        unitNumber: '3001',
        makeModel: 'Bus',
        year: '2020',
        timeline: { '2025': '3001', '2026': 'RETIRE' },
        ...overrides,
    };
}

function workbook(rows: FleetPlanRow[]): FleetPlanWorkbook {
    return {
        schemaVersion: 1,
        metadata: {
            templateVersion: '2026-04-08-fleet-plan-v1',
            sourceFileName: 'Fleet_Plan.xlsx',
            importedAt: '2026-04-21T10:00:00.000Z',
            importedBy: 'user-1',
            updatedAt: '2026-04-21T10:00:00.000Z',
            updatedBy: 'user-1',
        },
        sheets: [{ key: 'diesel-12m', name: '12m Buses', title: '12m Diesel Buses', rows }],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('fleetPlanAiResolver API', () => {
    it('calls local Gemma 4 and only returns suggestions for allowed deterministic IDs', async () => {
        vi.stubEnv('LOCAL_AI_ENABLED', 'true');
        vi.stubEnv('LOCAL_AI_PROVIDER', 'ollama');
        vi.stubEnv('LOCAL_AI_MODEL', 'gemma4');

        const data = workbook([
            row({ id: 'first', unitNumber: '3001' }),
            row({ id: 'duplicate', unitNumber: '3001' }),
        ]);
        const validation = validateFleetPlanWorkbook(data, 2026);
        const deterministicSuggestions = buildFleetPlanResolutionSuggestions(data, validation);
        const allowedId = deterministicSuggestions[0]?.id;
        expect(allowedId).toBeTruthy();

        const fetchMock = vi.fn(async (url: string | URL) => {
            const urlText = String(url);
            if (urlText.endsWith('/api/tags')) {
                return new Response(JSON.stringify({ models: [{ name: 'gemma4' }] }), { status: 200 });
            }

            if (urlText.endsWith('/api/generate')) {
                return new Response(JSON.stringify({
                    response: JSON.stringify({
                        summary: 'Review complete.',
                        suggestions: [
                            {
                                deterministicSuggestionId: allowedId,
                                suggestedValue: '3002',
                                suggestion: 'Use 3002 for the duplicate unit.',
                                rationale: '3002 is the next safe available number in this test fleet.',
                                confidence: 'high',
                            },
                            {
                                deterministicSuggestionId: 'not-allowed',
                                suggestedValue: '9999',
                                suggestion: 'This should be dropped.',
                                rationale: 'Not allowed.',
                                confidence: 'high',
                            },
                        ],
                        cautions: [],
                    }),
                }), { status: 200 });
            }

            return new Response('', { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);

        const response = await handleFleetPlanAiResolver({
            workbook: data,
            validation,
            deterministicSuggestions,
            currentYear: 2026,
        });

        expect(response.model.modelName).toBe('gemma4');
        expect(response.suggestions).toHaveLength(1);
        expect(response.suggestions[0]?.deterministicSuggestionId).toBe(allowedId);
        expect(response.suggestions[0]?.suggestedValue).toBe('3002');
    });
});
