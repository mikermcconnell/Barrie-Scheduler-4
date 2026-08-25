import { describe, expect, it } from 'vitest';
import { buildStrategicFleetPlanEvidence } from '../utils/strategic-plan/fleetPlanEvidence';
import type { FleetPlanWorkbook } from '../utils/fleet-plan/types';

const workbook: FleetPlanWorkbook = {
    schemaVersion: 1,
    metadata: {
        templateVersion: 'test-v1',
        sourceFileName: 'Fleet Plan.xlsx',
        importedAt: '2026-08-01T12:00:00.000Z',
        importedBy: 'planner-a',
        updatedAt: '2026-08-25T12:00:00.000Z',
        updatedBy: 'planner-b',
        currentVersion: 4,
        storagePath: 'teams/team-a/fleetPlan/v4.json',
    },
    sheets: [
        {
            key: 'diesel-12m',
            name: '12m Buses',
            title: '12m Diesel Buses',
            rows: [
                {
                    id: 'bus-1',
                    unitNumber: '2201',
                    makeModel: 'Nova LFS',
                    year: '2022',
                    timeline: { '2027': '2201', '2028': 'RETIRE', '2029': '' },
                },
                {
                    id: 'bus-2',
                    unitNumber: 'Future',
                    makeModel: 'Replacement bus',
                    year: '',
                    timeline: { '2027': 'PURCHASE', '2028': '2301', '2029': '2301' },
                },
            ],
        },
        {
            key: 'electric-12m',
            name: '12m Electric Buses',
            title: 'Electric 40 Foot Buses',
            rows: [{
                id: 'growth-1',
                unitNumber: 'Growth 1',
                makeModel: 'Electric growth bus',
                year: '',
                timeline: { '2027': 'GROWTH', '2028': '2401-E', '2029': '2401-E' },
            }],
        },
    ],
};

describe('Strategic Plan Fleet evidence', () => {
    it('derives the 2027–2032 view from the canonical workbook without changing it', () => {
        const original = JSON.stringify(workbook);
        const evidence = buildStrategicFleetPlanEvidence(workbook);

        expect(evidence.years).toEqual(['2027', '2028', '2029', '2030', '2031', '2032']);
        expect(evidence.rows).toHaveLength(3);
        expect(evidence.summaries[0]).toMatchObject({
            year: '2027',
            fleetTotal: 1,
            retiring: 0,
            replacementPurchases: 1,
            growthPurchases: 1,
            totalPurchases: 2,
        });
        expect(evidence.summaries[1]).toMatchObject({ year: '2028', fleetTotal: 2, retiring: 1 });
        expect(JSON.stringify(workbook)).toBe(original);
    });
});
