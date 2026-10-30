import type { WorkspaceAccessLevel } from './workspaceAccess';

/**
 * Links into the Barrie Simulator (separate app, docs in its repo: docs/SCHEDULER4-HANDOFF.md).
 * The simulator signs the planner in with a fresh Firebase ID token passed in the URL fragment, so
 * they are not asked to sign in again. The fragment never reaches a server or a log.
 */
export const SIMULATOR_ORIGIN = (import.meta.env.VITE_SIMULATOR_ORIGIN as string | undefined) || 'https://barrie-simulator.vercel.app';

/** Access levels the simulator accepts (its ALLOWED_ACCESS_LEVELS default). Others would be refused there. */
export const SIMULATOR_ACCESS_LEVELS: readonly WorkspaceAccessLevel[] = ['planner', 'internal', 'admin'];

/**
 * Levels the simulator signs in to some tabs only (its LIMITED_TABS): the parking team sees Parking and
 * Planning, and no operations or rider data.
 */
export const SIMULATOR_LIMITED_TABS: Partial<Record<WorkspaceAccessLevel, readonly string[]>> = { parking: ['Parking', 'Planning'] };

/**
 * Teams the simulator signs in to some tabs only, whatever the member's level here (its ONTARIO_NORTHLAND_TEAM):
 * the Ontario Northland team sees the tabs built on public data, and no operations, rider or internal City data.
 */
export const SIMULATOR_TEAM_TABS: Record<string, readonly string[]> = { VieLReKaKrIfaSh44kEj: ['Service Desk', 'Planning', 'Parking'] };

/** The only simulator tabs this user gets, or undefined when they get every deployed tab. */
export function simulatorLimitedTabs(accessLevel: WorkspaceAccessLevel, teamId?: string | null): readonly string[] | undefined {
    return SIMULATOR_LIMITED_TABS[accessLevel] ?? (teamId ? SIMULATOR_TEAM_TABS[teamId] : undefined);
}

/** Operations views the simulator opens from a link. Leave out for Buses (live and replay). */
export type SimulatorView = 'punctuality';

export function canOpenSimulator(accessLevel: WorkspaceAccessLevel, teamId?: string | null): boolean {
    return SIMULATOR_ACCESS_LEVELS.includes(accessLevel) || !!simulatorLimitedTabs(accessLevel, teamId);
}

export function simulatorUrl(idToken: string, view?: SimulatorView, origin = SIMULATOR_ORIGIN): string {
    const fragment = new URLSearchParams({ token: idToken, ...(view ? { view } : {}) });
    return `${origin}/login.html#${fragment.toString()}`;
}

/** Opens the simulator in this tab, signed in as the current user. */
export async function openSimulator(view?: SimulatorView): Promise<void> {
    const { auth } = await import('./firebase');
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in to Scheduler 4 first.');
    const token = await user.getIdToken(true);
    window.location.assign(simulatorUrl(token, view));
}
