/**
 * Team Management Component
 *
 * Allows users to create teams, join via invite code, and manage team members.
 */

import React, { useState, useEffect } from 'react';
import { Users, Copy, Check, Trash2, Shield, User, LogOut, X, Link, PlusCircle } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useTeam } from './contexts/TeamContext';
import { useToast } from './contexts/ToastContext';
import {
    createTeam,
    createPartnerTeam,
    joinTeamByInviteCode,
    getTeamWithMembers,
    getTeamWithMembersByInviteCode,
    getTeamsForPermissionManagement,
    leaveTeam,
    removeMember,
    renameTeam,
    deleteTeam,
    updateMemberAccessLevel,
    updateMemberWorkspaceAccess,
    updateTeamDefaultMemberAccessLevel,
    updateTeamDefaultWorkspaceAccess,
    regenerateInviteCode,
    setInviteCode as setTeamInviteCode
} from '../utils/services/teamService';
import type {
    Team,
    TeamWithMembers,
    TeamMember,
    WorkspaceAccessFeatureKey,
    WorkspaceAccessLevel,
    WorkspaceAccessOverrides,
} from '../utils/masterScheduleTypes';
import {
    getAllowedWorkspaceFeatures,
    resolveWorkspaceAccessLevel,
    WORKSPACE_ACCESS_FEATURES,
    WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS,
    WORKSPACE_ACCESS_LEVEL_LABELS,
    WORKSPACE_ACCESS_LEVELS,
} from '../utils/workspaceAccess';
import { buildInviteLinkForCurrentLocation, normalizeInviteCode } from '../utils/inviteLinks';

const WORKSPACE_FEATURE_LABELS: Record<WorkspaceAccessFeatureKey, string> = {
    workspaceOndemand: 'On Demand',
    workspaceFixedRoute: 'Scheduled Transit',
    workspaceOperations: 'Operations',
    analyticsTransitApp: 'Transit App Data',
    analyticsOdMatrix: 'OD Matrix',
    analyticsCorridorSpeed: 'Corridor Speed',
    analyticsCorridorHeadway: 'Corridor Headway',
    analyticsStudentPass: 'Student Pass',
    analyticsFleetPlan: 'Fleet Plan',
    analyticsResidentialGrowth: 'Residential Growth',
    analyticsNetworkConnections: 'Network Connections',
    analyticsRoutePlanner2: 'Route Planner',
    analyticsShuttlePlanner: 'Shuttle Planner',
    operationsLoadProfiles: 'Load Profiles',
    operationsOperatorDwell: 'Operator Dwell',
};

type WorkspaceSelection = Record<WorkspaceAccessFeatureKey, boolean>;

function buildWorkspaceSelection(
    accessLevel: WorkspaceAccessLevel,
    overrides: WorkspaceAccessOverrides = {},
): WorkspaceSelection {
    const allowed = new Set(getAllowedWorkspaceFeatures(accessLevel, overrides));
    return WORKSPACE_ACCESS_FEATURES.reduce((selection, feature) => {
        selection[feature] = allowed.has(feature);
        return selection;
    }, {} as WorkspaceSelection);
}

function buildWorkspaceOverrides(
    accessLevel: WorkspaceAccessLevel,
    selection: WorkspaceSelection,
): WorkspaceAccessOverrides {
    const baseAllowed = new Set(getAllowedWorkspaceFeatures(accessLevel));
    return WORKSPACE_ACCESS_FEATURES.reduce((overrides, feature) => {
        const selected = selection[feature];
        if (selected !== baseAllowed.has(feature)) {
            overrides[feature] = selected;
        }
        return overrides;
    }, {} as WorkspaceAccessOverrides);
}

interface TeamManagementProps {
    onClose?: () => void;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({ onClose }) => {
    const { user, isGlobalAdmin } = useAuth();
    const { team, refreshTeam } = useTeam();
    const toast = useToast();

    const [isCreating, setIsCreating] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const [teamName, setTeamName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [teamDetails, setTeamDetails] = useState<TeamWithMembers | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [isEditingInviteCode, setIsEditingInviteCode] = useState(false);
    const [customInviteCode, setCustomInviteCode] = useState('');
    const [savingInviteCode, setSavingInviteCode] = useState(false);
    const [teamLookupCode, setTeamLookupCode] = useState('');
    const [teamLookupLoading, setTeamLookupLoading] = useState(false);
    const [managedTeamDetails, setManagedTeamDetails] = useState<TeamWithMembers | null>(null);
    const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
    const [availableTeamsLoading, setAvailableTeamsLoading] = useState(false);
    const [isEditingTeamName, setIsEditingTeamName] = useState(false);
    const [editedTeamName, setEditedTeamName] = useState('');
    const [savingTeamName, setSavingTeamName] = useState(false);
    const [deletingTeam, setDeletingTeam] = useState(false);
    const [savingDefaultAccessLevel, setSavingDefaultAccessLevel] = useState(false);
    const [partnerTeamName, setPartnerTeamName] = useState('');
    const [partnerInviteCode, setPartnerInviteCode] = useState('');
    const [partnerDefaultAccessLevel, setPartnerDefaultAccessLevel] = useState<WorkspaceAccessLevel>('external-planner');
    const [creatingPartnerTeam, setCreatingPartnerTeam] = useState(false);
    const [createdPartnerInviteLink, setCreatedPartnerInviteLink] = useState('');
    const [wizardTeamAccessLevel, setWizardTeamAccessLevel] = useState<WorkspaceAccessLevel>('transit-app-only');
    const [wizardTeamWorkspaceSelection, setWizardTeamWorkspaceSelection] = useState<WorkspaceSelection>(
        () => buildWorkspaceSelection('transit-app-only')
    );
    const [savingWizardTeamAccess, setSavingWizardTeamAccess] = useState(false);
    const [selectedWizardMemberId, setSelectedWizardMemberId] = useState('');
    const [wizardMemberAccessLevel, setWizardMemberAccessLevel] = useState<WorkspaceAccessLevel>('transit-app-only');
    const [wizardMemberWorkspaceSelection, setWizardMemberWorkspaceSelection] = useState<WorkspaceSelection>(
        () => buildWorkspaceSelection('transit-app-only')
    );
    const [savingWizardMemberAccess, setSavingWizardMemberAccess] = useState(false);

    const currentTeamMember = teamDetails?.members.find(m => m.userId === user?.uid);
    const isCurrentTeamOwnerOrAdmin = currentTeamMember?.role === 'owner' || currentTeamMember?.role === 'admin';
    const canLookupTeams = isGlobalAdmin;
    const activeTeamDetails = managedTeamDetails ?? teamDetails;
    const activeTeamId = activeTeamDetails?.id ?? team?.id;
    const activeDefaultAccessLevel: WorkspaceAccessLevel =
        activeTeamDetails?.defaultMemberAccessLevel ?? team?.defaultMemberAccessLevel ?? 'planner';
    const isViewingCurrentTeam = !managedTeamDetails || managedTeamDetails.id === team?.id;
    const canEditActiveTeam = isCurrentTeamOwnerOrAdmin || canLookupTeams;
    const canManageActiveAccess = isCurrentTeamOwnerOrAdmin || canLookupTeams;
    const canRemoveActiveMembers = isCurrentTeamOwnerOrAdmin || canLookupTeams;
    const selectedWizardMember = activeTeamDetails?.members.find(member => member.id === selectedWizardMemberId) ?? null;
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

    useEffect(() => {
        if (!activeTeamDetails) return;

        const nextAccessLevel = activeTeamDetails.defaultMemberAccessLevel ?? 'planner';
        setWizardTeamAccessLevel(nextAccessLevel);
        setWizardTeamWorkspaceSelection(
            buildWorkspaceSelection(nextAccessLevel, activeTeamDetails.defaultMemberWorkspaceOverrides)
        );
    }, [
        activeTeamDetails?.id,
        activeTeamDetails?.defaultMemberAccessLevel,
        JSON.stringify(activeTeamDetails?.defaultMemberWorkspaceOverrides ?? {}),
    ]);

    useEffect(() => {
        if (!activeTeamDetails?.members.length) {
            setSelectedWizardMemberId('');
            return;
        }

        if (!activeTeamDetails.members.some(member => member.id === selectedWizardMemberId)) {
            setSelectedWizardMemberId(activeTeamDetails.members[0].id);
        }
    }, [activeTeamDetails?.id, activeTeamDetails?.members, selectedWizardMemberId]);

    useEffect(() => {
        if (!selectedWizardMember) return;

        const nextAccessLevel = resolveWorkspaceAccessLevel(selectedWizardMember);
        setWizardMemberAccessLevel(nextAccessLevel);
        setWizardMemberWorkspaceSelection(
            buildWorkspaceSelection(nextAccessLevel, selectedWizardMember.workspaceOverrides)
        );
    }, [
        selectedWizardMember?.id,
        selectedWizardMember?.accessLevel,
        JSON.stringify(selectedWizardMember?.workspaceOverrides ?? {}),
    ]);

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
        if (!activeTeamId || !canEditActiveTeam) return;

        try {
            await regenerateInviteCode(activeTeamId);
            toast?.success('New invite code generated');
            setIsEditingInviteCode(false);
            await reloadActiveTeamDetails();
            await loadAvailableTeams();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
        } catch (error) {
            toast?.error('Failed to regenerate code');
        }
    };

    const handleCopyInviteLink = async (codeOverride?: string) => {
        const code = codeOverride ?? activeTeamDetails?.inviteCode ?? team?.inviteCode;
        if (!code) return;

        try {
            const link = buildInviteLinkForCurrentLocation(code);
            await navigator.clipboard.writeText(link);
            setCopiedLink(true);
            toast?.success('Invite link copied!');
            setTimeout(() => setCopiedLink(false), 2000);
        } catch (error) {
            toast?.error('Failed to copy link');
        }
    };

    const handleCreatePartnerTeam = async () => {
        if (!user || !canLookupTeams || !partnerTeamName.trim()) return;

        const normalizedCode = partnerInviteCode.trim()
            ? normalizeInviteCode(partnerInviteCode)
            : null;
        if (partnerInviteCode.trim() && !normalizedCode) {
            toast?.error('Invite code must be exactly 6 letters/numbers');
            return;
        }

        setCreatingPartnerTeam(true);
        try {
            const result = await createPartnerTeam({
                createdBy: user.uid,
                teamName: partnerTeamName.trim(),
                inviteCode: normalizedCode ?? undefined,
                defaultMemberAccessLevel: partnerDefaultAccessLevel,
            });
            const details = await getTeamWithMembers(result.teamId);
            if (details) {
                setManagedTeamDetails(details);
                setTeamLookupCode(details.inviteCode);
            }
            await loadAvailableTeams();
            const inviteLink = buildInviteLinkForCurrentLocation(result.inviteCode);
            setCreatedPartnerInviteLink(inviteLink);
            setPartnerTeamName('');
            setPartnerInviteCode('');
            setPartnerDefaultAccessLevel('external-planner');
            toast?.success(`Created ${partnerTeamName.trim()}`);
        } catch (error: any) {
            console.error('Error creating partner team:', error);
            toast?.error(error?.message || 'Failed to create partner team');
        } finally {
            setCreatingPartnerTeam(false);
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
            setIsEditingTeamName(false);
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
            setIsEditingTeamName(false);
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
        setIsEditingTeamName(false);
    };

    const handleRenameTeam = async () => {
        if (!activeTeamId || !canEditActiveTeam) return;

        const normalizedName = editedTeamName.trim();
        if (!normalizedName) {
            toast?.error('Team name cannot be blank');
            return;
        }

        setSavingTeamName(true);
        try {
            await renameTeam(activeTeamId, normalizedName);
            await reloadActiveTeamDetails();
            await loadAvailableTeams();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            setIsEditingTeamName(false);
            toast?.success('Team name updated');
        } catch (error) {
            console.error('Error renaming team:', error);
            toast?.error('Failed to rename team');
        } finally {
            setSavingTeamName(false);
        }
    };

    const handleDeleteTeam = async () => {
        if (!activeTeamId || !activeTeamDetails || !canEditActiveTeam) return;

        const confirmed = confirm(
            `Delete team "${activeTeamDetails.name}"? This removes the team, invite code, members, and saved schedules. This cannot be undone.`
        );
        if (!confirmed) return;

        setDeletingTeam(true);
        try {
            await deleteTeam(activeTeamId);
            toast?.success(`Deleted ${activeTeamDetails.name}`);
            setManagedTeamDetails(null);
            setTeamLookupCode('');
            setIsEditingTeamName(false);
            setIsEditingInviteCode(false);
            await loadAvailableTeams();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
        } catch (error) {
            console.error('Error deleting team:', error);
            toast?.error('Failed to delete team');
        } finally {
            setDeletingTeam(false);
        }
    };

    const handleSetCustomInviteCode = async () => {
        if (!activeTeamId || !canEditActiveTeam) return;
        const normalized = customInviteCode.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(normalized)) {
            toast?.error('Invite code must be exactly 6 letters/numbers');
            return;
        }

        setSavingInviteCode(true);
        try {
            await setTeamInviteCode(activeTeamId, normalized);
            await reloadActiveTeamDetails();
            await loadAvailableTeams();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
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

    const handleChangeDefaultAccessLevel = async (nextAccessLevel: WorkspaceAccessLevel) => {
        if (!activeTeamId || !canEditActiveTeam) return;

        setSavingDefaultAccessLevel(true);
        try {
            await updateTeamDefaultMemberAccessLevel(activeTeamId, nextAccessLevel);
            await reloadActiveTeamDetails();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            toast?.success('Default access for new members updated');
        } catch (error) {
            console.error('Error updating default member access:', error);
            toast?.error('Failed to update default access');
        } finally {
            setSavingDefaultAccessLevel(false);
        }
    };

    const handleWizardTeamAccessLevelChange = (nextAccessLevel: WorkspaceAccessLevel) => {
        setWizardTeamAccessLevel(nextAccessLevel);
        setWizardTeamWorkspaceSelection(buildWorkspaceSelection(nextAccessLevel));
    };

    const handleWizardMemberAccessLevelChange = (nextAccessLevel: WorkspaceAccessLevel) => {
        setWizardMemberAccessLevel(nextAccessLevel);
        setWizardMemberWorkspaceSelection(buildWorkspaceSelection(nextAccessLevel));
    };

    const handleSaveWizardTeamAccess = async () => {
        if (!activeTeamId || !canLookupTeams) return;

        setSavingWizardTeamAccess(true);
        try {
            await updateTeamDefaultWorkspaceAccess(
                activeTeamId,
                wizardTeamAccessLevel,
                buildWorkspaceOverrides(wizardTeamAccessLevel, wizardTeamWorkspaceSelection)
            );
            await reloadActiveTeamDetails();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            toast?.success('Team default workspace access saved');
        } catch (error) {
            console.error('Error saving team workspace access:', error);
            toast?.error('Failed to save team workspace access');
        } finally {
            setSavingWizardTeamAccess(false);
        }
    };

    const handleSaveWizardMemberAccess = async () => {
        if (!activeTeamId || !selectedWizardMember || !canLookupTeams) return;

        setSavingWizardMemberAccess(true);
        try {
            await updateMemberWorkspaceAccess(
                activeTeamId,
                selectedWizardMember.id,
                wizardMemberAccessLevel,
                buildWorkspaceOverrides(wizardMemberAccessLevel, wizardMemberWorkspaceSelection)
            );
            await reloadActiveTeamDetails();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            toast?.success(`Workspace access saved for ${selectedWizardMember.displayName}`);
        } catch (error) {
            console.error('Error saving member workspace access:', error);
            toast?.error('Failed to save member workspace access');
        } finally {
            setSavingWizardMemberAccess(false);
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
                        {isEditingTeamName ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <input
                                    type="text"
                                    value={editedTeamName}
                                    onChange={(event) => setEditedTeamName(event.target.value)}
                                    className="rounded-lg border border-gray-300 px-3 py-2 text-xl font-bold text-gray-900 focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                                    autoFocus
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleRenameTeam}
                                        disabled={savingTeamName || !editedTeamName.trim()}
                                        className="px-3 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                    >
                                        {savingTeamName ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                        onClick={() => setIsEditingTeamName(false)}
                                        className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-2xl font-bold text-gray-900">{activeTeamDetails?.name ?? team.name}</h2>
                                {canEditActiveTeam && (
                                    <>
                                        <button
                                            onClick={() => {
                                                setEditedTeamName(activeTeamDetails?.name ?? team.name);
                                                setIsEditingTeamName(true);
                                            }}
                                            className="px-2 py-1 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                        >
                                            Rename
                                        </button>
                                        <button
                                            onClick={handleDeleteTeam}
                                            disabled={deletingTeam}
                                            className="px-2 py-1 border border-red-200 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {deletingTeam ? 'Deleting...' : 'Delete'}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                        <p className="text-sm text-gray-500">
                            {activeTeamDetails?.memberCount || 0} members
                            {!isViewingCurrentTeam && <span className="ml-2 text-blue-600">Viewing by team code</span>}
                        </p>
                    </div>
                </div>
            </div>

            {canLookupTeams && (
                <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
                    <div className="flex items-center gap-2 mb-3">
                        <PlusCircle size={18} className="text-brand-green" />
                        <p className="text-sm font-semibold text-gray-900">Create partner team</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr]">
                        <input
                            type="text"
                            value={partnerTeamName}
                            onChange={(event) => setPartnerTeamName(event.target.value)}
                            placeholder="Team name, e.g. Lane Transit"
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-green focus:border-brand-green"
                        />
                        <input
                            type="text"
                            value={partnerInviteCode}
                            onChange={(event) => setPartnerInviteCode(
                                event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
                            )}
                            placeholder="Code optional"
                            maxLength={6}
                            className="px-3 py-2 border border-gray-300 rounded-lg font-mono uppercase tracking-wider focus:ring-2 focus:ring-brand-green focus:border-brand-green"
                        />
                        <select
                            value={partnerDefaultAccessLevel}
                            onChange={(event) => setPartnerDefaultAccessLevel(event.target.value as WorkspaceAccessLevel)}
                            className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-green focus:border-brand-green"
                        >
                            {WORKSPACE_ACCESS_LEVELS.map(level => (
                                <option key={level} value={level}>
                                    {WORKSPACE_ACCESS_LEVEL_LABELS[level]}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-gray-500">
                            Recommended for external agencies: External agency planner. The invite link will auto-join users after sign-in.
                        </p>
                        <button
                            onClick={handleCreatePartnerTeam}
                            disabled={creatingPartnerTeam || !partnerTeamName.trim()}
                            className="px-4 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {creatingPartnerTeam ? 'Creating...' : 'Create team'}
                        </button>
                    </div>
                    {createdPartnerInviteLink && (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <p className="text-xs font-semibold text-emerald-800">Invite link ready</p>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                <input
                                    readOnly
                                    value={createdPartnerInviteLink}
                                    className="flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-700"
                                />
                                <button
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(createdPartnerInviteLink);
                                        toast?.success('Invite link copied!');
                                    }}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
                                >
                                    <Copy size={16} />
                                    Copy
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {canLookupTeams && activeTeamDetails && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-6">
                    <div className="mb-4">
                        <p className="text-sm font-semibold text-purple-900">Developer Access Wizard</p>
                        <p className="text-xs text-purple-700">
                            Select a team, choose a preset, then fine-tune exactly which workspaces are visible.
                        </p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-lg border border-purple-100 bg-white p-4">
                            <p className="text-xs font-bold uppercase tracking-wide text-purple-700">1. Team</p>
                            <select
                                value={activeTeamDetails.id}
                                onChange={(event) => {
                                    const selectedTeam = availableTeams.find(teamOption => teamOption.id === event.target.value);
                                    if (selectedTeam) void handleSelectTeam(selectedTeam);
                                }}
                                className="mt-2 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800"
                            >
                                {availableTeams.map(teamOption => (
                                    <option key={teamOption.id} value={teamOption.id}>
                                        {teamOption.name}
                                    </option>
                                ))}
                                {!availableTeams.some(teamOption => teamOption.id === activeTeamDetails.id) && (
                                    <option value={activeTeamDetails.id}>{activeTeamDetails.name}</option>
                                )}
                            </select>
                            <p className="mt-2 text-xs text-gray-500">
                                Active team: <span className="font-semibold">{activeTeamDetails.name}</span>
                            </p>
                        </div>

                        <div className="rounded-lg border border-purple-100 bg-white p-4">
                            <p className="text-xs font-bold uppercase tracking-wide text-purple-700">2. Invite link</p>
                            <button
                                onClick={() => handleCopyInviteLink(activeTeamDetails.inviteCode)}
                                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-purple-200 px-3 py-2 text-sm font-bold text-purple-800 hover:bg-purple-50"
                            >
                                <Link size={16} />
                                Copy invite link
                            </button>
                            <p className="mt-2 text-xs text-gray-500">
                                New users who join receive the team default access below.
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-purple-100 bg-white p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-purple-700">
                                    3. Team default access
                                </p>
                                <p className="text-xs text-gray-500">
                                    This applies to future users who join with the invite link.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <select
                                    value={wizardTeamAccessLevel}
                                    onChange={(event) => handleWizardTeamAccessLevelChange(event.target.value as WorkspaceAccessLevel)}
                                    className="rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800"
                                >
                                    {WORKSPACE_ACCESS_LEVELS.map(level => (
                                        <option key={level} value={level}>
                                            {WORKSPACE_ACCESS_LEVEL_LABELS[level]}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={handleSaveWizardTeamAccess}
                                    disabled={savingWizardTeamAccess}
                                    className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50"
                                >
                                    {savingWizardTeamAccess ? 'Saving...' : 'Save team default'}
                                </button>
                            </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {WORKSPACE_ACCESS_FEATURES.map(feature => (
                                <label key={feature} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={wizardTeamWorkspaceSelection[feature]}
                                        onChange={(event) => setWizardTeamWorkspaceSelection(selection => ({
                                            ...selection,
                                            [feature]: event.target.checked,
                                        }))}
                                        className="h-4 w-4 rounded border-gray-300 text-purple-700 focus:ring-purple-600"
                                    />
                                    {WORKSPACE_FEATURE_LABELS[feature]}
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-purple-100 bg-white p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-purple-700">
                                    4. User-specific access
                                </p>
                                <p className="text-xs text-gray-500">
                                    Override access for an individual team member when needed.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <select
                                    value={selectedWizardMemberId}
                                    onChange={(event) => setSelectedWizardMemberId(event.target.value)}
                                    className="rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800"
                                >
                                    {activeTeamDetails.members.map(member => (
                                        <option key={member.id} value={member.id}>
                                            {member.displayName} ({member.email})
                                        </option>
                                    ))}
                                </select>
                                <select
                                    value={wizardMemberAccessLevel}
                                    onChange={(event) => handleWizardMemberAccessLevelChange(event.target.value as WorkspaceAccessLevel)}
                                    disabled={!selectedWizardMember}
                                    className="rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 disabled:opacity-50"
                                >
                                    {WORKSPACE_ACCESS_LEVELS.map(level => (
                                        <option key={level} value={level}>
                                            {WORKSPACE_ACCESS_LEVEL_LABELS[level]}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={handleSaveWizardMemberAccess}
                                    disabled={savingWizardMemberAccess || !selectedWizardMember}
                                    className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50"
                                >
                                    {savingWizardMemberAccess ? 'Saving...' : 'Save user access'}
                                </button>
                            </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {WORKSPACE_ACCESS_FEATURES.map(feature => (
                                <label key={feature} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={wizardMemberWorkspaceSelection[feature]}
                                        onChange={(event) => setWizardMemberWorkspaceSelection(selection => ({
                                            ...selection,
                                            [feature]: event.target.checked,
                                        }))}
                                        disabled={!selectedWizardMember}
                                        className="h-4 w-4 rounded border-gray-300 text-purple-700 focus:ring-purple-600 disabled:opacity-50"
                                    />
                                    {WORKSPACE_FEATURE_LABELS[feature]}
                                </label>
                            ))}
                        </div>
                    </div>

                    <p className="mt-3 text-xs text-purple-700">
                        Lane Transit setup: select <span className="font-semibold">Transit App Data only</span> and leave only Transit App Data checked.
                    </p>
                </div>
            )}

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
                        <button
                            onClick={() => handleCopyInviteLink()}
                            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700"
                            title="Copy invite link"
                        >
                            {copiedLink ? <Check size={20} /> : <Link size={20} />}
                        </button>
                        {canEditActiveTeam && (
                            <>
                                <button
                                    onClick={() => {
                                        if (!isEditingInviteCode) setCustomInviteCode(activeTeamDetails?.inviteCode ?? team.inviteCode);
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
                <p className="mt-3 text-xs text-gray-500">
                    Share the invite link for easiest setup. Users will be asked to sign in, then joined automatically.
                </p>
                {canEditActiveTeam && isEditingInviteCode && (
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

            {/* Default Access */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-gray-900">Default access for new members</p>
                        <p className="text-xs text-gray-500">
                            New users who join with this invite code receive this workspace access level.
                        </p>
                    </div>
                    {canEditActiveTeam ? (
                        <select
                            value={activeDefaultAccessLevel}
                            onChange={(event) => handleChangeDefaultAccessLevel(event.target.value as WorkspaceAccessLevel)}
                            disabled={savingDefaultAccessLevel}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
                            title={WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS[activeDefaultAccessLevel]}
                        >
                            {WORKSPACE_ACCESS_LEVELS.map(level => (
                                <option key={level} value={level}>
                                    {WORKSPACE_ACCESS_LEVEL_LABELS[level]}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <span
                            className="inline-flex rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700"
                            title={WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS[activeDefaultAccessLevel]}
                        >
                            {WORKSPACE_ACCESS_LEVEL_LABELS[activeDefaultAccessLevel]}
                        </span>
                    )}
                </div>
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
