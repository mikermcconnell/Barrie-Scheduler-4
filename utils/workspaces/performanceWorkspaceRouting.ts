import type { PerformanceTab } from '../performanceDataTypes';

export type PerformanceWorkspaceTab = Extract<
    PerformanceTab,
    'overview' | 'otp' | 'ridership' | 'operator-dwell'
>;

const PERFORMANCE_WORKSPACE_TABS = new Set<PerformanceWorkspaceTab>([
    'overview',
    'otp',
    'ridership',
    'operator-dwell',
]);

const normalizeHashParts = (value: string): string[] =>
    value
        .trim()
        .replace(/^#/, '')
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);

export function isPerformanceWorkspaceTab(
    value: string | undefined,
): value is PerformanceWorkspaceTab {
    return Boolean(value && PERFORMANCE_WORKSPACE_TABS.has(value as PerformanceWorkspaceTab));
}

export function parsePerformanceWorkspaceTabFromHash(hash: string): PerformanceWorkspaceTab {
    const parts = normalizeHashParts(hash);
    if (parts[0] !== 'operations' || parts[1] !== 'performance') return 'overview';
    return isPerformanceWorkspaceTab(parts[2]) ? parts[2] : 'overview';
}

export function buildPerformanceWorkspaceHash(tab: PerformanceWorkspaceTab): string {
    return tab === 'overview'
        ? '#operations/performance'
        : `#operations/performance/${tab}`;
}
