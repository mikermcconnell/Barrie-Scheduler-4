import React, { useState } from 'react';
import { LayoutGrid, PlusCircle, Search } from 'lucide-react';
import type { Team } from '../../utils/masterScheduleTypes';

interface TeamDirectoryProps {
    teams: Team[];
    loading: boolean;
    switching: boolean;
    activeTeamId?: string;
    showBackToHome: boolean;
    onSelect: (team: Team) => void;
    onBackToHome: () => void;
    onNewTeam: () => void;
    overviewActive: boolean;
    onOpenOverview: () => void;
}

export const TeamDirectory: React.FC<TeamDirectoryProps> = ({
    teams,
    loading,
    switching,
    activeTeamId,
    showBackToHome,
    onSelect,
    onBackToHome,
    onNewTeam,
    overviewActive,
    onOpenOverview,
}) => {
    const [filter, setFilter] = useState('');

    const query = filter.trim().toLowerCase();
    const visibleTeams = teams.filter(team => !query ||
        team.name.toLowerCase().includes(query) ||
        team.inviteCode.toLowerCase().includes(query));

    return (
        <aside className="border-b border-gray-200 bg-gray-50 p-4 lg:border-b-0 lg:border-r">
            <button
                onClick={onNewTeam}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-green-300 bg-green-50 px-3 py-2 text-sm font-bold text-green-800 hover:bg-green-100"
            >
                <PlusCircle size={16} />
                New team
            </button>

            <button
                onClick={onOpenOverview}
                className={`mb-4 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${
                    overviewActive
                        ? 'border-brand-green bg-brand-green text-white'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100'
                }`}
                aria-pressed={overviewActive}
            >
                <LayoutGrid size={16} />
                Access overview
            </button>

            <label className="text-xs font-bold uppercase tracking-wide text-gray-500" htmlFor="team-directory-filter">
                Find team
            </label>
            <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                    id="team-directory-filter"
                    type="text"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Name or code"
                    className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
                />
            </div>

            {showBackToHome && (
                <button
                    onClick={onBackToHome}
                    className="mt-3 w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
                >
                    Back to my team
                </button>
            )}

            <div className="mt-3 max-h-[460px] overflow-y-auto rounded-xl border border-gray-200 bg-white">
                {loading ? (
                    <p className="px-3 py-3 text-sm text-gray-500">Loading teams...</p>
                ) : visibleTeams.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-gray-500">No teams found.</p>
                ) : visibleTeams.map(team => (
                    <button
                        key={team.id}
                        onClick={() => onSelect(team)}
                        disabled={switching}
                        className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-green-50 disabled:opacity-50 ${
                            team.id === activeTeamId && !overviewActive ? 'bg-green-50 text-green-900' : 'text-gray-700'
                        }`}
                    >
                        <span className="truncate font-semibold">{team.name}</span>
                        <span className="font-mono text-xs text-gray-500">{team.inviteCode}</span>
                    </button>
                ))}
            </div>
        </aside>
    );
};
