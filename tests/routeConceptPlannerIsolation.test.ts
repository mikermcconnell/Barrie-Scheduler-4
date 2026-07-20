import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PRODUCTION_FILES = [
    'components/Analytics/RouteConceptPlannerWorkspace.tsx',
    'components/Analytics/route-concept-planner/RouteConceptGtfsImportDrawer.tsx',
    'components/Analytics/route-concept-planner/RouteConceptMapBridge.tsx',
    'utils/route-concept-planner/routeConceptPlannerTypes.ts',
    'utils/route-concept-planner/routeConceptPlannerProjectFactory.ts',
    'utils/route-concept-planner/routeConceptPlannerProjectController.ts',
    'utils/route-concept-planner/routeConceptPlannerAuthoring.ts',
    'utils/route-concept-planner/routeConceptPlannerFeasibility.ts',
    'utils/route-concept-planner/routeConceptPlannerPersistence.ts',
    'utils/route-concept-planner/routeConceptPlannerGtfsAdapter.ts',
    'utils/route-concept-planner/routeConceptPlannerEngineAdapter.ts',
] as const;

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Route Concept Planner isolation', () => {
    it('does not depend on the Camp workspace, persistence, exports, or manifest helpers', () => {
        const forbidden = [
            'RoutePlanner2Workspace',
            'routePlanner2ProjectPersistence',
            'routePlanner2StopTimes',
            'routePlanner2AddressImport',
            'routePlanner2MapExport',
            'routePlanner2OperatorExport',
            'routePlanner2TransferPreview',
        ];
        for (const path of PRODUCTION_FILES) {
            const contents = source(path);
            forbidden.forEach((token) => expect(contents, `${path} imports ${token}`).not.toContain(token));
        }
    });

    it('limits Route Planner 2 imports to the approved adapters and neutral map bridge', () => {
        const allowed = new Set([
            'components/Analytics/route-concept-planner/RouteConceptMapBridge.tsx',
            'utils/route-concept-planner/routeConceptPlannerGtfsAdapter.ts',
            'utils/route-concept-planner/routeConceptPlannerEngineAdapter.ts',
        ]);
        for (const path of PRODUCTION_FILES) {
            if (allowed.has(path)) continue;
            expect(source(path), `${path} crosses the adapter boundary`).not.toContain('route-planner-2');
        }
    });

    it('keeps camper and rider-manifest presentation out of the new interface', () => {
        const interfaceSource = [
            source('components/Analytics/RouteConceptPlannerWorkspace.tsx'),
            source('components/Analytics/route-concept-planner/RouteConceptGtfsImportDrawer.tsx'),
            source('components/Analytics/route-concept-planner/RouteConceptMapBridge.tsx'),
        ].join('\n').toLowerCase();
        expect(interfaceSource).not.toContain('camper');
        expect(interfaceSource).not.toContain('ridercount');
        expect(interfaceSource).not.toContain('sourcerows');
        expect(interfaceSource).not.toContain('address manifest');
    });
});
