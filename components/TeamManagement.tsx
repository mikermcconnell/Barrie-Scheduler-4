/**
 * Team Management Component
 *
 * Allows users to create teams, join via invite code, and manage team members.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    Users,
    Copy,
    Check,
    Trash2,
    Shield,
    User,
    LogOut,
    X,
    Link,
    PlusCircle,
    Eye,
    Database,
    Edit2,
    Search,
    FileText,
    Download,
    HardDrive,
    Clock,
    FolderOpen,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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
    setInviteCode as setTeamInviteCode,
    updateTeamDataSourceTeamIds
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
import {
    buildWorkspaceSelectionFromPackage,
    getWorkspaceAccessPackage,
    WORKSPACE_ACCESS_PACKAGES,
    type WorkspaceAccessPackageId,
} from '../utils/workspaceAccessPackages';
import {
    getAllFiles,
    getAllUploadedFilesForAdmin,
    type SavedFile,
} from '../utils/services/dataService';
import { buildWorkspaceAccessPreview } from '../utils/workspaceAccessPreview';
import { buildInviteLinkForCurrentLocation, normalizeInviteCode } from '../utils/inviteLinks';
import { WorkspaceAccessAppPreview } from './WorkspaceAccessAppPreview';
import { filterUploadsForTeam } from '../utils/adminUploadScope';

const WORKSPACE_FEATURE_LABELS: Record<WorkspaceAccessFeatureKey, string> = {
    workspaceOndemand: 'On Demand',
    workspaceFixedRoute: 'Scheduled Transit',
    workspaceOperations: 'Operations',
    workspaceParking: 'Parking',
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
    analyticsCouncilIntelligence: 'Council Intelligence',
    operationsLoadProfiles: 'Load Profiles',
    operationsOperatorDwell: 'Dwell Incident Review',
};

type WorkspaceSelection = Record<WorkspaceAccessFeatureKey, boolean>;
type TeamManagementTab = 'users' | 'access' | 'uploads' | 'data' | 'developer';
type UploadAdminScope = 'team' | 'mine' | 'all';
type UploadFileFilter = 'all' | SavedFile['type'];

const TEAM_MANAGEMENT_TABS: Array<{ id: TeamManagementTab; label: string; adminOnly?: boolean }> = [
    { id: 'users', label: 'Users' },
    { id: 'access', label: 'Access' },
    { id: 'uploads', label: 'Uploads', adminOnly: true },
    { id: 'data', label: 'Data Sources', adminOnly: true },
    { id: 'developer', label: 'Developer Tools', adminOnly: true },
];

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

function isPermissionDeniedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
    return code.includes('permission-denied') || message.toLowerCase().includes('permission');
}

function getAccessSaveErrorMessage(error: unknown): string {
    if (isPermissionDeniedError(error)) {
        return 'Permission denied while saving access. Try again after refreshing your admin session.';
    }
    return 'Failed to save access. Please try again.';
}

interface TeamManagementProps {
    onClose?: () => void;
    fullScreen?: boolean;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({ onClose, fullScreen = false }) => {
    const { user, isGlobalAdmin } = useAuth();
    const {
        team,
        actualTeam,
        developerPreview,
        refreshTeam,
        startDeveloperPreview,
    } = useTeam();
    const toast = useToast();
    const queryClient = useQueryClient();

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
    const [partnerAccessPackageId, setPartnerAccessPackageId] = useState<WorkspaceAccessPackageId>('transit-app-only');
    const [partnerDefaultAccessLevel, setPartnerDefaultAccessLevel] = useState<WorkspaceAccessLevel>('transit-app-only');
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
    const [transitAppSourceTeamId, setTransitAppSourceTeamId] = useState('');
    const [performanceSourceTeamId, setPerformanceSourceTeamId] = useState('');
    const [savingDataSources, setSavingDataSources] = useState(false);
    const [activeTab, setActiveTab] = useState<TeamManagementTab>('users');
    const [uploadScope, setUploadScope] = useState<UploadAdminScope>('team');
    const [uploadedFiles, setUploadedFiles] = useState<SavedFile[]>([]);
    const [uploadsLoading, setUploadsLoading] = useState(false);
    const [uploadsError, setUploadsError] = useState('');
    const [uploadSearch, setUploadSearch] = useState('');
    const [uploadFileFilter, setUploadFileFilter] = useState<UploadFileFilter>('all');

    const currentTeamMember = teamDetails?.members.find(m => m.userId === user?.uid);
    const isCurrentTeamOwnerOrAdmin = currentTeamMember?.role === 'owner' || currentTeamMember?.role === 'admin';
    const canLookupTeams = isGlobalAdmin;
    const supportTeamDetails = developerPreview?.team && 'members' in developerPreview.team
        ? developerPreview.team as TeamWithMembers
        : null;
    const activeTeamDetails = managedTeamDetails ?? supportTeamDetails ?? teamDetails;
    const activeTeamId = activeTeamDetails?.id ?? actualTeam?.id;
    const activeDefaultAccessLevel: WorkspaceAccessLevel =
        activeTeamDetails?.defaultMemberAccessLevel ?? actualTeam?.defaultMemberAccessLevel ?? 'planner';
    const isViewingCurrentTeam = Boolean(actualTeam && activeTeamId === actualTeam.id);
    const hasActiveDeveloperEdit = Boolean(
        canLookupTeams &&
        developerPreview?.mode === 'edit' &&
        developerPreview.team.id === activeTeamId
    );
    const canEditActiveTeam = (isViewingCurrentTeam && isCurrentTeamOwnerOrAdmin) || hasActiveDeveloperEdit;
    const canManageActiveAccess = (isViewingCurrentTeam && isCurrentTeamOwnerOrAdmin) || hasActiveDeveloperEdit;
    const canRemoveActiveMembers = (isViewingCurrentTeam && isCurrentTeamOwnerOrAdmin) || hasActiveDeveloperEdit;
    const selectedWizardMember = activeTeamDetails?.members.find(member => member.id === selectedWizardMemberId) ?? null;
    const wizardTeamAccessPreview = useMemo(() => buildWorkspaceAccessPreview({
        displayName: activeTeamDetails ? `${activeTeamDetails.name} invite user` : 'Invite user',
        accessLevel: wizardTeamAccessLevel,
        overrides: buildWorkspaceOverrides(wizardTeamAccessLevel, wizardTeamWorkspaceSelection),
    }), [
        activeTeamDetails?.name,
        wizardTeamAccessLevel,
        JSON.stringify(wizardTeamWorkspaceSelection),
    ]);
    const wizardMemberAccessPreview = useMemo(() => buildWorkspaceAccessPreview({
        displayName: selectedWizardMember?.displayName || selectedWizardMember?.email || 'Selected user',
        accessLevel: wizardMemberAccessLevel,
        overrides: buildWorkspaceOverrides(wizardMemberAccessLevel, wizardMemberWorkspaceSelection),
    }), [
        selectedWizardMember?.displayName,
        selectedWizardMember?.email,
        wizardMemberAccessLevel,
        JSON.stringify(wizardMemberWorkspaceSelection),
    ]);
    const filteredAvailableTeams = availableTeams.filter(availableTeam => {
        const filter = teamLookupCode.trim().toLowerCase();
        if (!filter) return true;
        return availableTeam.name.toLowerCase().includes(filter) ||
            availableTeam.inviteCode.toLowerCase().includes(filter);
    });
    const dataSourceTeamOptions = availableTeams.filter(availableTeam => availableTeam.id !== activeTeamId);
    const visibleTabs = useMemo(
        () => TEAM_MANAGEMENT_TABS.filter(tab => {
            if (tab.id === 'access') return canManageActiveAccess;
            return !tab.adminOnly || canLookupTeams;
        }),
        [canLookupTeams, canManageActiveAccess]
    );
    const transitAppSourceTeam = availableTeams.find(teamOption => teamOption.id === transitAppSourceTeamId) ?? null;
    const performanceSourceTeam = availableTeams.find(teamOption => teamOption.id === performanceSourceTeamId) ?? null;

    // Load full team details with members
    useEffect(() => {
        if (developerPreview) {
            void getTeamWithMembers(developerPreview.team.id)
                .then(details => setManagedTeamDetails(details))
                .catch(error => {
                    console.error('Error loading active support team:', error);
                    toast?.error('Failed to load the active support team');
                });
            return;
        }
        if (actualTeam) {
            setManagedTeamDetails(null);
            loadTeamDetails();
        }
    }, [actualTeam, developerPreview?.team.id]);

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

    useEffect(() => {
        if (!activeTeamDetails) return;
        setTransitAppSourceTeamId(activeTeamDetails.dataSourceTeamIds?.transitApp ?? '');
        setPerformanceSourceTeamId(activeTeamDetails.dataSourceTeamIds?.performance ?? '');
    }, [
        activeTeamDetails?.id,
        activeTeamDetails?.dataSourceTeamIds?.transitApp,
        activeTeamDetails?.dataSourceTeamIds?.performance,
    ]);

    useEffect(() => {
        if (visibleTabs.some(tab => tab.id === activeTab)) return;
        setActiveTab('users');
    }, [activeTab, visibleTabs]);

    const loadTeamDetails = async () => {
        if (!actualTeam) return;

        try {
            const details = await getTeamWithMembers(actualTeam.id);
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
        } catch {
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
        } catch {
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
        } catch {
            toast?.error('Failed to copy link');
        }
    };

    const handleCreatePartnerTeam = async () => {
        if (!user || !canLookupTeams || developerPreview?.mode === 'inspect' || !partnerTeamName.trim()) return;

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
                defaultMemberWorkspaceOverrides: getWorkspaceAccessPackage(partnerAccessPackageId).workspaceOverrides,
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
            setPartnerAccessPackageId('transit-app-only');
            setPartnerDefaultAccessLevel(getWorkspaceAccessPackage('transit-app-only').accessLevel);
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
            if (!actualTeam && !developerPreview && !managedTeamDetails && teams.length > 0) {
                const details = await getTeamWithMembers(teams[0].id);
                if (details) {
                    setManagedTeamDetails(details);
                    setTeamLookupCode(details.inviteCode);
                }
            }
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
        if (!actualTeam) {
            const firstTeam = availableTeams[0];
            if (firstTeam) void handleSelectTeam(firstTeam);
            return;
        }
        setManagedTeamDetails(null);
        setTeamLookupCode('');
        setIsEditingInviteCode(false);
        setIsEditingTeamName(false);
    };

    const handleSaveDataSources = async () => {
        if (!activeTeamId || !canEditActiveTeam) return;

        setSavingDataSources(true);
        try {
            await updateTeamDataSourceTeamIds(activeTeamId, {
                transitApp: transitAppSourceTeamId || undefined,
                performance: performanceSourceTeamId || undefined,
            });
            await Promise.all([
                reloadActiveTeamDetails(),
                queryClient.invalidateQueries({ queryKey: ['performanceMetadata'] }),
                queryClient.invalidateQueries({ queryKey: ['performanceOverview'] }),
                queryClient.invalidateQueries({ queryKey: ['performanceData'] }),
            ]);
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            toast?.success('Data sources saved');
        } catch (error) {
            console.error('Error saving data sources:', error);
            toast?.error(isPermissionDeniedError(error)
                ? 'Permission denied while saving data sources. Refresh your admin session and try again.'
                : 'Failed to save data sources');
        } finally {
            setSavingDataSources(false);
        }
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
        } catch {
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
        } catch {
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
        } catch {
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

    const handlePartnerPackageChange = (packageId: WorkspaceAccessPackageId) => {
        const pkg = getWorkspaceAccessPackage(packageId);
        setPartnerAccessPackageId(packageId);
        setPartnerDefaultAccessLevel(pkg.accessLevel);
    };

    const handleWizardTeamPackageChange = (packageId: WorkspaceAccessPackageId) => {
        const pkg = getWorkspaceAccessPackage(packageId);
        setWizardTeamAccessLevel(pkg.accessLevel);
        setWizardTeamWorkspaceSelection(buildWorkspaceSelectionFromPackage(packageId));
    };

    const handleWizardMemberPackageChange = (packageId: WorkspaceAccessPackageId) => {
        const pkg = getWorkspaceAccessPackage(packageId);
        setWizardMemberAccessLevel(pkg.accessLevel);
        setWizardMemberWorkspaceSelection(buildWorkspaceSelectionFromPackage(packageId));
    };

    const handlePreviewTeamDefault = async () => {
        if (!activeTeamDetails || !canLookupTeams) return;

        try {
            await startDeveloperPreview({
                team: activeTeamDetails,
                mode: 'inspect',
                accessLevel: wizardTeamAccessLevel,
                workspaceOverrides: buildWorkspaceOverrides(wizardTeamAccessLevel, wizardTeamWorkspaceSelection),
                role: 'member',
                displayName: `${activeTeamDetails.name} invite user`,
                sourceLabel: `${activeTeamDetails.name} team default`,
                reason: 'Preview team default access',
            });
            toast?.success(`Inspecting ${activeTeamDetails.name} team default`);
            onClose?.();
        } catch (error) {
            console.error('Unable to start team inspection:', error);
            toast?.error('Unable to start the inspection session. Confirm your scheduler administrator access.');
        }
    };

    const handlePreviewSelectedMember = async () => {
        if (!activeTeamDetails || !selectedWizardMember || !canLookupTeams) return;

        try {
            await startDeveloperPreview({
                team: activeTeamDetails,
                mode: 'inspect',
                accessLevel: wizardMemberAccessLevel,
                workspaceOverrides: buildWorkspaceOverrides(wizardMemberAccessLevel, wizardMemberWorkspaceSelection),
                role: selectedWizardMember.role,
                displayName: selectedWizardMember.displayName || selectedWizardMember.email || 'Selected user',
                email: selectedWizardMember.email,
                sourceLabel: selectedWizardMember.displayName || selectedWizardMember.email || 'selected user',
                userId: selectedWizardMember.userId,
                reason: 'Preview selected access settings',
            });
            toast?.success(`Inspecting ${activeTeamDetails.name} as ${selectedWizardMember.displayName || selectedWizardMember.email}`);
            onClose?.();
        } catch (error) {
            console.error('Unable to start selected settings inspection:', error);
            toast?.error('Unable to start the inspection session.');
        }
    };

    const handleViewAsSavedMember = async () => {
        if (!activeTeamDetails || !selectedWizardMember || !canLookupTeams) return;

        const memberLabel = selectedWizardMember.displayName || selectedWizardMember.email || 'selected user';
        try {
            await startDeveloperPreview({
                team: activeTeamDetails,
                mode: 'inspect',
                accessLevel: resolveWorkspaceAccessLevel(selectedWizardMember),
                workspaceOverrides: selectedWizardMember.workspaceOverrides,
                role: selectedWizardMember.role,
                displayName: memberLabel,
                email: selectedWizardMember.email,
                sourceLabel: `${memberLabel} (saved access)`,
                userId: selectedWizardMember.userId,
                reason: `Inspect saved access for ${memberLabel}`,
            });
            toast?.success(`Inspecting ${activeTeamDetails.name} as ${memberLabel}`);
            onClose?.();
        } catch (error) {
            console.error('Unable to start saved-user inspection:', error);
            toast?.error('Unable to start the inspection session.');
        }
    };

    const handleStartDeveloperEdit = async () => {
        if (!activeTeamDetails || !user || !canLookupTeams) return;

        const reason = window.prompt(
            `Why do you need developer edit access to ${activeTeamDetails.name}? This will be recorded in the audit log.`
        )?.trim();
        if (!reason) return;
        if (!window.confirm(
            `Start a 30-minute developer edit session for ${activeTeamDetails.name}? Changes will affect the live team data.`
        )) return;

        try {
            await startDeveloperPreview({
                team: activeTeamDetails,
                mode: 'edit',
                accessLevel: 'internal',
                role: 'owner',
                displayName: user.displayName || user.email || 'Developer administrator',
                email: user.email || undefined,
                sourceLabel: 'developer administrator',
                userId: user.uid,
                reason,
            });
            toast?.success(`Developer edit access started for ${activeTeamDetails.name}`);
            onClose?.();
        } catch (error) {
            console.error('Unable to start developer edit session:', error);
            toast?.error('Unable to start developer edit access. Confirm your scheduler administrator claim.');
        }
    };

    const handleSaveWizardTeamAccess = async () => {
        if (!activeTeamId || !canEditActiveTeam) return;

        setSavingWizardTeamAccess(true);
        try {
            const saveTeamAccess = () => updateTeamDefaultWorkspaceAccess(
                activeTeamId,
                wizardTeamAccessLevel,
                buildWorkspaceOverrides(wizardTeamAccessLevel, wizardTeamWorkspaceSelection)
            );

            try {
                await saveTeamAccess();
            } catch (error) {
                if (!isPermissionDeniedError(error) || !user) throw error;
                await user.getIdToken(true);
                await saveTeamAccess();
            }

            await reloadActiveTeamDetails();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            toast?.success('Team default workspace access saved');
        } catch (error) {
            console.error('Error saving team workspace access:', error);
            toast?.error(getAccessSaveErrorMessage(error));
        } finally {
            setSavingWizardTeamAccess(false);
        }
    };

    const handleSaveWizardMemberAccess = async () => {
        if (!activeTeamId || !selectedWizardMember || !canManageActiveAccess) return;

        setSavingWizardMemberAccess(true);
        try {
            const saveMemberAccess = () => updateMemberWorkspaceAccess(
                activeTeamId,
                selectedWizardMember.id,
                wizardMemberAccessLevel,
                buildWorkspaceOverrides(wizardMemberAccessLevel, wizardMemberWorkspaceSelection)
            );

            try {
                await saveMemberAccess();
            } catch (error) {
                if (!isPermissionDeniedError(error) || !user) throw error;
                await user.getIdToken(true);
                await saveMemberAccess();
            }

            await reloadActiveTeamDetails();
            if (isViewingCurrentTeam) {
                await refreshTeam();
            }
            toast?.success(`Workspace access saved for ${selectedWizardMember.displayName}`);
        } catch (error) {
            console.error('Error saving member workspace access:', error);
            toast?.error(getAccessSaveErrorMessage(error));
        } finally {
            setSavingWizardMemberAccess(false);
        }
    };

    const loadUploadedFiles = async () => {
        if (!user || activeTab !== 'uploads') return;

        setUploadsLoading(true);
        setUploadsError('');
        try {
            const files = canLookupTeams && uploadScope !== 'mine'
                ? await getAllUploadedFilesForAdmin()
                : await getAllFiles(user.uid);

            if (uploadScope === 'team') {
                setUploadedFiles(filterUploadsForTeam(files, activeTeamId));
            } else {
                setUploadedFiles(files);
            }
        } catch (error) {
            console.error('Error loading uploads:', error);
            setUploadsError('Failed to load uploads.');
        } finally {
            setUploadsLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'uploads') {
            void loadUploadedFiles();
        }
    }, [activeTab, uploadScope, activeTeamId, user?.uid, canLookupTeams]);

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (date: Date) => new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);

    const getFileCategoryLabel = (type: SavedFile['type']) => {
        switch (type) {
            case 'schedule_master':
                return 'Master Schedule';
            case 'rideco':
                return 'RideCo';
            case 'barrie_tod':
                return 'Barrie TOD';
            default:
                return 'Other';
        }
    };

    const getUploaderLabel = (file: SavedFile) => (
        file.ownerDisplayName || file.ownerEmail || file.ownerUserId || 'Unknown user'
    );

    const filteredUploadedFiles = uploadedFiles.filter(file => {
        const query = uploadSearch.trim().toLowerCase();
        const matchesSearch = !query ||
            file.name.toLowerCase().includes(query) ||
            getUploaderLabel(file).toLowerCase().includes(query) ||
            file.teamNameAtUpload?.toLowerCase().includes(query) ||
            file.teamIdAtUpload?.toLowerCase().includes(query) ||
            file.resolvedTeamName?.toLowerCase().includes(query) ||
            file.resolvedTeamId?.toLowerCase().includes(query);
        const matchesType = uploadFileFilter === 'all' || file.type === uploadFileFilter;
        return matchesSearch && matchesType;
    });

    // No Team State - Create or Join
    if (!team && !canLookupTeams) {
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
                    Join an existing team or create a new team to get started. Workspaces stay hidden until access is assigned in Team Management.
                </p>

                <div className="space-y-4">
                    {/* Create Team Section */}
                    {!isJoining && (
                        <div className="border border-gray-200 rounded-lg p-6">
                            <h3 className="font-semibold text-gray-900 mb-3">Create New Team</h3>
                            <p className="mb-3 text-sm text-gray-500">
                                This creates the team and makes you the owner. You can grant workspace access after setup.
                            </p>

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

    if (canLookupTeams && !activeTeamDetails) {
        return (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-gray-200 bg-white p-8">
                <div className="text-center">
                    <Users className="mx-auto mb-3 text-brand-green" size={28} />
                    <p className="font-bold text-gray-900">Loading developer team directory...</p>
                    <p className="mt-1 text-sm text-gray-500">No home-team membership is required.</p>
                </div>
            </div>
        );
    }

    // Has Team - Show Team Admin Command Center
    return (
        <div className={fullScreen
            ? 'relative h-full w-full overflow-hidden bg-white'
            : 'relative w-full max-w-7xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'
        }>
            {onClose && (
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 z-20 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                    <X size={20} />
                </button>
            )}

            <div className={fullScreen
                ? 'grid h-full min-h-0 lg:grid-cols-[300px_1fr]'
                : 'grid min-h-[680px] lg:grid-cols-[300px_1fr]'
            }>
                <aside className="border-b border-gray-200 bg-gray-50 p-4 lg:border-b-0 lg:border-r">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-xl bg-brand-green/10 p-2 text-brand-green">
                            <Users size={22} />
                        </div>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Team Admin</p>
                            <h2 className="text-lg font-black text-gray-900">Command Center</h2>
                        </div>
                    </div>

                    {canLookupTeams ? (
                        <>
                            <label className="text-xs font-bold uppercase tracking-wide text-gray-500">Find team</label>
                            <div className="mt-1 flex gap-2">
                                <div className="relative min-w-0 flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                    <input
                                        type="text"
                                        value={teamLookupCode}
                                        onChange={(e) => setTeamLookupCode(e.target.value.toUpperCase())}
                                        placeholder="Name or code"
                                        className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
                                    />
                                </div>
                                <button
                                    onClick={handleLookupTeam}
                                    disabled={teamLookupLoading || !/^[A-Z0-9]{6}$/.test(teamLookupCode.trim().toUpperCase())}
                                    className="rounded-lg bg-brand-green px-3 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Load by exact 6-character invite code"
                                >
                                    Load
                                </button>
                            </div>

                            {!isViewingCurrentTeam && actualTeam && (
                                <button
                                    onClick={handleResetTeamLookup}
                                    className="mt-3 w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
                                >
                                    Back to my team
                                </button>
                            )}

                            <div className="mt-3 max-h-[460px] overflow-y-auto rounded-xl border border-gray-200 bg-white">
                                {availableTeamsLoading ? (
                                    <p className="px-3 py-3 text-sm text-gray-500">Loading teams...</p>
                                ) : filteredAvailableTeams.length === 0 ? (
                                    <p className="px-3 py-3 text-sm text-gray-500">No teams found.</p>
                                ) : (
                                    filteredAvailableTeams.map(availableTeam => {
                                        const isActiveTeam = availableTeam.id === activeTeamDetails?.id;
                                        return (
                                            <button
                                                key={availableTeam.id}
                                                onClick={() => handleSelectTeam(availableTeam)}
                                                disabled={teamLookupLoading}
                                                className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-green-50 disabled:opacity-50 ${
                                                    isActiveTeam ? 'bg-green-50 text-green-900' : 'text-gray-700'
                                                }`}
                                            >
                                                <span className="truncate font-semibold">{availableTeam.name}</span>
                                                <span className="font-mono text-xs text-gray-500">{availableTeam.inviteCode}</span>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="rounded-xl border border-gray-200 bg-white p-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Current team</p>
                            <p className="mt-1 font-bold text-gray-900">{activeTeamDetails?.name ?? actualTeam?.name}</p>
                            <p className="mt-1 text-sm text-gray-500">Use the tabs to manage your team.</p>
                        </div>
                    )}
                </aside>

                <main className="min-w-0 overflow-y-auto p-4 sm:p-6">

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
                                <h2 className="text-2xl font-bold text-gray-900">{activeTeamDetails?.name ?? actualTeam?.name}</h2>
                                {canEditActiveTeam && (
                                    <>
                                        <button
                                            onClick={() => {
                                                setEditedTeamName(activeTeamDetails?.name ?? actualTeam?.name ?? '');
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

            <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Team invite</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="font-mono text-xl font-black tracking-wider text-gray-950">
                            {activeTeamDetails?.inviteCode ?? actualTeam?.inviteCode}
                        </p>
                        <div className="flex gap-1">
                            <button onClick={handleCopyInviteCode} className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-100" title="Copy code">
                                {copiedCode ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <button onClick={() => handleCopyInviteLink()} className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-100" title="Copy invite link">
                                {copiedLink ? <Check size={16} /> : <Link size={16} />}
                            </button>
                        </div>
                    </div>
                </div>
                <button type="button" onClick={() => setActiveTab('users')} className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:bg-gray-50">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Users</p>
                    <p className="mt-2 text-2xl font-black text-gray-950">{activeTeamDetails?.memberCount ?? activeTeamDetails?.members.length ?? 0}</p>
                    <p className="text-xs text-gray-500">Team members</p>
                </button>
                <button type="button" onClick={() => canManageActiveAccess && setActiveTab('access')} className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:bg-gray-50">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Default access</p>
                    <p className="mt-2 text-sm font-black text-gray-950">{WORKSPACE_ACCESS_LEVEL_LABELS[activeDefaultAccessLevel]}</p>
                    <p className="text-xs text-gray-500">For new invite users</p>
                </button>
                <button type="button" onClick={() => canLookupTeams && setActiveTab('uploads')} disabled={!canLookupTeams} className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-white">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Uploads</p>
                    <p className="mt-2 text-sm font-black text-gray-950">{canLookupTeams ? 'Team / all users' : 'File Manager'}</p>
                    <p className="text-xs text-gray-500">Review source files</p>
                </button>
            </div>

            <div className="mb-5 flex gap-2 overflow-x-auto border-b border-gray-200">
                {visibleTabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
                            activeTab === tab.id
                                ? 'border-brand-green text-brand-green'
                                : 'border-transparent text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {canLookupTeams && activeTeamDetails && activeTab === 'developer' && (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-base font-bold text-amber-950">Developer support tools</p>
                    <p className="mt-1 text-sm text-amber-800">
                        Inspection cannot write the selected team. Developer edit access is team-scoped, audited, and expires after 30 minutes.
                    </p>
                    <div className="mt-3">
                        <label className="text-xs font-bold uppercase tracking-wide text-amber-800">Selected user</label>
                        <select
                            value={selectedWizardMemberId}
                            onChange={(event) => setSelectedWizardMemberId(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-gray-800"
                        >
                            {activeTeamDetails.members.map(member => (
                                <option key={member.id} value={member.id}>{member.displayName} ({member.email})</option>
                            ))}
                        </select>
                    </div>
                    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <button onClick={handlePreviewTeamDefault} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100">
                            <Eye size={16} /> Inspect team default
                        </button>
                        <button onClick={handleViewAsSavedMember} disabled={!selectedWizardMember} className="inline-flex items-center justify-center gap-2 rounded-lg border border-purple-300 bg-white px-4 py-2 text-sm font-bold text-purple-800 hover:bg-purple-100 disabled:opacity-50">
                            <Eye size={16} /> Inspect as user
                        </button>
                        <button onClick={handleStartDeveloperEdit} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50">
                            <Edit2 size={16} /> Start developer edit
                        </button>
                        <button
                            onClick={() => {
                                setUploadScope('all');
                                setActiveTab('uploads');
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50"
                        >
                            <FolderOpen size={16} /> View all uploads
                        </button>
                    </div>
                </div>
            )}

            {canLookupTeams && activeTab === 'developer' && (
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                        <PlusCircle size={18} className="text-brand-green" />
                        <p className="text-sm font-semibold text-gray-900">Create partner team</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <input
                            type="text"
                            value={partnerTeamName}
                            onChange={(event) => setPartnerTeamName(event.target.value)}
                            placeholder="Team name, e.g. Lane Transit"
                            className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                        />
                        <input
                            type="text"
                            value={partnerInviteCode}
                            onChange={(event) => setPartnerInviteCode(
                                event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
                            )}
                            placeholder="Code optional"
                            maxLength={6}
                            className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase tracking-wider focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                        />
                        <select
                            value={partnerAccessPackageId}
                            onChange={(event) => handlePartnerPackageChange(event.target.value as WorkspaceAccessPackageId)}
                            className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:border-brand-green focus:ring-2 focus:ring-brand-green sm:col-span-2"
                            title={getWorkspaceAccessPackage(partnerAccessPackageId).description}
                        >
                            {WORKSPACE_ACCESS_PACKAGES.map(pkg => (
                                <option key={pkg.id} value={pkg.id}>
                                    Package: {pkg.label}
                                </option>
                            ))}
                        </select>
                        <select
                            value={partnerDefaultAccessLevel}
                            onChange={(event) => setPartnerDefaultAccessLevel(event.target.value as WorkspaceAccessLevel)}
                            className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green sm:col-span-2"
                            title="Advanced: base access profile. The package may also apply workspace overrides."
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
                            Recommended: choose a package first. Use <span className="font-semibold">Transit App + STREETS Dashboard</span> for WATT-style access.
                        </p>
                        <button
                            onClick={handleCreatePartnerTeam}
                            disabled={creatingPartnerTeam || developerPreview?.mode === 'inspect' || !partnerTeamName.trim()}
                            className="w-full rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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

            {canManageActiveAccess && activeTeamDetails && activeTab === 'access' && (
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-gray-900">Access controls</p>
                            <p className="mt-1 text-xs text-gray-500">
                                Set team defaults and fine-tune one user's workspace access.
                            </p>
                        </div>
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-700">
                            Admin
                        </span>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Team</p>
                            <select
                                value={activeTeamDetails.id}
                                onChange={(event) => {
                                    const selectedTeam = availableTeams.find(teamOption => teamOption.id === event.target.value);
                                    if (selectedTeam) void handleSelectTeam(selectedTeam);
                                }}
                                    className="mt-1 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:border-brand-blue focus:ring-2 focus:ring-blue-100"
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
                            <button
                                onClick={() => handleCopyInviteLink(activeTeamDetails.inviteCode)}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100 sm:w-auto"
                            >
                                <Link size={16} />
                                Copy invite link
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
                        <div className="flex flex-col gap-3">
                            <div>
                                <p className="text-sm font-semibold text-gray-900">Team default access</p>
                                <p className="text-xs text-gray-500">Applies to future users who join with the invite link.</p>
                            </div>
                            <select
                                onChange={(event) => handleWizardTeamPackageChange(event.target.value as WorkspaceAccessPackageId)}
                                value=""
                                className="min-w-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900 focus:border-brand-blue focus:ring-2 focus:ring-blue-100"
                            >
                                <option value="" disabled>Apply access package...</option>
                                {WORKSPACE_ACCESS_PACKAGES.map(pkg => (
                                    <option key={pkg.id} value={pkg.id}>{pkg.label}</option>
                                ))}
                            </select>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                                <select
                                    value={wizardTeamAccessLevel}
                                    onChange={(event) => handleWizardTeamAccessLevelChange(event.target.value as WorkspaceAccessLevel)}
                                    className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:border-brand-blue focus:ring-2 focus:ring-blue-100"
                                >
                                    {WORKSPACE_ACCESS_LEVELS.map(level => (
                                        <option key={level} value={level}>
                                            {WORKSPACE_ACCESS_LEVEL_LABELS[level]}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={handlePreviewTeamDefault}
                                    disabled={!activeTeamDetails}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                                    title="Preview the app as a future invite user with these settings. This does not change your developer account team."
                                >
                                    <Eye size={16} />
                                    Preview
                                </button>
                                <button
                                    onClick={handleSaveWizardTeamAccess}
                                    disabled={savingWizardTeamAccess}
                                    className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-50"
                                >
                                    {savingWizardTeamAccess ? 'Saving...' : 'Save team default'}
                                </button>
                            </div>
                        </div>
                        <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <summary className="cursor-pointer text-sm font-bold text-gray-700">Advanced workspace overrides</summary>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {WORKSPACE_ACCESS_FEATURES.map(feature => (
                                <label key={feature} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                    <input
                                        type="checkbox"
                                        checked={wizardTeamWorkspaceSelection[feature]}
                                        onChange={(event) => setWizardTeamWorkspaceSelection(selection => ({
                                            ...selection,
                                            [feature]: event.target.checked,
                                        }))}
                                        className="h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-blue-500"
                                    />
                                    <span className="truncate">{WORKSPACE_FEATURE_LABELS[feature]}</span>
                                </label>
                            ))}
                            </div>
                        </details>
                        <WorkspaceAccessAppPreview
                            title="Access preview for future invite users"
                            preview={wizardTeamAccessPreview}
                        />
                    </div>

                    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
                        <div className="flex flex-col gap-3">
                            <div>
                                <p className="text-sm font-semibold text-gray-900">User-specific access</p>
                                <p className="text-xs text-gray-500">Override access for one team member when needed.</p>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <select
                                    value={selectedWizardMemberId}
                                    onChange={(event) => setSelectedWizardMemberId(event.target.value)}
                                    className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:border-brand-blue focus:ring-2 focus:ring-blue-100"
                                >
                                    {activeTeamDetails.members.map(member => (
                                        <option key={member.id} value={member.id}>
                                            {member.displayName} ({member.email})
                                        </option>
                                    ))}
                                </select>
                                <select
                                    onChange={(event) => handleWizardMemberPackageChange(event.target.value as WorkspaceAccessPackageId)}
                                    value=""
                                    disabled={!selectedWizardMember}
                                    className="min-w-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900 disabled:opacity-50 focus:border-brand-blue focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="" disabled>Apply access package...</option>
                                    {WORKSPACE_ACCESS_PACKAGES.map(pkg => (
                                        <option key={pkg.id} value={pkg.id}>{pkg.label}</option>
                                    ))}
                                </select>
                                <select
                                    value={wizardMemberAccessLevel}
                                    onChange={(event) => handleWizardMemberAccessLevelChange(event.target.value as WorkspaceAccessLevel)}
                                    disabled={!selectedWizardMember}
                                    className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 disabled:opacity-50 focus:border-brand-blue focus:ring-2 focus:ring-blue-100"
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
                                    className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-50 sm:col-span-2"
                                >
                                    {savingWizardMemberAccess ? 'Saving...' : 'Save user access'}
                                </button>
                                <button
                                    onClick={handlePreviewSelectedMember}
                                    disabled={!selectedWizardMember}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50 sm:col-span-2"
                                    title="Preview the app as this user with the selected settings. This does not change your developer account team."
                                >
                                    <Eye size={16} />
                                    Preview selected settings
                                </button>
                                <button
                                    onClick={handleViewAsSavedMember}
                                    disabled={!selectedWizardMember}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-bold text-purple-800 hover:bg-purple-100 disabled:opacity-50 sm:col-span-2"
                                    title="View the app exactly as this user's saved team access. This is read-only preview mode."
                                >
                                    <Eye size={16} />
                                    View as saved user
                                </button>
                            </div>
                        </div>
                        <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <summary className="cursor-pointer text-sm font-bold text-gray-700">Advanced workspace overrides</summary>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {WORKSPACE_ACCESS_FEATURES.map(feature => (
                                <label key={feature} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                    <input
                                        type="checkbox"
                                        checked={wizardMemberWorkspaceSelection[feature]}
                                        onChange={(event) => setWizardMemberWorkspaceSelection(selection => ({
                                            ...selection,
                                            [feature]: event.target.checked,
                                        }))}
                                        disabled={!selectedWizardMember}
                                        className="h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-blue-500 disabled:opacity-50"
                                    />
                                    <span className="truncate">{WORKSPACE_FEATURE_LABELS[feature]}</span>
                                </label>
                            ))}
                            </div>
                        </details>
                        <WorkspaceAccessAppPreview
                            title="Access preview for selected user"
                            preview={wizardMemberAccessPreview}
                        />
                    </div>

                    <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        Lane Transit setup: select <span className="font-semibold">Transit App Data only</span>. WATT setup: select <span className="font-semibold">Transit App + STREETS Dashboard</span>, then set Barrie as the read-only data source.
                    </p>
                </div>
            )}

            {canLookupTeams && activeTab === 'uploads' && (
                <div className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 p-4">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                            <div>
                                <p className="text-base font-bold text-gray-950">Uploads</p>
                                <p className="text-sm text-gray-500">Review File Manager uploads by upload-time team, your account, or all users.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(['team', 'mine', 'all'] as UploadAdminScope[]).map(scope => (
                                    <button
                                        key={scope}
                                        onClick={() => setUploadScope(scope)}
                                        className={`rounded-lg px-3 py-2 text-sm font-bold ${
                                            uploadScope === scope
                                                ? 'bg-brand-green text-white'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                    >
                                        {scope === 'team' ? 'Team uploads' : scope === 'mine' ? 'My uploads' : 'All uploads'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    value={uploadSearch}
                                    onChange={(event) => setUploadSearch(event.target.value)}
                                placeholder="Search file, uploader, or team"
                                    className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
                                />
                            </div>
                            <select
                                value={uploadFileFilter}
                                onChange={(event) => setUploadFileFilter(event.target.value as UploadFileFilter)}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700"
                            >
                                <option value="all">All file types</option>
                                <option value="schedule_master">Master Schedule</option>
                                <option value="rideco">RideCo</option>
                                <option value="barrie_tod">Barrie TOD</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                    </div>

                    {uploadsError && (
                        <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{uploadsError}</p>
                    )}

                    {uploadsLoading ? (
                        <p className="p-6 text-sm text-gray-500">Loading uploads...</p>
                    ) : filteredUploadedFiles.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            <FolderOpen className="mx-auto mb-3 opacity-40" size={42} />
                            <p className="font-bold">No uploads found</p>
                            <p className="text-sm">Try another scope or search.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-sm">
                                <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3">File</th>
                                        <th className="px-4 py-3">Uploader</th>
                                        <th className="px-4 py-3">Team</th>
                                        <th className="px-4 py-3">Type</th>
                                        <th className="px-4 py-3">Size</th>
                                        <th className="px-4 py-3">Uploaded</th>
                                        <th className="px-4 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredUploadedFiles.map(file => (
                                        <tr key={`${file.ownerUserId ?? 'mine'}-${file.id}`} className="hover:bg-gray-50">
                                            <td className="px-4 py-3">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <FileText size={16} className="text-brand-blue" />
                                                    <span className="truncate font-bold text-gray-900">{file.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-blue-700">{getUploaderLabel(file)}</td>
                                            <td className="px-4 py-3 text-gray-600">
                                                <span className="font-semibold">{file.resolvedTeamName || file.teamNameAtUpload || file.resolvedTeamId || file.teamIdAtUpload || 'No team recorded'}</span>
                                                {file.teamAttributionSource === 'owner_profile_fallback' && (
                                                    <span className="ml-1 text-xs text-amber-600">(legacy profile)</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{getFileCategoryLabel(file.type)}</td>
                                            <td className="px-4 py-3 text-gray-600">
                                                <span className="inline-flex items-center gap-1"><HardDrive size={13} />{formatFileSize(file.size)}</span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                <span className="inline-flex items-center gap-1"><Clock size={13} />{formatDate(file.uploadedAt)}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <a
                                                    href={file.downloadUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                                                >
                                                    <Download size={14} />
                                                    Open
                                                </a>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {canLookupTeams && activeTeamDetails && activeTab === 'data' && (
                <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                    <div className="mb-4 flex items-start gap-3">
                        <div className="rounded-lg bg-white p-2 text-emerald-700">
                            <Database size={20} />
                        </div>
                        <div>
                            <p className="text-base font-bold text-emerald-950">Read-only partner data sources</p>
                            <p className="mt-1 text-sm text-emerald-800">
                                Point WATT or another partner team at Barrie data without copying files. Partner users can view the shared workspaces, but imports still save only to their own team.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-emerald-200 bg-white p-4">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Transit App data source</p>
                            <select
                                value={transitAppSourceTeamId}
                                onChange={(event) => setTransitAppSourceTeamId(event.target.value)}
                                disabled={!canEditActiveTeam}
                                className="mt-2 w-full min-w-0 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            >
                                <option value="">Use {activeTeamDetails.name}'s own data</option>
                                {dataSourceTeamOptions.map(teamOption => (
                                    <option key={teamOption.id} value={teamOption.id}>
                                        Read from {teamOption.name}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-2 text-xs text-gray-500">
                                FROM: {transitAppSourceTeam?.name ?? activeTeamDetails.name}. TO/viewed by: {activeTeamDetails.name}.
                            </p>
                        </div>

                        <div className="rounded-xl border border-emerald-200 bg-white p-4">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">STREETS dashboard/reports source</p>
                            <select
                                value={performanceSourceTeamId}
                                onChange={(event) => setPerformanceSourceTeamId(event.target.value)}
                                disabled={!canEditActiveTeam}
                                className="mt-2 w-full min-w-0 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            >
                                <option value="">Use {activeTeamDetails.name}'s own data</option>
                                {dataSourceTeamOptions.map(teamOption => (
                                    <option key={teamOption.id} value={teamOption.id}>
                                        Read from {teamOption.name}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-2 text-xs text-gray-500">
                                FROM: {performanceSourceTeam?.name ?? activeTeamDetails.name}. TO/viewed by: {activeTeamDetails.name}.
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
                        <p className="text-sm font-semibold text-gray-900">What this does</p>
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                            <li>• No Storage files are copied.</li>
                            <li>• {activeTeamDetails.name} reads selected workspaces from the source team.</li>
                            <li>• Upload/import buttons remain tied to {activeTeamDetails.name}, not the source team.</li>
                        </ul>
                        <button
                            onClick={handleSaveDataSources}
                            disabled={savingDataSources || !activeTeamId || !canEditActiveTeam}
                            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                            {savingDataSources ? 'Saving sources...' : 'Save data sources'}
                        </button>
                        {!canEditActiveTeam && (
                            <p className="mt-2 text-xs font-semibold text-amber-700">
                                Start Developer edit from Developer Tools before changing cross-team data sources.
                            </p>
                        )}
                    </div>

                    <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs text-emerald-800">
                        Best WATT setup: set both sources to Barrie Transit. If either dropdown is “own data”, that workspace will look for uploads on {activeTeamDetails.name}.
                    </p>
                </div>
            )}

            {activeTab === 'users' && (
                <>
            {/* Invite Code */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-600 mb-1">Invite Code</p>
                        <p className="text-2xl font-mono font-bold text-gray-900 tracking-wider">
                            {activeTeamDetails?.inviteCode ?? actualTeam?.inviteCode}
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
                                        if (!isEditingInviteCode) setCustomInviteCode(activeTeamDetails?.inviteCode ?? actualTeam?.inviteCode ?? '');
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

                </>
            )}

            {/* Members List */}
            {activeTab === 'users' && (
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

                                    {canManageActiveAccess && (
                                        <button
                                            onClick={() => {
                                                setSelectedWizardMemberId(member.id);
                                                setActiveTab('access');
                                            }}
                                            className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                        >
                                            Edit access
                                        </button>
                                    )}

                                    {canLookupTeams && (
                                        <button
                                            onClick={() => {
                                                setUploadScope('team');
                                                setUploadSearch(member.email || member.displayName);
                                                setActiveTab('uploads');
                                            }}
                                            className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                        >
                                            Uploads
                                        </button>
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
            )}

            {/* Leave Team Button */}
            {activeTab === 'users' && isViewingCurrentTeam && (
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
                </main>
            </div>
        </div>
    );
};
