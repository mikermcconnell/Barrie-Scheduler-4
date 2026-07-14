
import React, { useEffect, useState } from 'react';
import {
    LayoutDashboard,
    Bell,
    Settings,
    User,
    Users,
    LogOut,
    FolderOpen,
    ChevronDown,
    Eye,
    XCircle,
    Building2,
    Check,
    LoaderCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { WORKSPACE_ACCESS_LEVEL_LABELS } from '../../utils/workspaceAccess';

export type View = 'home' | 'ondemand' | 'fixed' | 'operations' | 'parking' | 'planning';

interface HeaderProps {
    currentView: View;
    onNavigate: (view: View) => void;
    onShowFileManager: () => void;
    onShowTeamManagement: () => void;
    onShowAuthModal: () => void;
    canShowFileManager?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
    currentView,
    onNavigate,
    onShowFileManager,
    onShowTeamManagement,
    onShowAuthModal,
    canShowFileManager = true,
}) => {
    const { user, signOut, isGlobalAdmin } = useAuth();
    const {
        accessLevel,
        team,
        actualTeam,
        isDeveloperPreview,
        developerPreview,
        stopDeveloperPreview,
        availableTeams = [],
        switchTeam: switchActiveTeam = async () => { },
    } = useTeam();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showTeamMenu, setShowTeamMenu] = useState(false);
    const [switchingTeamId, setSwitchingTeamId] = useState<string | null>(null);
    const [teamSwitchError, setTeamSwitchError] = useState<string | null>(null);
    const username = user?.displayName || user?.email?.split('@')[0] || 'Signed in';
    const accessLabel = WORKSPACE_ACCESS_LEVEL_LABELS[accessLevel];
    const supportExpiresAt = developerPreview
        ? new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(new Date(developerPreview.expiresAt))
        : null;

    useEffect(() => {
        if (!showTeamMenu) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setShowTeamMenu(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [showTeamMenu]);

    const handleSignOut = async () => {
        await signOut();
        setShowUserMenu(false);
        onNavigate('home');
    };

    const handleTeamSwitch = async (teamId: string) => {
        if (teamId === actualTeam?.id || isDeveloperPreview) {
            setShowTeamMenu(false);
            return;
        }

        setSwitchingTeamId(teamId);
        setTeamSwitchError(null);
        try {
            await switchActiveTeam(teamId);
            setShowTeamMenu(false);
        } catch (error) {
            setTeamSwitchError(error instanceof Error ? error.message : 'Unable to switch teams.');
        } finally {
            setSwitchingTeamId(null);
        }
    };

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50 transition-all duration-300">
            {isDeveloperPreview && developerPreview && (
                <div className={`border-b px-6 py-2 ${developerPreview.mode === 'edit' ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                    <div className={`mx-auto flex flex-col gap-2 text-xs font-bold sm:flex-row sm:items-center sm:justify-between ${developerPreview.mode === 'edit' ? 'text-red-900' : 'text-amber-900'} ${currentView === 'home' ? 'max-w-7xl' : 'max-w-[1920px]'}`}>
                        <div className="flex items-center gap-2">
                            <Eye size={15} />
                            <span>
                                {developerPreview.mode === 'edit' ? 'Developer editing' : 'Inspecting'} {team?.name} as {developerPreview.sourceLabel}
                                {actualTeam?.name ? ` · real team: ${actualTeam.name}` : ''}
                                {developerPreview.readOnly ? ' · target team is read-only' : ` · reason: ${developerPreview.reason}`}
                                {supportExpiresAt ? ` · expires ${supportExpiresAt}` : ''}
                            </span>
                        </div>
                        <button
                            onClick={() => void stopDeveloperPreview()}
                            className={`inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 ${developerPreview.mode === 'edit' ? 'border-red-300 text-red-800 hover:bg-red-100' : 'border-amber-300 text-amber-800 hover:bg-amber-100'}`}
                        >
                            <XCircle size={14} />
                            Exit support session
                        </button>
                    </div>
                </div>
            )}
            <div className={`mx-auto px-6 h-16 flex items-center justify-between ${currentView === 'home' ? 'max-w-7xl' : 'max-w-[1920px]'}`}>

                {/* Logo Section */}
                <div
                    className="flex items-center gap-3 cursor-pointer group"
                    onClick={() => onNavigate('home')}
                >
                    <div className="bg-gradient-to-br from-brand-green to-emerald-600 p-2 rounded-lg shadow-sm group-hover:shadow-md transition-all duration-300 transform group-hover:scale-105">
                        <LayoutDashboard className="text-white" size={20} />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 tracking-tight leading-none group-hover:text-emerald-700 transition-colors">
                        Transit<span className="text-brand-green">Scheduler</span>
                    </h1>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-4">

                    {user && (
                        <div className="relative">
                            <button
                                type="button"
                                aria-expanded={showTeamMenu}
                                aria-controls="team-switcher-popover"
                                aria-label={`Active team: ${team?.name ?? 'No team selected'}`}
                                title={isDeveloperPreview ? 'Exit the support session before switching teams' : 'Switch active team'}
                                onClick={() => {
                                    setShowUserMenu(false);
                                    setTeamSwitchError(null);
                                    setShowTeamMenu(current => !current);
                                }}
                                className="flex max-w-56 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-colors hover:border-gray-300 hover:bg-gray-100"
                            >
                                <Building2 size={16} className="shrink-0 text-emerald-600" />
                                <span className="min-w-0">
                                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                        {isDeveloperPreview ? 'Preview team' : 'Active team'}
                                    </span>
                                    <span className="block truncate text-sm font-bold leading-tight text-gray-800">
                                        {team?.name ?? 'No team selected'}
                                    </span>
                                </span>
                                <ChevronDown
                                    size={14}
                                    className={`shrink-0 text-gray-400 transition-transform ${showTeamMenu ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {showTeamMenu && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowTeamMenu(false)} />
                                    <div
                                        id="team-switcher-popover"
                                        role="group"
                                        aria-label="Switch active team"
                                        className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-100 bg-white py-2 shadow-xl"
                                    >
                                        <div className="border-b border-gray-100 px-4 py-2">
                                            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Your teams</p>
                                            {isDeveloperPreview && (
                                                <p className="mt-1 text-xs text-amber-700">Exit the support session before switching teams.</p>
                                            )}
                                        </div>
                                        <div className="max-h-72 overflow-y-auto p-2">
                                            {availableTeams.length > 0 ? availableTeams.map(availableTeam => {
                                                const isActive = availableTeam.id === actualTeam?.id && !isDeveloperPreview;
                                                const isSwitching = switchingTeamId === availableTeam.id;
                                                return (
                                                    <button
                                                        key={availableTeam.id}
                                                        type="button"
                                                        data-team-option
                                                        aria-pressed={isActive}
                                                        disabled={isDeveloperPreview || switchingTeamId !== null}
                                                        onClick={() => void handleTeamSwitch(availableTeam.id)}
                                                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                                                            {isSwitching
                                                                ? <LoaderCircle size={14} className="animate-spin" />
                                                                : isActive
                                                                    ? <Check size={14} className="text-emerald-600" />
                                                                    : <Building2 size={14} />}
                                                        </span>
                                                        <span className="min-w-0 flex-1 truncate">{availableTeam.name}</span>
                                                        {isActive && <span className="text-xs font-semibold text-emerald-700">Active</span>}
                                                    </button>
                                                );
                                            }) : (
                                                <p className="px-3 py-3 text-sm text-gray-500">No team memberships found.</p>
                                            )}
                                        </div>
                                        {teamSwitchError && (
                                            <p role="alert" className="mx-3 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                                                {teamSwitchError}
                                            </p>
                                        )}
                                        <div className="border-t border-gray-100 px-2 pt-2">
                                            <button
                                                type="button"
                                                onClick={() => { onShowTeamManagement(); setShowTeamMenu(false); }}
                                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                                            >
                                                <Users size={16} /> Team Management
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Quick Actions */}
                    <div className="flex items-center gap-2 border-r border-gray-200 pr-4 mr-2">
                        {user && canShowFileManager && (
                            <button
                                onClick={onShowFileManager}
                                className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-md transition-all border border-transparent hover:border-gray-200 text-sm font-medium"
                                title="Open File Manager"
                            >
                                <FolderOpen size={16} />
                                <span className="hidden sm:inline">Files</span>
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors group">
                            <Bell size={20} />
                            <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white opacity-0 group-hover:opacity-100 transition-opacity"></span>
                        </button>
                        <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
                            <Settings size={20} />
                        </button>
                    </div>

                    {/* User Profile */}
                    <div className="pl-2">
                        {user ? (
                            <div className="relative">
                                <button
                                    onClick={() => { setShowTeamMenu(false); setShowUserMenu(!showUserMenu); }}
                                    className="flex items-center gap-3 hover:bg-gray-50 rounded-full p-1 pl-2 pr-3 transition-colors border border-transparent hover:border-gray-100 active:bg-gray-100"
                                >
                                    <div className="text-right hidden md:block">
                                        <p className="text-sm font-bold text-gray-800 leading-tight">{username}</p>
                                        <p className="text-[10px] text-gray-500 font-medium">
                                            {team?.name ? `${isDeveloperPreview ? 'Preview: ' : ''}${team.name} · ${accessLabel}` : accessLabel}
                                        </p>
                                    </div>
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-green to-emerald-500 p-[2px] shadow-sm">
                                        <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden">
                                            {user.photoURL ? (
                                                <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <User className="text-emerald-600" size={16} />
                                            )}
                                        </div>
                                    </div>
                                    <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Dropdown Menu */}
                                {showUserMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                                        <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-100 rounded-xl shadow-xl py-2 z-50 transform origin-top-right animate-in fade-in zoom-in-95 duration-200">
                                            <div className="px-5 py-4 border-b border-gray-50 bg-gray-50/50">
                                                <p className="font-bold text-gray-900 truncate">{username}</p>
                                                <p className="text-xs text-gray-500 truncate mt-0.5">{user.email}</p>
                                                {team?.name && (
                                                    <p className="text-xs font-semibold text-gray-700 truncate mt-1">
                                                        {isDeveloperPreview ? 'Preview team' : 'Team'}: {team.name}
                                                    </p>
                                                )}
                                                {isDeveloperPreview && actualTeam?.name && (
                                                    <p className="text-xs text-amber-700 truncate mt-0.5">Real team: {actualTeam.name}</p>
                                                )}
                                                <p className="text-xs text-gray-500 truncate mt-0.5">{accessLabel}</p>
                                                {isGlobalAdmin && (
                                                    <p className="mt-1 text-xs font-bold text-purple-700">Scheduler administrator</p>
                                                )}
                                            </div>

                                            <div className="p-2">
                                                <button
                                                    onClick={() => { onShowFileManager(); setShowUserMenu(false); }}
                                                    className="w-full px-3 py-2 text-left text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg flex items-center gap-3 transition-colors"
                                                >
                                                    <FolderOpen size={16} /> My Files
                                                </button>
                                                <button
                                                    className="w-full px-3 py-2 text-left text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg flex items-center gap-3 transition-colors"
                                                >
                                                    <Settings size={16} /> Preferences
                                                </button>
                                                <button
                                                    onClick={() => { onShowTeamManagement(); setShowUserMenu(false); }}
                                                    className="w-full px-3 py-2 text-left text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg flex items-center gap-3 transition-colors"
                                                >
                                                    <Users size={16} /> Team Management
                                                </button>
                                            </div>

                                            <div className="h-px bg-gray-100 mx-2 my-1"></div>

                                            <div className="p-2">
                                                <button
                                                    onClick={handleSignOut}
                                                    className="w-full px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-3 transition-colors"
                                                >
                                                    <LogOut size={16} /> Sign Out
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={onShowAuthModal}
                                className="flex items-center gap-2 px-5 py-2.5 bg-brand-green hover:bg-emerald-600 text-white rounded-lg transition-all shadow-sm hover:shadow-md font-bold text-sm tracking-wide"
                            >
                                <User size={18} />
                                Sign In
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
};
