import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { Team, TeamWithMembers } from '../../utils/masterScheduleTypes';
import { getTeamWithMembers } from '../../utils/services/teamService';
import {
    ANALYTICS_WORKSPACE_FEATURES,
    WORKSPACE_ACCESS_FEATURES,
    getAllowedWorkspaceFeatures,
    type WorkspaceAccessFeatureKey,
} from '../../utils/workspaceAccess';
import { WORKSPACE_ACCESS_PACKAGES } from '../../utils/workspaceAccessPackages';
import {
    buildTeamAccessOverview,
    type AccessFindingSeverity,
    type WorkspaceAccessDescription,
    type WorkspaceCellSource,
} from '../../utils/teamAccessOverview';
import { WORKSPACE_FEATURE_LABELS } from './workspaceFeatureLabels';

type AssignableFeature = keyof typeof WORKSPACE_FEATURE_LABELS;

interface AccessOverviewPanelProps {
    teams: Team[];
    onOpenTeam: (team: Team) => void;
}

const ANALYTICS = new Set<WorkspaceAccessFeatureKey>(ANALYTICS_WORKSPACE_FEATURES);
const COLUMN_GROUPS: Array<{ label: string; features: AssignableFeature[] }> = [
    { label: 'Workspaces', features: WORKSPACE_ACCESS_FEATURES.filter(f => !ANALYTICS.has(f)) as AssignableFeature[] },
    { label: 'Planning Data', features: ANALYTICS_WORKSPACE_FEATURES as AssignableFeature[] },
];
const COLUMNS = COLUMN_GROUPS.flatMap(group => group.features);
const GROUP_STARTS = new Set(COLUMN_GROUPS.slice(1).map(group => group.features[0]));

const SEVERITY_STYLES: Record<AccessFindingSeverity, { label: string; border: string; badge: string }> = {
    act: { label: 'Act now', border: 'border-l-red-500', badge: 'bg-red-50 text-red-700' },
    review: { label: 'Review', border: 'border-l-amber-400', badge: 'bg-amber-50 text-amber-800' },
    note: { label: 'Note', border: 'border-l-gray-300', badge: 'bg-gray-100 text-gray-600' },
};

const CELL_TITLES: Record<WorkspaceCellSource, string> = {
    level: 'from access level',
    added: 'added by override',
    removed: 'removed by override',
    none: 'no access',
};

const CellMark: React.FC<{ source: WorkspaceCellSource }> = ({ source }) => {
    if (source === 'level') return <span className="inline-block h-3.5 w-3.5 rounded-full bg-brand-green" />;
    if (source === 'added') return <span className="inline-block h-3.5 w-3.5 rounded-full border-[3px] border-blue-700 bg-white" />;
    if (source === 'removed') return <span className="text-base font-black leading-none text-red-600">×</span>;
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-300" />;
};

const Pill: React.FC<{ tone?: 'plain' | 'owner' | 'internal' | 'custom'; children: React.ReactNode }> = ({ tone = 'plain', children }) => {
    const styles = {
        plain: 'border-gray-200 bg-white text-gray-700',
        owner: 'border-indigo-200 bg-indigo-50 text-indigo-800',
        internal: 'border-red-200 bg-red-50 text-red-700',
        custom: 'border-amber-200 bg-amber-50 text-amber-800',
    }[tone];
    return <span className={`ml-1.5 inline-block rounded-full border px-2 text-[11px] font-bold ${styles}`}>{children}</span>;
};

const AccessCells: React.FC<{ access: WorkspaceAccessDescription; label: string }> = ({ access, label }) => (
    <>
        {COLUMNS.map(feature => (
            <td
                key={feature}
                className={`h-9 border-b border-gray-100 text-center ${GROUP_STARTS.has(feature) ? 'border-l border-l-gray-200' : ''}`}
                title={`${label} · ${WORKSPACE_FEATURE_LABELS[feature]}: ${CELL_TITLES[access.cells[feature]]}`}
            >
                <CellMark source={access.cells[feature]} />
            </td>
        ))}
    </>
);

/**
 * Scheduler-admin view of every team: findings that need a decision, then
 * every team and member against every assignable workspace.
 */
export const AccessOverviewPanel: React.FC<AccessOverviewPanelProps> = ({ teams, onOpenTeam }) => {
    const [details, setDetails] = useState<TeamWithMembers[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [showMembers, setShowMembers] = useState(true);
    const [hideEmpty, setHideEmpty] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const teamIdsKey = teams.map(team => team.id).join(',');
    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const loaded = await Promise.all(teams.map(team => getTeamWithMembers(team.id)));
            setDetails(loaded.filter((team): team is TeamWithMembers => team !== null));
        } catch (loadError) {
            console.error('Error loading the access overview:', loadError);
            setError('Unable to load every team. Confirm your scheduler administrator access and try again.');
        } finally {
            setLoading(false);
        }
    // teamIdsKey captures the team list; the array itself is rebuilt by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teamIdsKey]);

    useEffect(() => {
        void load();
    }, [load]);

    const overview = useMemo(() => buildTeamAccessOverview(details), [details]);
    const search = query.trim().toLowerCase();

    const toggleTeam = (teamId: string): void => {
        setCollapsed(previous => {
            const next = new Set(previous);
            if (next.has(teamId)) next.delete(teamId);
            else next.add(teamId);
            return next;
        });
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Access overview</h2>
                    <p className="mt-1 max-w-3xl text-sm text-gray-500">
                        What every team and person can open. Only scheduler administrators can change workspace access.
                        A global feature flag can still hide a workspace from everyone.
                    </p>
                </div>
                <button
                    onClick={() => void load()}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p>
            )}

            <section aria-labelledby="access-findings-heading">
                <h3 id="access-findings-heading" className="mb-3 text-base font-bold text-gray-900">Needs attention</h3>
                {loading && details.length === 0 ? (
                    <p className="text-sm text-gray-500">Loading teams...</p>
                ) : overview.findings.length === 0 ? (
                    <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">Nothing needs attention.</p>
                ) : (
                    <ul className="space-y-2">
                        {overview.findings.map(finding => {
                            const style = SEVERITY_STYLES[finding.severity];
                            return (
                                <li
                                    key={finding.id}
                                    className={`grid gap-3 rounded-xl border border-l-4 border-gray-200 bg-white px-4 py-3 sm:grid-cols-[88px_1fr] ${style.border}`}
                                >
                                    <span className={`h-fit rounded-full px-2 py-0.5 text-center text-[11px] font-extrabold uppercase tracking-wide ${style.badge}`}>
                                        {style.label}
                                    </span>
                                    <div>
                                        <p className="font-bold text-gray-900">{finding.title}</p>
                                        <p className="mt-0.5 text-sm text-gray-500">{finding.detail}</p>
                                        <p className="mt-1 text-sm text-gray-800"><span className="font-bold text-brand-green">Do: </span>{finding.action}</p>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <section aria-labelledby="access-matrix-heading">
                <h3 id="access-matrix-heading" className="text-base font-bold text-gray-900">Who sees what</h3>
                <p className="mb-3 mt-1 text-sm text-gray-500">Select a team name to show or hide its members. Select Open to manage the team.</p>
                <div className="mb-3 flex flex-wrap items-center gap-4">
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Filter by team, person or email"
                        aria-label="Filter teams and members"
                        className="min-w-[240px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
                    />
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={showMembers} onChange={(event) => setShowMembers(event.target.checked)} />
                        Show members
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />
                        Hide teams with no members
                    </label>
                    <div className="ml-auto flex flex-wrap gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><CellMark source="level" /> From access level</span>
                        <span className="flex items-center gap-1.5"><CellMark source="added" /> Added by override</span>
                        <span className="flex items-center gap-1.5"><CellMark source="removed" /> Removed by override</span>
                        <span className="flex items-center gap-1.5"><CellMark source="none" /> No access</span>
                    </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                        <thead>
                            <tr>
                                <th className="sticky left-0 z-10 bg-white" />
                                {COLUMN_GROUPS.map((group, index) => (
                                    <th
                                        key={group.label}
                                        colSpan={group.features.length}
                                        className={`bg-white px-1 pt-2 text-center text-[11px] font-bold uppercase tracking-wide text-gray-500 ${index > 0 ? 'border-l border-gray-200' : ''}`}
                                    >
                                        {group.label}
                                    </th>
                                ))}
                            </tr>
                            <tr>
                                <th className="sticky left-0 z-10 min-w-[300px] border-b border-r border-gray-200 bg-white px-3 pb-2 text-left align-bottom text-xs font-normal text-gray-500">
                                    Team · person
                                </th>
                                {COLUMNS.map(feature => (
                                    <th
                                        key={feature}
                                        className={`h-40 w-9 min-w-[36px] border-b border-gray-200 bg-white pb-2 align-bottom ${GROUP_STARTS.has(feature) ? 'border-l' : ''}`}
                                    >
                                        <div className="mx-auto rotate-180 whitespace-nowrap text-xs font-semibold text-gray-700 [writing-mode:vertical-rl]">
                                            {WORKSPACE_FEATURE_LABELS[feature]}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {overview.teams.map(row => {
                                const { team } = row;
                                const teamMatches = !search || team.name.toLowerCase().includes(search);
                                const visibleMembers = row.members.filter(({ member }) => teamMatches ||
                                    `${member.displayName} ${member.email}`.toLowerCase().includes(search));
                                if (hideEmpty && row.members.length === 0) return null;
                                if (!teamMatches && visibleMembers.length === 0) return null;
                                const isCollapsed = collapsed.has(team.id);
                                const packageText = row.packageLabel ?? `Custom (${row.accessLevel} + overrides)`;

                                return (
                                    <Fragment key={team.id}>
                                        <tr className="bg-slate-50">
                                            <td className="sticky left-0 z-[1] border-b border-r border-gray-200 bg-slate-100 px-3 py-2">
                                                <div className="flex items-start gap-1">
                                                    <button
                                                        onClick={() => toggleTeam(team.id)}
                                                        disabled={row.members.length === 0}
                                                        className="flex min-w-0 flex-1 items-start gap-1 text-left font-bold text-gray-900 disabled:cursor-default"
                                                        aria-expanded={row.members.length > 0 ? !isCollapsed : undefined}
                                                    >
                                                        <span className="mt-0.5 w-4 shrink-0 text-gray-400">
                                                            {row.members.length > 0 && (isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />)}
                                                        </span>
                                                        <span className="min-w-0">
                                                            {team.name}
                                                            {team.partnerTeam && <Pill>partner</Pill>}
                                                            <span className="block text-xs font-normal text-gray-500">
                                                                Team package: {packageText} · {row.members.length} member{row.members.length === 1 ? '' : 's'}
                                                            </span>
                                                        </span>
                                                    </button>
                                                    <button
                                                        onClick={() => onOpenTeam(team)}
                                                        className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                                    >
                                                        Open
                                                    </button>
                                                </div>
                                            </td>
                                            <AccessCells access={row} label={`${team.name} package`} />
                                        </tr>
                                        {showMembers && !isCollapsed && visibleMembers.map(memberRow => {
                                            const { member } = memberRow;
                                            const name = member.displayName || member.email || member.userId;
                                            return (
                                                <tr key={member.id} className="hover:bg-green-50">
                                                    <td className="sticky left-0 z-[1] border-b border-r border-gray-100 bg-white py-1.5 pl-9 pr-3">
                                                        <span className="font-medium text-gray-900">{name}</span>
                                                        {member.role !== 'member' && <Pill tone="owner">{member.role}</Pill>}
                                                        <Pill tone={memberRow.accessLevel === 'internal' ? 'internal' : 'plain'}>{memberRow.packageLabel ?? memberRow.accessLevel}</Pill>
                                                        {memberRow.isException && <Pill tone="custom">Custom</Pill>}
                                                        <span className="block text-xs text-gray-500">{member.email}</span>
                                                    </td>
                                                    <AccessCells access={memberRow} label={name} />
                                                </tr>
                                            );
                                        })}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section aria-labelledby="access-packages-heading">
                <h3 id="access-packages-heading" className="text-base font-bold text-gray-900">Packages</h3>
                <p className="mb-3 mt-1 text-sm text-gray-500">The choices in a team&apos;s Access tab. Each package is an access level plus optional overrides.</p>
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="w-64 px-4 py-2">Package</th>
                                <th className="px-4 py-2">Workspaces</th>
                            </tr>
                        </thead>
                        <tbody>
                            {WORKSPACE_ACCESS_PACKAGES.map(pkg => {
                                const unlocked = getAllowedWorkspaceFeatures(pkg.accessLevel, pkg.workspaceOverrides) as AssignableFeature[];
                                return (
                                    <tr key={pkg.id} className="border-t border-gray-100 align-top">
                                        <td className="px-4 py-2">
                                            <p className="font-bold text-gray-900">{pkg.label}</p>
                                            <p className="text-xs text-gray-500">{pkg.description}</p>
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex flex-wrap gap-1">
                                                {unlocked.length === 0 ? (
                                                    <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">Team Management only</span>
                                                ) : unlocked.map(feature => (
                                                    <span key={feature} className="rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-800">
                                                        {WORKSPACE_FEATURE_LABELS[feature]}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <p className="font-bold text-gray-900">How access is controlled</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>A team role (owner, admin, member) controls membership, roles, renaming and the invite code. It does not control workspace access.</li>
                    <li>Only scheduler administrators can change a member&apos;s access, a team package, or a team&apos;s data sources. Firestore rules enforce this.</li>
                    <li>New members who join with an invite get the team package. A self-created team starts with No access.</li>
                    <li>To check what a team really sees, use Members → Inspect as. Choosing a team from the header menu inspects it with full access.</li>
                </ul>
            </section>
        </div>
    );
};
