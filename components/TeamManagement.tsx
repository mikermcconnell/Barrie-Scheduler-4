/**
 * Team Management
 *
 * Team owners and admins manage members and the team's access package here.
 * Global administrators additionally get a team directory, support sessions,
 * data sources, and an uploads browser.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Users, X } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useTeam } from './contexts/TeamContext';
import { useToast } from './contexts/ToastContext';
import {
    deleteTeam,
    getTeamWithMembers,
    getTeamsForPermissionManagement,
    leaveTeam,
    regenerateInviteCode,
    removeMember,
    renameTeam,
    setInviteCode as setTeamInviteCode,
    updateMemberWorkspaceAccess,
} from '../utils/services/teamService';
import type { Team, TeamMember, TeamWithMembers } from '../utils/masterScheduleTypes';
import {
    getMemberWorkspaceGrant,
    getTeamDefaultWorkspaceGrant,
    type WorkspaceAccessGrant,
} from '../utils/workspaceAccess';
import { getWorkspaceAccessPackage } from '../utils/workspaceAccessPackages';
import { AccessPanel } from './teamManagement/AccessPanel';
import { DataSourceCard } from './teamManagement/DataSourceCard';
import { ExceptionDialog, type ExceptionChoice } from './teamManagement/ExceptionDialog';
import { FilesPanel } from './teamManagement/FilesPanel';
import { InviteCodeBox } from './teamManagement/InviteCodeBox';
import { MembersPanel } from './teamManagement/MembersPanel';
import { NewTeamDialog } from './teamManagement/NewTeamDialog';
import { NoTeamSetup } from './teamManagement/NoTeamSetup';
import { SupportMenu } from './teamManagement/SupportMenu';
import { TeamDirectory } from './teamManagement/TeamDirectory';
import { getAccessSaveErrorMessage, retryOnceAfterTokenRefresh } from './teamManagement/accessErrors';

type TeamManagementTab = 'members' | 'access' | 'files';

const TAB_LABELS: Record<TeamManagementTab, string> = {
    members: 'Members',
    access: 'Access',
    files: 'Files',
};

interface TeamManagementProps {
    onClose?: () => void;
    fullScreen?: boolean;
}

const memberLabel = (member: TeamMember): string => member.displayName || member.email || 'selected user';

export const TeamManagement: React.FC<TeamManagementProps> = ({ onClose, fullScreen = false }) => {
    const { user, isGlobalAdmin } = useAuth();
    const {
        team,
        actualTeam,
        developerPreview,
        refreshTeam,
        startDeveloperPreview,
        stopDeveloperPreview,
    } = useTeam();
    const toast = useToast();

    const [homeTeamDetails, setHomeTeamDetails] = useState<TeamWithMembers | null>(null);
    const [managedTeamDetails, setManagedTeamDetails] = useState<TeamWithMembers | null>(null);
    const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
    const [directoryLoading, setDirectoryLoading] = useState(false);
    const [switchingTeam, setSwitchingTeam] = useState(false);
    const [activeTab, setActiveTab] = useState<TeamManagementTab>('members');
    const [filesSearch, setFilesSearch] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [deletingTeam, setDeletingTeam] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [exceptionMember, setExceptionMember] = useState<TeamMember | null>(null);
    const [savingException, setSavingException] = useState(false);
    const [newTeamOpen, setNewTeamOpen] = useState(false);

    const currentTeamMember = homeTeamDetails?.members.find(member => member.userId === user?.uid);
    const isCurrentTeamOwnerOrAdmin = currentTeamMember?.role === 'owner' || currentTeamMember?.role === 'admin';
    const supportTeamDetails = developerPreview?.team && 'members' in developerPreview.team
        ? developerPreview.team as TeamWithMembers
        : null;
    const activeTeamDetails = managedTeamDetails ?? supportTeamDetails ?? homeTeamDetails;
    const activeTeamId = activeTeamDetails?.id ?? actualTeam?.id;
    const isViewingCurrentTeam = Boolean(actualTeam && activeTeamId === actualTeam.id);
    const hasActiveEditSession = Boolean(
        isGlobalAdmin &&
        developerPreview?.mode === 'edit' &&
        developerPreview.team.id === activeTeamId
    );
    const canManage = (isViewingCurrentTeam && isCurrentTeamOwnerOrAdmin) || hasActiveEditSession;

    const tabs = useMemo<TeamManagementTab[]>(() => {
        const visible: TeamManagementTab[] = ['members'];
        if (canManage || isGlobalAdmin) visible.push('access');
        if (isGlobalAdmin) visible.push('files');
        return visible;
    }, [canManage, isGlobalAdmin]);

    useEffect(() => {
        if (!tabs.includes(activeTab)) setActiveTab('members');
    }, [activeTab, tabs]);

    const loadHomeTeam = async (): Promise<void> => {
        if (!actualTeam) return;

        try {
            setHomeTeamDetails(await getTeamWithMembers(actualTeam.id));
        } catch (error) {
            console.error('Error loading team details:', error);
            toast?.error('Failed to load team details');
        }
    };

    const loadDirectory = async (): Promise<void> => {
        setDirectoryLoading(true);
        try {
            const teams = await getTeamsForPermissionManagement();
            setAvailableTeams(teams);
            if (!actualTeam && !developerPreview && !managedTeamDetails && teams.length > 0) {
                const details = await getTeamWithMembers(teams[0].id);
                if (details) setManagedTeamDetails(details);
            }
        } catch (error) {
            console.error('Error loading available teams:', error);
            toast?.error('Failed to load teams');
        } finally {
            setDirectoryLoading(false);
        }
    };

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
            void loadHomeTeam();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actualTeam, developerPreview?.team.id]);

    useEffect(() => {
        if (isGlobalAdmin) void loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isGlobalAdmin]);

    const reloadActiveTeam = async (): Promise<void> => {
        if (!activeTeamId) return;

        const details = await getTeamWithMembers(activeTeamId);
        if (managedTeamDetails) {
            setManagedTeamDetails(details);
        } else {
            setHomeTeamDetails(details);
        }
    };

    /** Refresh everything that can show stale data after a team change. */
    const syncAfterChange = async (options: { directory?: boolean } = {}): Promise<void> => {
        await reloadActiveTeam();
        if (options.directory) await loadDirectory();
        if (isViewingCurrentTeam) await refreshTeam();
    };

    const handleSelectTeam = async (selected: Team): Promise<void> => {
        setSwitchingTeam(true);
        try {
            const details = await getTeamWithMembers(selected.id);
            if (!details) {
                toast?.error('Team not found');
                return;
            }
            setManagedTeamDetails(details);
            setIsEditingName(false);
        } catch (error) {
            console.error('Error loading selected team:', error);
            toast?.error('Failed to load team');
        } finally {
            setSwitchingTeam(false);
        }
    };

    const handleBackToHome = (): void => {
        setManagedTeamDetails(null);
        setIsEditingName(false);
    };

    const handleTeamCreated = async (teamId: string): Promise<void> => {
        await loadDirectory();
        const details = await getTeamWithMembers(teamId);
        if (details) setManagedTeamDetails(details);
    };

    const handleRename = async (): Promise<void> => {
        if (!activeTeamId || !canManage) return;

        const normalizedName = editedName.trim();
        if (!normalizedName) {
            toast?.error('Team name cannot be blank');
            return;
        }

        setSavingName(true);
        try {
            await renameTeam(activeTeamId, normalizedName);
            await syncAfterChange({ directory: true });
            setIsEditingName(false);
            toast?.success('Team name updated');
        } catch (error) {
            console.error('Error renaming team:', error);
            toast?.error('Failed to rename team');
        } finally {
            setSavingName(false);
        }
    };

    const handleDelete = async (): Promise<void> => {
        if (!activeTeamId || !activeTeamDetails || !canManage) return;

        const confirmed = confirm(
            `Delete team "${activeTeamDetails.name}"? This removes the team, invite code, members, and saved schedules. This cannot be undone.`
        );
        if (!confirmed) return;

        setDeletingTeam(true);
        try {
            await deleteTeam(activeTeamId);
            toast?.success(`Deleted ${activeTeamDetails.name}`);
            setManagedTeamDetails(null);
            setIsEditingName(false);
            await loadDirectory();
            if (isViewingCurrentTeam) await refreshTeam();
        } catch (error) {
            console.error('Error deleting team:', error);
            toast?.error('Failed to delete team');
        } finally {
            setDeletingTeam(false);
        }
    };

    const handleRegenerateCode = async (): Promise<boolean> => {
        if (!activeTeamId || !canManage) return false;

        try {
            await regenerateInviteCode(activeTeamId);
            await syncAfterChange({ directory: true });
            toast?.success('New invite code generated');
            return true;
        } catch {
            toast?.error('Failed to regenerate code');
            return false;
        }
    };

    const handleSetCode = async (code: string): Promise<boolean> => {
        if (!activeTeamId || !canManage) return false;

        try {
            const saved = await setTeamInviteCode(activeTeamId, code);
            await syncAfterChange({ directory: true });
            toast?.success(`Invite code set to ${saved}`);
            return true;
        } catch (error) {
            toast?.error(error instanceof Error && error.message ? error.message : 'Failed to set invite code');
            return false;
        }
    };

    const handleRemoveMember = async (member: TeamMember): Promise<void> => {
        if (!activeTeamId || !canManage) return;
        if (!confirm(`Remove ${member.displayName} from the team?`)) return;

        try {
            await removeMember(activeTeamId, member.id);
            await reloadActiveTeam();
            toast?.success(`${member.displayName} removed from team`);
        } catch {
            toast?.error('Failed to remove member');
        }
    };

    const handleLeave = async (): Promise<void> => {
        if (!user) return;
        if (!confirm('Are you sure you want to leave this team?')) return;

        setLeaving(true);
        try {
            await leaveTeam(user.uid);
            await refreshTeam();
            toast?.success('Left team');
        } catch {
            toast?.error('Failed to leave team');
        } finally {
            setLeaving(false);
        }
    };

    const handleSaveException = async (member: TeamMember, choice: ExceptionChoice): Promise<void> => {
        if (!activeTeamId || !activeTeamDetails || !canManage) return;
        if (member.userId === user?.uid && !confirm('Change your own workspace access?')) return;

        const grant: WorkspaceAccessGrant = choice === 'team'
            ? getTeamDefaultWorkspaceGrant(activeTeamDetails)
            : (() => {
                const pkg = getWorkspaceAccessPackage(choice);
                return { accessLevel: pkg.accessLevel, workspaceOverrides: pkg.workspaceOverrides };
            })();

        setSavingException(true);
        try {
            await retryOnceAfterTokenRefresh(user, () => updateMemberWorkspaceAccess(
                activeTeamId,
                member.id,
                grant.accessLevel,
                grant.workspaceOverrides,
            ));
            await syncAfterChange();
            toast?.success(`Access updated for ${member.displayName}`);
            setExceptionMember(null);
        } catch (error) {
            console.error('Error saving member workspace access:', error);
            toast?.error(getAccessSaveErrorMessage(error));
        } finally {
            setSavingException(false);
        }
    };

    /** Start a read-only support view of this team as a team default or a specific member. */
    const handleInspect = async (options: {
        grant: WorkspaceAccessGrant;
        member?: TeamMember;
        sourceLabel: string;
        reason: string;
    }): Promise<void> => {
        if (!activeTeamDetails || !isGlobalAdmin) return;

        const { grant, member } = options;
        const displayName = member ? memberLabel(member) : `${activeTeamDetails.name} invite user`;
        try {
            await startDeveloperPreview({
                team: activeTeamDetails,
                mode: 'inspect',
                accessLevel: grant.accessLevel,
                workspaceOverrides: grant.workspaceOverrides,
                role: member?.role ?? 'member',
                displayName,
                email: member?.email,
                sourceLabel: options.sourceLabel,
                userId: member?.userId,
                reason: options.reason,
            });
            toast?.success(`Inspecting ${activeTeamDetails.name} as ${member ? displayName : 'team default'}`);
            onClose?.();
        } catch (error) {
            console.error('Unable to start inspection:', error);
            toast?.error('Unable to start the inspection session. Confirm your scheduler administrator access.');
        }
    };

    const handleInspectTeamDefault = (): Promise<void> => {
        if (!activeTeamDetails) return Promise.resolve();
        return handleInspect({
            grant: getTeamDefaultWorkspaceGrant(activeTeamDetails),
            sourceLabel: `${activeTeamDetails.name} team default`,
            reason: 'Inspect team default access',
        });
    };

    const handlePreviewGrant = (grant: WorkspaceAccessGrant): Promise<void> => {
        if (!activeTeamDetails) return Promise.resolve();
        return handleInspect({
            grant,
            sourceLabel: `${activeTeamDetails.name} team default`,
            reason: 'Preview team default access',
        });
    };

    const handleInspectMember = (member: TeamMember): Promise<void> => handleInspect({
        grant: getMemberWorkspaceGrant(member),
        member,
        sourceLabel: `${memberLabel(member)} (saved access)`,
        reason: `Inspect saved access for ${memberLabel(member)}`,
    });

    const handleStartEdit = async (): Promise<void> => {
        if (!activeTeamDetails || !user || !isGlobalAdmin) return;

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
        } catch (error) {
            console.error('Unable to start developer edit session:', error);
            toast?.error('Unable to start developer edit access. Confirm your scheduler administrator claim.');
        }
    };

    const handleViewMemberFiles = (member: TeamMember): void => {
        setFilesSearch(member.email || member.displayName);
        setActiveTab('files');
    };

    if (!team && !isGlobalAdmin) {
        return <NoTeamSetup onClose={fullScreen ? undefined : onClose} />;
    }

    if (!activeTeamDetails) {
        return (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-gray-200 bg-white p-8">
                <div className="text-center">
                    <Users className="mx-auto mb-3 text-brand-green" size={28} />
                    <p className="font-bold text-gray-900">
                        {isGlobalAdmin ? 'Loading team directory...' : 'Loading team...'}
                    </p>
                </div>
            </div>
        );
    }

    const editSessionExpires = developerPreview
        ? new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(new Date(developerPreview.expiresAt))
        : '';

    return (
        <div className={fullScreen
            ? 'relative h-full w-full overflow-hidden bg-white'
            : 'relative w-full max-w-7xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'
        }>
            {/* In the app shell the surrounding Modal already provides the close button. */}
            {onClose && !fullScreen && (
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 z-20 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Close"
                >
                    <X size={20} />
                </button>
            )}

            <div className={`grid ${fullScreen ? 'h-full min-h-0' : 'min-h-[680px]'} ${isGlobalAdmin ? 'lg:grid-cols-[280px_1fr]' : ''}`}>
                {isGlobalAdmin && (
                    <TeamDirectory
                        teams={availableTeams}
                        loading={directoryLoading}
                        switching={switchingTeam}
                        activeTeamId={activeTeamId}
                        showBackToHome={Boolean(actualTeam) && !isViewingCurrentTeam}
                        onSelect={(selected) => void handleSelectTeam(selected)}
                        onBackToHome={handleBackToHome}
                        onNewTeam={() => setNewTeamOpen(true)}
                    />
                )}

                <main className="min-w-0 overflow-y-auto p-4 sm:p-6">
                    {hasActiveEditSession && (
                        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-900">
                            <span>Edit session: changes affect live data for {activeTeamDetails.name}.</span>
                            <span className="font-normal">Expires {editSessionExpires}</span>
                            <button
                                onClick={() => void stopDeveloperPreview()}
                                className="ml-auto rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-800 hover:bg-red-100"
                            >
                                End session
                            </button>
                        </div>
                    )}

                    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                            {isEditingName ? (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <input
                                        type="text"
                                        value={editedName}
                                        onChange={(event) => setEditedName(event.target.value)}
                                        className="rounded-lg border border-gray-300 px-3 py-2 text-xl font-bold text-gray-900 focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => void handleRename()}
                                            disabled={savingName || !editedName.trim()}
                                            className="rounded-lg bg-brand-green px-3 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {savingName ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={() => setIsEditingName(false)}
                                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-2xl font-bold text-gray-900">{activeTeamDetails.name}</h2>
                                    {canManage && (
                                        <>
                                            <button
                                                onClick={() => {
                                                    setEditedName(activeTeamDetails.name);
                                                    setIsEditingName(true);
                                                }}
                                                className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                            >
                                                Rename
                                            </button>
                                            <button
                                                onClick={() => void handleDelete()}
                                                disabled={deletingTeam}
                                                className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {deletingTeam ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                            <p className="mt-1 text-sm text-gray-500">
                                {activeTeamDetails.memberCount} member{activeTeamDetails.memberCount === 1 ? '' : 's'}
                                {!isViewingCurrentTeam && <span className="ml-2 text-blue-600">Viewing as support</span>}
                            </p>
                        </div>

                        <div className="flex items-stretch gap-3">
                            {isGlobalAdmin && (
                                <SupportMenu
                                    hasEditSession={hasActiveEditSession}
                                    onInspectTeam={() => void handleInspectTeamDefault()}
                                    onInspectMember={() => setActiveTab('members')}
                                    onStartEdit={() => void handleStartEdit()}
                                    onEndEdit={() => void stopDeveloperPreview()}
                                />
                            )}
                            <InviteCodeBox
                                code={activeTeamDetails.inviteCode}
                                canEdit={canManage}
                                onRegenerate={handleRegenerateCode}
                                onSetCode={handleSetCode}
                            />
                        </div>
                    </div>

                    {tabs.length > 1 && (
                        <div className="mb-5 flex gap-1 border-b border-gray-200">
                            {tabs.map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => {
                                        if (tab === 'files') setFilesSearch('');
                                        setActiveTab(tab);
                                    }}
                                    className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-bold transition-colors ${
                                        activeTab === tab
                                            ? 'border-brand-green text-brand-green'
                                            : 'border-transparent text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    {TAB_LABELS[tab]}
                                </button>
                            ))}
                        </div>
                    )}

                    {activeTab === 'members' && (
                        <MembersPanel
                            team={activeTeamDetails}
                            currentUserId={user?.uid}
                            canManage={canManage}
                            isGlobalAdmin={isGlobalAdmin}
                            canLeave={isViewingCurrentTeam}
                            leaving={leaving}
                            onSetException={setExceptionMember}
                            onRemove={(member) => void handleRemoveMember(member)}
                            onInspect={(member) => void handleInspectMember(member)}
                            onViewFiles={handleViewMemberFiles}
                            onLeave={() => void handleLeave()}
                        />
                    )}

                    {activeTab === 'access' && (
                        <div className="space-y-5">
                            <AccessPanel
                                team={activeTeamDetails}
                                canEdit={canManage}
                                canPreview={isGlobalAdmin}
                                onPreview={(grant) => void handlePreviewGrant(grant)}
                                onSaved={() => syncAfterChange()}
                            />
                            {isGlobalAdmin && (
                                <DataSourceCard
                                    team={activeTeamDetails}
                                    teamOptions={availableTeams}
                                    canEdit={canManage}
                                    onSaved={() => syncAfterChange()}
                                />
                            )}
                        </div>
                    )}

                    {activeTab === 'files' && isGlobalAdmin && (
                        <FilesPanel
                            key={`${activeTeamId}:${filesSearch}`}
                            teamId={activeTeamId}
                            initialSearch={filesSearch}
                        />
                    )}
                </main>
            </div>

            <ExceptionDialog
                team={activeTeamDetails}
                member={exceptionMember}
                saving={savingException}
                onClose={() => setExceptionMember(null)}
                onSave={(member, choice) => void handleSaveException(member, choice)}
            />
            {isGlobalAdmin && (
                <NewTeamDialog
                    isOpen={newTeamOpen}
                    readOnlyPreview={developerPreview?.mode === 'inspect'}
                    onClose={() => setNewTeamOpen(false)}
                    onCreated={handleTeamCreated}
                />
            )}
        </div>
    );
};
