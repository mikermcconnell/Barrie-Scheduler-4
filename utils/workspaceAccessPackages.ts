import type {
    WorkspaceAccessFeatureKey,
    WorkspaceAccessGrant,
    WorkspaceAccessLevel,
    WorkspaceAccessOverrides,
} from './workspaceAccess';
import {
    getAllowedWorkspaceFeatures,
    haveSameWorkspaceAccess,
    WORKSPACE_ACCESS_FEATURES,
} from './workspaceAccess';

export type WorkspaceAccessPackageId =
    | 'none'
    | 'barrie-planner'
    | 'barrie-production'
    | 'barrie-admin'
    | 'barrie-operations'
    | 'transit-app-only'
    | 'transit-app-streets'
    | 'parking-only'
    | 'internal-developer';

export interface WorkspaceAccessPackage {
    id: WorkspaceAccessPackageId;
    label: string;
    description: string;
    accessLevel: WorkspaceAccessLevel;
    workspaceOverrides?: WorkspaceAccessOverrides;
}

export const WORKSPACE_ACCESS_PACKAGES: WorkspaceAccessPackage[] = [
    {
        id: 'none',
        label: 'No access',
        description: 'Team Management only until access is intentionally assigned.',
        accessLevel: 'none',
    },
    {
        id: 'barrie-planner',
        label: 'Barrie planner',
        description: 'Standard internal planner tools: schedules, operations, on-demand, and core planning data.',
        accessLevel: 'planner',
    },
    {
        id: 'barrie-production',
        label: 'Production only',
        description: 'Production-ready workspaces only: scheduled transit and operations.',
        accessLevel: 'production',
    },
    {
        id: 'barrie-admin',
        label: 'Planner + admin tools',
        description: 'Planner access plus parking, the OD matrix, and dwell incident review.',
        accessLevel: 'admin',
    },
    {
        id: 'barrie-operations',
        label: 'Operations dashboards',
        description: 'Dashboard & Reporting only, for STREETS performance review without schedule-editing access.',
        accessLevel: 'none',
        workspaceOverrides: {
            workspaceOperations: true,
        },
    },
    {
        id: 'transit-app-only',
        label: 'Transit App Data only',
        description: 'External partner access to only the Transit App Data planning workspace.',
        accessLevel: 'transit-app-only',
    },
    {
        id: 'transit-app-streets',
        label: 'Transit App + STREETS Dashboard',
        description: 'External partner access to Transit App Data and Dashboard & Reporting.',
        accessLevel: 'transit-app-only',
        workspaceOverrides: {
            workspaceOperations: true,
        },
    },
    {
        id: 'parking-only',
        label: 'Parking only',
        description: 'Parking-code usage workspace only.',
        accessLevel: 'parking',
    },
    {
        id: 'internal-developer',
        label: 'Internal developer',
        description: 'Full internal/developer access. Use only for Mike or trusted development accounts.',
        accessLevel: 'internal',
    },
];

export function getWorkspaceAccessPackage(id: WorkspaceAccessPackageId): WorkspaceAccessPackage {
    return WORKSPACE_ACCESS_PACKAGES.find(pkg => pkg.id === id) ?? WORKSPACE_ACCESS_PACKAGES[0];
}

/**
 * Identify which named package a stored level/override pair corresponds to by
 * comparing the workspaces it unlocks. Returns null for hand-built combinations
 * that no package describes.
 */
export function findWorkspaceAccessPackage(grant: WorkspaceAccessGrant): WorkspaceAccessPackage | null {
    return WORKSPACE_ACCESS_PACKAGES.find(pkg => haveSameWorkspaceAccess(grant, {
        accessLevel: pkg.accessLevel,
        workspaceOverrides: pkg.workspaceOverrides,
    })) ?? null;
}

export function buildWorkspaceSelectionFromPackage(
    id: WorkspaceAccessPackageId,
): Record<WorkspaceAccessFeatureKey, boolean> {
    const pkg = getWorkspaceAccessPackage(id);
    const allowed = new Set(getAllowedWorkspaceFeatures(pkg.accessLevel, pkg.workspaceOverrides));
    return WORKSPACE_ACCESS_FEATURES.reduce((selection, feature) => {
        selection[feature] = allowed.has(feature);
        return selection;
    }, {} as Record<WorkspaceAccessFeatureKey, boolean>);
}

