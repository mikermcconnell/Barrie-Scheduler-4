/**
 * Team Management Component
 *
 * Allows users to create teams, join via invite code, and manage team members.
 */

import React, { useState, useEffect } from 'react';
import { Users, Copy, Check, Trash2, Shield, User, LogOut, X } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useTeam } from './contexts/TeamContext';
import { useToast } from './contexts/ToastContext';
import {
    createTeam,
    joinTeamByInviteCode,
    getTeamWithMembers,
    getTeamWithMembersByInviteCode,
    getTeamsForPermissionManagement,
    leaveTeam,
    removeMember,
    updateMemberAccessLevel,
    regenerateInviteCode,
    setInviteCode as setTeamInviteCode
} from '../utils/services/teamService';
import type { Team, TeamWithMembers, TeamMember, WorkspaceAccessLevel } from '../utils/masterScheduleTypes';
import {
    resolveWorkspaceAccessLevel,
    WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS,
    WORKSPACE_ACCESS_LEVEL_LABELS,
    WORKSPACE_ACCESS_LEVELS,
} from '../utils/workspaceAccess';

interface TeamManagementProps {
    onClose?: () => void;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({ onClose }) => {
    const { user } = useAuth();
    const { team, refreshTeam, accessLevel } = useTeam();
    const toast = useToast();

    const [isCreating, setIsCreating] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const [teamName, setTeamName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [teamDetails, setTeamDetails] = useState<TeamWithMembers | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);
    const [isEditingInviteCode, setIsEditingInviteCode] = useState(false);
    const [customInviteCode, setCustomInviteCode] = useState('');
    const [savingInviteCode, setSavingInviteCode] = useState(false);
    const [teamLookupCode, setTeamLookupCode] = useState('');
    const [teamLookupLoading, setTeamLookupLoading] = useState(false);
    const [managedTeamDetails, setManagedTeamDetails] = useState<TeamWithMembers | null>(null);
    const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
    const [availableTeamsLoading, setAvailableTeamsLoading] = useState(false);

    const currentTeamMember = teamDetails?.members.find(m => m.userId === user?.uid);
    const isCurrentTeamOwnerOrAdmin = currentTeamMember?.role === 'owner' || currentTeamMember?.role === 'admin';
    const canLookupTeams = accessLevel === 'internal' || accessLevel === 'admin';
    const activeTeamDetails = managedTeamDetails ?? teamDetails;
    const activeTeamId = activeTeamDetails?.id ?? team?.id;
    const isViewingCurrentTeam = !managedTeamDetails || managedTeamDetails.id === team?.id;
    const canManageInviteCode = isViewingCurrentTeam && isCurrentTeamOwnerOrAdmin;
    const canManageActiveAccess = isCurrentTeamOwnerOrAdmin || canLookupTeams;
    const canRemoveActiveMembers = isViewingCurrentTeam && isCurrentTeamOwnerOrAdmin;
    const filteredAvailableTeams = availableTeams.filter(availableTeam => {
        const filter = teamLookupCode.trim().toLowerCase();
        if (!filter) return true;
        return availableTeam.name.toLowerCase().includes(filter) ||
            availableTeam.inviteCode.toLowerCase().includes(filter);
    });

    // Load full team details with members
    useEffect(() => {
        if (team) {
            setManagedTeamDetails(null);
            loadTeamDetails();
        }
    }, [team]);

    useEffect(() => {
        if (canLookupTeams) {
            loadAvailableTeams();
        }
    }, [canLookupTeams]);

    const loadTeamDetails = async () => {
        if (!team) return;

        try {
            const details = await getTeamWithMembers(team.id);
            setTeamDetails(details);
        } catch (error) {
            console.error('Error loading team details:', error);
            toast?.error('Failed to load team details');
        }
    };

    const handleCreateTeam = async () => {
        if (!user || !teamName.trim()) return;

        setLoading(true);
        try {
            await createTeam(
                user.uid,
                teamName.trim(),
                user.displayName || user.email?.split('@')[0] || 'User',
                user.email || ''
            );

            await refreshTeam();
            toast?.success(`Team "${teamName}" created!`);
            setTeamName('');
            setIsCreating(false);
        } catch (error) {
            console.error('Error creating team:', error);
            toast?.error('Failed to create team');
        } finally {
            setLoading(false);
        }
    };

    const handleJoinTeam = async () => {
        if (!user || !inviteCode.trim()) return;

        setLoading(true);
        try {
            await joinTeamByInviteCode(
                user.uid,
                inviteCode.toUpperCase(),
                user.displayName || user.email?.split('@')[0] || 'User',
                user.email || ''
            );

            await refreshTeam();
            toast?.success('Joined team successfully!');
            setInviteCode('');
            setIsJoining(false);
        } catch (error: any) {
            console.error('Error joining team:', error);
            toast?.error(error.message || 'Failed to join team');
        } finally {
            setLoading(false);
        }
    };

    const handleCopyInviteCode = async () => {
        const code = activeTeamDetails?.inviteCode ?? team?.inviteCode;
        if (!code) return;

        try {
            await navigator.clipboard.writeText(code);
            setCopiedCode(true);
            toast?.success('Invite code copied!');
            setTimeout(() => setCopiedCode(false), 2000);
        } catch (error) {
            toast?.error('Failed to copy code');
        }
    };

    const handleRegenerateCode = async () => {
        if (!team || !canManageInviteCode) return;

        try {
            await regenerateInviteCode(team.id);
            toast?.success('New invite code generated');
            setIsEditingInviteCode(false);
            await refreshTeam();
        } catch (error) {
            toast?.error('Failed to regenerate code');
        }
    };

    const loadAvailableTeams = async () => {
        setAvailableTeamsLoading(true);
        try {
            const teams = await getTeamsForPermissionManagement();
            setAvailableTeams(teams);
        } catch (error) {
            console.error('Error loading available teams:', error);
            toast?.error('Failed to load teams');
        } finally {
            setAvailableTeamsLoading(false);
        }
    };

    const reloadActiveTeamDetails = async () => {
        if (!activeTeamId) return;

        const details = await getTeamWithMembers(activeTeamId);
        if (managedTeamDetails) {
            setManagedTeamDetails(details);
        } else {
            setTeamDetails(details);
        }
    };

    const handleLookupTeam = async () => {
        const normalized = teamLookupCode.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(normalized)) {
            toast?.error('Enter a 6-character team code');
            return;
        }

        setTeamLookupLoading(true);
        try {
            const details = await getTeamWithMembersByInviteCode(normalized);
            if (!details) {
                toast?.error('No team found for that code');
                return;
            }

            setManagedTeamDetails(details);
            setTeamLookupCode(normalized);
            setIsEditingInviteCode(false);
            toast?.success(`Viewing ${details.name}`);
        } catch (error) {
            console.error('Error looking up team:', error);
            toast?.error('Failed to load team');
        } finally {
            setTeamLookupLoading(false);
        }
    };

    const handleSelectTeam = async (selectedTeam: Team) => {
        setTeamLookupLoading(true);
        try {
            const details = await getTeamWithMembers(selectedTeam.id);
            if (!details) {
                toast?.error('Team not found');
                return;
            }

            setManagedTeamDetails(details);
            setTeamLookupCode(selectedTeam.inviteCode);
            setIsEditingInviteCode(false);
            toast?.success(`Viewing ${details.name}`);
        } catch (error) {
            console.error('Error loading selected team:', error);
            toast?.error('Failed to load team');
        } finally {
            setTeamLookupLoading(false);
        }
    };

    const handleResetTeamLookup = () => {
        setManagedTeamDetails(null);
        setTeamLookupCode('');
        setIsEditingInviteCode(false);
    };

    const handleSetCustomInviteCode = async () => {
        if (!team || !canManageInviteCode) return;
        const normalized = customInviteCode.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(normalized)) {
            toast?.error('Invite code must be exactly 6 letters/numbers');
            return;
        }

        setSavingInviteCode(true);
        try {
            await setTeamInviteCode(team.id, normalized);
            await refreshTeam();
            setIsEditingInviteCode(false);
            toast?.success(`Invite code set to ${normalized}`);
        } catch (error: any) {
            toast?.error(error?.message || 'Failed to set invite code');
        } finally {
            setSavingInviteCode(false);
        }
    };

    const handleLeaveTeam = async () => {
        if (!user) return;

        if (!confirm('Are you sure you want to leave this team?')) return;

        setLoading(true);
        try {
            await leaveTeam(user.uid);
            await refreshTeam();
            toast?.success('Left team');
        } catch (error) {
            toast?.error('Failed to leave team');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveMember = async (memberId: string, memberName: string) => {
        if (!activeTeamId || !canRemoveActiveMembers) return;

        if (!confirm(`Remove ${memberName} from the team?`)) return;

        try {
            await removeMember(activeTeamId, memberId);
            await reloadActiveTeamDetails();
            toast?.success(`${memberName} removed from team`);
        } catch (error) {
            toast?.error('Failed to remove member');
        }
    };

    const handleChangeAccessLevel = async (member: TeamMember, accessLevel: WorkspaceAccessLevel) => {
        if (!activeTeamId || !canManageActiveAccess) return;

        if (member.userId === user?.uid && !confirm('Change your own workspace access level?')) {
            return;
        }

        try {
            await updateMemberAccessLevel(activeTeamId, member.id, accessLevel);
            await reloadActiveTeamDetails();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            toast?.success('Workspace access updated');
        } catch (error) {
            toast?.error('Failed to update workspace access');
        }
    };

    // No Team State - Create or Join
    if (!team) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-lg mx-auto">
                {onClose && (
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                    >
                        <X size={20} />
                    </button>
                )}

                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-brand-green/10 rounded-lg">
                        <Users className="text-brand-green" size={24} />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Team Setup</h2>
                </div>

                <p className="text-gray-600 mb-6">
                    Join a team to access the Master Schedule and collaborate with others.
                </p>

                <div className="space-y-4">
                    {/* Create Team Section */}
                    {!isJoining && (
                        <div className="border border-gray-200 rounded-lg p-6">
                            <h3 className="font-semibold text-gray-900 mb-3">Create New Team</h3>

                            {isCreating ? (
                                <div className="space-y-3">
                                    <input
                                        type="text"
                                        value={teamName}
                                        onChange={(e) => setTeamName(e.target.value)}
                                        placeholder="Team name"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-green focus:border-brand-green"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleCreateTeam}
                                            disabled={!teamName.trim() || loading}
                                            className="flex-1 px-4 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? 'Creating...' : 'Create'}
                                        </button>
                                        <button
                                            onClick={() => setIsCreating(false)}
                                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsCreating(true)}
                                    className="w-full px-4 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700"
                                >
                                    Create Team
                                </button>
                            )}
                        </div>
                    )}

                    {/* Join Team Section */}
                    {!isCreating && (
                        <div className="border border-gray-200 rounded-lg p-6">
                            <h3 className="font-semibold text-gray-900 mb-3">Join Existing Team</h3>

                            {isJoining ? (
                                <div className="space-y-3">
                                    <input
                                        type="text"
                                        value={inviteCode}
                                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                        placeholder="Enter 6-digit code"
                                        maxLength={6}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-green focus:border-brand-green uppercase text-center text-lg tracking-wider font-mono"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleJoinTeam}
                                            disabled={inviteCode.length !== 6 || loading}
                                            className="flex-1 px-4 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? 'Joining...' : 'Join'}
                                        </button>
                                        <button
                                            onClick={() => setIsJoining(false)}
                                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsJoining(true)}
                                    className="w-full px-4 py-2 border-2 border-brand-green text-brand-green font-bold rounded-lg hover:bg-green-50"
                                >
                                    Join with Code
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Has Team - Show Team Info
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-3xl mx-auto">
            {onClose && (
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                >
                    <X size={20} />
                </button>
            )}

            {/* Team Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-brand-green/10 rounded-lg">
                        <Users className="text-brand-green" size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">{activeTeamDetails?.name ?? team.name}</h2>
                        <p className="text-sm text-gray-500">
                            {activeTeamDetails?.memberCount || 0} members
                            {!isViewingCurrentTeam && <span className="ml-2 text-blue-600">Viewing by team code</span>}
                        </p>
                    </div>
                </div>
            </div>

            {canLookupTeams && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6">
                    <p className="text-sm font-semibold text-blue-900 mb-2">Admin team lookup</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                            type="text"
                            value={teamLookupCode}
                            onChange={(e) => setTeamLookupCode(e.target.value.toUpperCase())}
                            placeholder="Filter by team name or code"
                            className="flex-1 px-3 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-brand-green focus:border-brand-green"
                        />
                        <button
                            onClick={handleLookupTeam}
                            disabled={teamLookupLoading || !/^[A-Z0-9]{6}$/.test(teamLookupCode.trim().toUpperCase())}
                            className="px-4 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {teamLookupLoading ? 'Loading...' : 'Load Team'}
                        </button>
                        {!isViewingCurrentTeam && (
                            <button
                                onClick={handleResetTeamLookup}
                                className="px-4 py-2 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100"
                            >
                                My Team
                            </button>
                        )}
                    </div>
                    <p className="mt-2 text-xs text-blue-700">
                        Select any team below, or enter a 6-character code and load it directly.
                    </p>
                    <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-blue-100 bg-white">
                        {availableTeamsLoading ? (
                            <p className="px-3 py-2 text-sm text-gray-500">Loading teams...</p>
                        ) : filteredAvailableTeams.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-gray-500">No teams found.</p>
                        ) : (
                            filteredAvailableTeams.map(availableTeam => {
                                const isActiveTeam = availableTeam.id === activeTeamDetails?.id;
                                return (
                                    <button
                                        key={availableTeam.id}
                                        onClick={() => handleSelectTeam(availableTeam)}
                                        disabled={teamLookupLoading}
                                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50 disabled:opacity-50 ${
                                            isActiveTeam ? 'bg-blue-100 text-blue-900' : 'text-gray-700'
                                        }`}
                                    >
                                        <span className="font-semibold truncate">{availableTeam.name}</span>
                                        <span className="font-mono text-xs text-gray-500">{availableTeam.inviteCode}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* Invite Code */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-600 mb-1">Invite Code</p>
                        <p className="text-2xl font-mono font-bold text-gray-900 tracking-wider">
                            {activeTeamDetails?.inviteCode ?? team.inviteCode}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleCopyInviteCode}
                            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700"
                            title="Copy code"
                        >
                            {copiedCode ? <Check size={20} /> : <Copy size={20} />}
                        </button>
                        {canManageInviteCode && (
                            <>
                                <button
                                    onClick={() => {
                                        if (!isEditingInviteCode) setCustomInviteCode(team.inviteCode);
                                        setIsEditingInviteCode(v => !v);
                                    }}
                                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700 text-sm"
                                >
                                    {isEditingInviteCode ? 'Cancel' : 'Set Code'}
                                </button>
                                <button
                                    onClick={handleRegenerateCode}
                                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700 text-sm"
                                >
                                    Regenerate
                                </button>
                            </>
                        )}
                    </div>
                </div>
                {canManageInviteCode && isEditingInviteCode && (
                    <div className="mt-3">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={customInviteCode}
                                onChange={(e) => setCustomInviteCode(
                                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
                                )}
                                maxLength={6}
                                placeholder="BARRIE"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-green focus:border-brand-green uppercase text-center text-lg tracking-wider font-mono"
                            />
                            <button
                                onClick={handleSetCustomInviteCode}
                                disabled={savingInviteCode || customInviteCode.trim().length !== 6}
                                className="px-4 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                {savingInviteCode ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">Use exactly 6 letters/numbers (example: BARRIE).</p>
                    </div>
                )}
            </div>

            {/* Members List */}
            <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">Members</h3>
                {canManageActiveAccess && (
                    <p className="mb-3 text-xs text-gray-500">
                        Access level controls which workspaces are visible.
                    </p>
                )}
                <div className="space-y-2">
                    {activeTeamDetails?.members.map(member => {
                        const accessLevel = resolveWorkspaceAccessLevel(member);
                        return (
                            <div
                                key={member.id}
                                className="flex items-center justify-between gap-4 p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="p-2 bg-gray-100 rounded-full">
                                        {member.role === 'owner' ? (
                                            <Shield size={16} className="text-brand-green" />
                                        ) : (
                                            <User size={16} className="text-gray-600" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-medium text-gray-900 truncate">
                                            {member.displayName}
                                            {member.userId === user?.uid && (
                                                <span className="text-gray-500 text-sm ml-2">(You)</span>
                                            )}
                                        </p>
                                        <p className="text-sm text-gray-500 truncate">{member.email}</p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                        member.role === 'owner' ? 'bg-brand-green/20 text-brand-green' :
                                        member.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-700'
                                    }`}>
                                        {member.role}
                                    </span>

                                    {canManageActiveAccess ? (
                                        <select
                                            value={accessLevel}
                                            onChange={(event) => handleChangeAccessLevel(member, event.target.value as WorkspaceAccessLevel)}
                                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700"
                                            title={WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS[accessLevel]}
                                        >
                                            {WORKSPACE_ACCESS_LEVELS.map(level => (
                                                <option key={level} value={level}>
                                                    {WORKSPACE_ACCESS_LEVEL_LABELS[level]}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span
                                            className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700"
                                            title={WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS[accessLevel]}
                                        >
                                            {WORKSPACE_ACCESS_LEVEL_LABELS[accessLevel]}
                                        </span>
                                    )}

                                    {canRemoveActiveMembers && member.userId !== user?.uid && member.role !== 'owner' && (
                                        <button
                                            onClick={() => handleRemoveMember(member.id, member.displayName)}
                                            className="p-1 text-gray-400 hover:text-red-600"
                                            title="Remove member"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Leave Team Button */}
            {isViewingCurrentTeam && (
                <div className="pt-4 border-t border-gray-200">
                    <button
                        onClick={handleLeaveTeam}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium"
                    >
                        <LogOut size={16} />
                        Leave Team
                    </button>
                </div>
            )}
        </div>
    );
};
