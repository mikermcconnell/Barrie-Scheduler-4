import React, { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import type { TeamWithMembers } from '../../utils/masterScheduleTypes';
import {
    getAllowedWorkspaceFeatures,
    getMemberWorkspaceGrant,
    getTeamDefaultWorkspaceGrant,
    haveSameWorkspaceAccess,
    type WorkspaceAccessGrant,
} from '../../utils/workspaceAccess';
import {
    findWorkspaceAccessPackage,
    getWorkspaceAccessPackage,
    WORKSPACE_ACCESS_PACKAGES,
    type WorkspaceAccessPackageId,
} from '../../utils/workspaceAccessPackages';
import { buildWorkspaceAccessPreview } from '../../utils/workspaceAccessPreview';
import { updateTeamWorkspaceAccess } from '../../utils/services/teamService';
import { WorkspaceAccessAppPreview } from '../WorkspaceAccessAppPreview';
import { getAccessSaveErrorMessage, retryOnceAfterTokenRefresh } from './accessErrors';
import { WORKSPACE_FEATURE_LABELS } from './workspaceFeatureLabels';

interface AccessPanelProps {
    team: TeamWithMembers;
    canEdit: boolean;
    canPreview: boolean;
    onPreview: (grant: WorkspaceAccessGrant) => void;
    onSaved: () => Promise<void>;
}

const CUSTOM_ID = 'custom';

export const AccessPanel: React.FC<AccessPanelProps> = ({ team, canEdit, canPreview, onPreview, onSaved }) => {
    const { user } = useAuth();
    const toast = useToast();
    const [saving, setSaving] = useState(false);

    const currentGrant = getTeamDefaultWorkspaceGrant(team);
    const currentPackage = findWorkspaceAccessPackage(currentGrant);
    const currentId = currentPackage?.id ?? CUSTOM_ID;
    const [selectedId, setSelectedId] = useState<string>(currentId);

    useEffect(() => {
        setSelectedId(currentId);
    }, [team.id, currentId]);

    const selectedPackage = selectedId === CUSTOM_ID
        ? null
        : getWorkspaceAccessPackage(selectedId as WorkspaceAccessPackageId);
    const selectedGrant: WorkspaceAccessGrant = selectedPackage
        ? { accessLevel: selectedPackage.accessLevel, workspaceOverrides: selectedPackage.workspaceOverrides }
        : currentGrant;
    const unlocked = getAllowedWorkspaceFeatures(selectedGrant.accessLevel, selectedGrant.workspaceOverrides);
    const isDirty = selectedId !== currentId;

    const exceptionCount = team.members.filter(
        member => !haveSameWorkspaceAccess(getMemberWorkspaceGrant(member), currentGrant)
    ).length;
    const followerCount = team.members.length - exceptionCount;

    const grantKey = `${selectedGrant.accessLevel}:${JSON.stringify(selectedGrant.workspaceOverrides ?? {})}`;
    const preview = useMemo(() => buildWorkspaceAccessPreview({
        displayName: `${team.name} member`,
        accessLevel: selectedGrant.accessLevel,
        overrides: selectedGrant.workspaceOverrides,
    // grantKey captures the grant; the object itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [team.name, grantKey]);

    const handleSave = async (): Promise<void> => {
        if (!canEdit || !isDirty) return;

        setSaving(true);
        try {
            const result = await retryOnceAfterTokenRefresh(user, () => updateTeamWorkspaceAccess(
                team.id,
                selectedGrant.accessLevel,
                selectedGrant.workspaceOverrides,
            ));
            await onSaved();
            const updated = result.updatedMemberIds.length;
            toast?.success(`Team access saved. ${updated} member${updated === 1 ? '' : 's'} updated.`);
        } catch (error) {
            console.error('Error saving team workspace access:', error);
            toast?.error(getAccessSaveErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-bold text-gray-900">Team access</p>
                        <p className="text-xs text-gray-500">
                            Everyone on this team gets the same workspaces. Change it once and it applies to all members.
                        </p>
                    </div>
                    {canPreview && (
                        <button
                            onClick={() => onPreview(selectedGrant)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                            title="Open the app as a member of this team with the selected package. Nothing is saved."
                        >
                            <Eye size={16} />
                            Preview as this team
                        </button>
                    )}
                </div>

                <div className="p-4">
                    <div className="grid gap-5 lg:grid-cols-[minmax(240px,340px)_1fr]">
                        <div>
                            <label className="text-[11px] font-bold uppercase tracking-wide text-gray-500" htmlFor="team-access-package">
                                Access package
                            </label>
                            <select
                                id="team-access-package"
                                value={selectedId}
                                onChange={(event) => setSelectedId(event.target.value)}
                                disabled={!canEdit || saving}
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 disabled:bg-gray-100 disabled:text-gray-500"
                            >
                                {!currentPackage && (
                                    <option value={CUSTOM_ID}>Custom (current setup)</option>
                                )}
                                {WORKSPACE_ACCESS_PACKAGES.map(pkg => (
                                    <option key={pkg.id} value={pkg.id}>{pkg.label}</option>
                                ))}
                            </select>
                            <p className="mt-2 text-xs text-gray-500">
                                {selectedPackage?.description
                                    ?? 'This team uses a combination no package describes. Choose a package to replace it.'}
                            </p>
                            {!canEdit && (
                                <p className="mt-2 text-xs font-semibold text-amber-700">
                                    Start an edit session from Support to change this team&apos;s access.
                                </p>
                            )}
                        </div>

                        <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">This unlocks</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {unlocked.length === 0 ? (
                                    <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">
                                        No workspaces
                                    </span>
                                ) : unlocked.map(feature => (
                                    <span
                                        key={feature}
                                        className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-900"
                                    >
                                        {WORKSPACE_FEATURE_LABELS[feature as keyof typeof WORKSPACE_FEATURE_LABELS] ?? feature}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center">
                        <p className="flex-1 text-xs text-gray-500">
                            {isDirty && <span className="font-bold text-amber-700">Unsaved change. </span>}
                            Applies immediately to <span className="font-bold">{followerCount} member{followerCount === 1 ? '' : 's'}</span>.
                            {exceptionCount > 0 && (
                                <> {exceptionCount} with an exception {exceptionCount === 1 ? 'is' : 'are'} not affected.</>
                            )}
                        </p>
                        <button
                            onClick={() => setSelectedId(currentId)}
                            disabled={!isDirty || saving}
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            Revert
                        </button>
                        <button
                            onClick={() => void handleSave()}
                            disabled={!canEdit || !isDirty || saving}
                            className="rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Save access'}
                        </button>
                    </div>
                </div>
            </div>

            <details className="rounded-xl border border-gray-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">
                    See what members will see
                </summary>
                <div className="border-t border-gray-200 p-4">
                    <WorkspaceAccessAppPreview title="Access preview for team members" preview={preview} />
                </div>
            </details>
        </div>
    );
};
