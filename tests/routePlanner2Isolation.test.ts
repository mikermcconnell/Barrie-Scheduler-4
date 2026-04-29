import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const filesToScan = [
  'components/Analytics/RoutePlanner2Workspace.tsx',
  'utils/route-planner-2/routePlanner2ProjectFactory.ts',
  'utils/route-planner-2/routePlanner2ProjectController.ts',
  'utils/route-planner-2/routePlanner2Authoring.ts',
  'utils/route-planner-2/routePlanner2Types.ts',
];

const disallowedPatterns = [
  'utils/route-planner/',
  '../utils/route-planner/',
  './useRoutePlannerController',
  'useRoutePlannerController',
  'routePlannerDraftStorage',
  'routePlannerProjectService',
];

describe('Route Planner 2 isolation', () => {
  it('does not import legacy Route Planner controllers, services, storage, or utilities', () => {
    const violations = filesToScan.flatMap((relativePath) => {
      const fullPath = path.join(process.cwd(), relativePath);

      if (!fs.existsSync(fullPath)) return [];

      const text = fs.readFileSync(fullPath, 'utf8');
      return disallowedPatterns
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${relativePath} contains ${pattern}`);
    });

    expect(violations).toEqual([]);
  });
});
