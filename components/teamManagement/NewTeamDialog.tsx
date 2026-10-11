import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { createPartnerTeam } from '../../utils/services/teamService';
import { buildInviteLinkForCurrentLocation, normalizeInviteCode } from '../../utils/inviteLinks';
import {
    getWorkspaceAccessPackage,
    WORKSPACE_ACCESS_PACKAGES,
    type WorkspaceAccessPackageId,
} from '../../utils/workspaceAccessPackages';

interface NewTeamDialogProps {
    isOpen: boolean;
    readOnlyPreview: boolean;
    onClose: () => void;
    onCreated: (teamId: string) => Promise<void>;
}

const DEFAULT_PACKAGE: WorkspaceAccessPackageId = 'transit-app-only';

export const NewTeamDialog: React.FC<NewTeamDialogProps> = ({ isOpen, readOnlyPreview, onClose, onCreated }) => {
    const { user } = useAuth();
    const toast = useToast();
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [packageId, setPackageId] = useState<WorkspaceAccessPackageId>(DEFAULT_PACKAGE);
    const [creating, setCreating] = useState(false);

    const selectedPackage = getWorkspaceAccessPackage(packageId);

    const handleCreate = async (): Promise<void> => {
        if (!user || readOnlyPreview || !name.trim()) return;

        const normalizedCode = code.trim() ? normalizeInviteCode(code) : null;
        if (code.trim() && !normalizedCode) {
            toast?.error('Invite code must be exactly 6 letters/numbers');
            return;
        }

        setCreating(true);
        try {
            const result = await createPartnerTeam({
                createdBy: user.uid,
                teamName: name.trim(),
                inviteCode: normalizedCode ?? undefined,
                defaultMemberAccessLevel: selectedPackage.accessLevel,
                defaultMemberWorkspaceOverrides: selectedPackage.workspaceOverrides,
            });
            try {
                await navigator.clipboard.writeText(buildInviteLinkForCurrentLocation(result.inviteCode));
                toast?.success(`Created ${name.trim()}. Invite link copied.`);
            } catch {
                toast?.success(`Created ${name.trim()}`);
            }
            setName('');
            setCode('');
            setPackageId(DEFAULT_PACKAGE);
            await onCreated(result.teamId);
            onClose();
        } catch (error) {
            console.error('Error creating partner team:', error);
            toast?.error(error instanceof Error && error.message ? error.message : 'Failed to create team');
        } finally {
            setCreating(false);
        }
    };

    const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green/20';
    const label = 'mt-3 block text-[11px] font-bold uppercase tracking-wide text-gray-500';

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="md" zIndex="highest">
            <Modal.Header>New team</Modal.Header>
            <Modal.Body>
                <p className="text-sm text-gray-500">
                    Create a team without joining it. Pick the access package its members will get.
                </p>
                <label className={label} htmlFor="new-team-name">Team name</label>
                <input
                    id="new-team-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Lane Transit"
                    className={`mt-1 ${field}`}
                    autoFocus
                />
                <label className={label} htmlFor="new-team-code">Invite code (optional)</label>
                <input
                    id="new-team-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                    placeholder="6 characters"
                    maxLength={6}
                    className={`mt-1 font-mono uppercase tracking-wider ${field}`}
                />
                <label className={label} htmlFor="new-team-package">Access package</label>
                <select
                    id="new-team-package"
                    value={packageId}
                    onChange={(event) => setPackageId(event.target.value as WorkspaceAccessPackageId)}
                    className={`mt-1 font-bold ${field}`}
                >
                    {WORKSPACE_ACCESS_PACKAGES.map(pkg => (
                        <option key={pkg.id} value={pkg.id}>{pkg.label}</option>
                    ))}
                </select>
                <p className="mt-2 text-xs text-gray-500">{selectedPackage.description}</p>
                {readOnlyPreview && (
                    <p className="mt-2 text-xs font-semibold text-amber-700">End the inspection session to create teams.</p>
                )}
            </Modal.Body>
            <Modal.Footer>
                <button
                    onClick={onClose}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                >
                    Cancel
                </button>
                <button
                    onClick={() => void handleCreate()}
                    disabled={creating || readOnlyPreview || !name.trim()}
                    className="rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {creating ? 'Creating...' : 'Create team'}
                </button>
            </Modal.Footer>
        </Modal>
    );
};
