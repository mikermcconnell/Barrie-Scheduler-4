
import React, { useState } from 'react';
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
    const { user, signOut } = useAuth();
    const {
        accessLevel,
        team,
        actualTeam,
        isDeveloperPreview,
        developerPreview,
        stopDeveloperPreview,
    } = useTeam();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const username = user?.displayName || user?.email?.split('@')[0] || 'Signed in';
    const accessLabel = WORKSPACE_ACCESS_LEVEL_LABELS[accessLevel];

    const handleSignOut = async () => {
        await signOut();
        setShowUserMenu(false);
        onNavigate('home');
    };

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50 transition-all duration-300">
            {isDeveloperPreview && developerPreview && (
                <div className="border-b border-amber-200 bg-amber-50 px-6 py-2">
                    <div className={`mx-auto flex flex-col gap-2 text-xs font-bold text-amber-900 sm:flex-row sm:items-center sm:justify-between ${currentView === 'home' ? 'max-w-7xl' : 'max-w-[1920px]'}`}>
                        <div className="flex items-center gap-2">
                            <Eye size={15} />
                            <span>
                                Previewing {team?.name} as {developerPreview.sourceLabel}
                                {actualTeam?.name ? ` · real team: ${actualTeam.name}` : ''}
                                {developerPreview.readOnly ? ' · read-only preview' : ''}
                            </span>
                        </div>
                        <button
                            onClick={stopDeveloperPreview}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-3 py-1 text-amber-800 hover:bg-amber-100"
                        >
                            <XCircle size={14} />
                            Exit preview
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
                                    onClick={() => setShowUserMenu(!showUserMenu)}
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
