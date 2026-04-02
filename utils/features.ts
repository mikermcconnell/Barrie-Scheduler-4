type FeatureDefinition = {
    defaultEnabled: boolean;
    hideInDemoMode: boolean;
};

export const FEATURE_DEFINITIONS = {
    workspaceOndemand: { defaultEnabled: true, hideInDemoMode: false },
    workspaceFixedRoute: { defaultEnabled: true, hideInDemoMode: false },
    workspaceOperations: { defaultEnabled: true, hideInDemoMode: false },

    fixedNewSchedule: { defaultEnabled: true, hideInDemoMode: false },
    fixedMasterSchedule: { defaultEnabled: true, hideInDemoMode: false },
    fixedReports: { defaultEnabled: true, hideInDemoMode: false },
    fixedAnalytics: { defaultEnabled: true, hideInDemoMode: false },
    fixedDrafts: { defaultEnabled: true, hideInDemoMode: false },
    fixedEditor: { defaultEnabled: true, hideInDemoMode: false },
    fixedGtfsImport: { defaultEnabled: true, hideInDemoMode: false },
    fixedPerformanceImport: { defaultEnabled: true, hideInDemoMode: false },
    fixedSystemEditor: { defaultEnabled: true, hideInDemoMode: false },

    analyticsTransitApp: { defaultEnabled: true, hideInDemoMode: false },
    analyticsOdMatrix: { defaultEnabled: true, hideInDemoMode: true },
    analyticsCorridorSpeed: { defaultEnabled: true, hideInDemoMode: true },
    analyticsCorridorHeadway: { defaultEnabled: true, hideInDemoMode: true },
    analyticsStudentPass: { defaultEnabled: true, hideInDemoMode: false },
    analyticsNetworkConnections: { defaultEnabled: true, hideInDemoMode: true },
    analyticsRoutePlanner: { defaultEnabled: true, hideInDemoMode: true },
    analyticsShuttlePlanner: { defaultEnabled: true, hideInDemoMode: true },

    operationsPerformanceDashboard: { defaultEnabled: true, hideInDemoMode: false },
    operationsPerfReports: { defaultEnabled: true, hideInDemoMode: false },
    operationsImportHealth: { defaultEnabled: true, hideInDemoMode: true },
    operationsLoadProfiles: { defaultEnabled: true, hideInDemoMode: true },
    operationsOperatorDwell: { defaultEnabled: true, hideInDemoMode: true },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureKey = keyof typeof FEATURE_DEFINITIONS;

export type FeatureFlags = {
    demoMode: boolean;
    showExperimentalInDemo: boolean;
} & Record<FeatureKey, boolean>;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;

    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return undefined;
}

function toEnvSuffix(feature: FeatureKey): string {
    return feature
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toUpperCase();
}

export function getFeatureOverrideEnvVar(feature: FeatureKey): string {
    return `VITE_FEATURE_${toEnvSuffix(feature)}`;
}

export function buildFeatureFlags(env: Record<string, unknown> = import.meta.env): FeatureFlags {
    const demoMode = parseOptionalBoolean(env.VITE_DEMO_MODE) ?? false;
    const showExperimentalInDemo = parseOptionalBoolean(env.VITE_SHOW_EXPERIMENTAL_IN_DEMO)
        ?? parseOptionalBoolean(env.VITE_SHOW_ALL_FEATURES)
        ?? demoMode;

    const flags = {
        demoMode,
        showExperimentalInDemo,
    } as FeatureFlags;

    (Object.keys(FEATURE_DEFINITIONS) as FeatureKey[]).forEach((feature) => {
        const definition = FEATURE_DEFINITIONS[feature];
        const override = parseOptionalBoolean(env[getFeatureOverrideEnvVar(feature)]);

        let enabled: boolean = definition.defaultEnabled;
        if (demoMode && definition.hideInDemoMode && !showExperimentalInDemo) {
            enabled = false;
        }
        if (override !== undefined) {
            enabled = override;
        }

        flags[feature] = enabled;
    });

    return flags;
}

export const featureFlags = buildFeatureFlags();

export function isFeatureEnabled(feature: FeatureKey, flags: FeatureFlags = featureFlags): boolean {
    return flags[feature];
}

export function isFeatureUnderConstruction(feature: FeatureKey, flags: FeatureFlags = featureFlags): boolean {
    return flags.demoMode && FEATURE_DEFINITIONS[feature].hideInDemoMode;
}
