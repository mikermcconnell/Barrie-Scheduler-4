import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import type { TeamMember, TeamWithMembers } from '../../utils/masterScheduleTypes';
import {
    getMemberWorkspaceGrant,
    getTeamDefaultWorkspaceGrant,
    haveSameWorkspaceAccess,
} from '../../utils/workspaceAccess';
import {
    findWorkspaceAccessPackage,
    WORKSPACE_ACCESS_PACKAGES,
    type WorkspaceAccessPackageId,
} from '../../utils/workspaceAccessPackages';

/** 'team' means "follow the team package"; otherwise a package id. */
export type ExceptionChoice = 'team' | WorkspaceAccessPackageId;

interface ExceptionDialogProps {
    team: TeamWithMembers;
    member: TeamMember | null;
    saving: boolean;
    onClose: () => void;
    onSave: (member: TeamMember, choice: ExceptionChoice) => void;
}

const KEEP_CURRENT = 'current';

export const ExceptionDialog: React.FC<ExceptionDialogProps> = ({ team, member, saving, onClose, onSave }) => {
    const [choice, setChoice] = useState<string>('team');

    const memberGrant = member ? getMemberWorkspaceGrant(member) : null;
    const teamGrant = getTeamDefaultWorkspaceGrant(team);
    const teamPackage = findWorkspaceAccessPackage(teamGrant);
    const memberPackage = memberGrant ? findWorkspaceAccessPackage(memberGrant) : null;
    const followsTeam = memberGrant ? haveSameWorkspaceAccess(memberGrant, teamGrant) : true;
    const hasUnnamedCustom = !followsTeam && !memberPackage;

    useEffect(() => {
        if (followsTeam) setChoice('team');
        else setChoice(memberPackage?.id ?? KEEP_CURRENT);
    }, [member?.id, followsTeam, memberPackage?.id]);

    if (!member) return null;

    const handleSave = (): void => {
        if (choice === KEEP_CURRENT) {
            onClose();
            return;
        }
        onSave(member, choice as ExceptionChoice);
    };

    const optionClass = (selected: boolean): string => (
        `flex cursor-pointer gap-3 rounded-lg border p-3 ${selected ? 'border-brand-green bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`
    );

    return (
        <Modal isOpen onClose={onClose} size="md" zIndex="highest">
            <Modal.Header>Access for {member.displayName}</Modal.Header>
            <Modal.Body>
                <p className="mb-3 text-sm text-gray-500">
                    Most people follow the team package. Use an exception only when this person needs something different.
                </p>
                <div className="space-y-2">
                    <label className={optionClass(choice === 'team')}>
                        <input type="radio" name="member-access" checked={choice === 'team'} onChange={() => setChoice('team')} />
                        <span>
                            <span className="block text-sm font-bold text-gray-900">Same as team</span>
                            <span className="block text-xs text-gray-500">{teamPackage?.label ?? 'Custom team access'}</span>
                        </span>
                    </label>
                    {hasUnnamedCustom && (
                        <label className={optionClass(choice === KEEP_CURRENT)}>
                            <input type="radio" name="member-access" checked={choice === KEEP_CURRENT} onChange={() => setChoice(KEEP_CURRENT)} />
                            <span>
                                <span className="block text-sm font-bold text-gray-900">Keep current custom access</span>
                                <span className="block text-xs text-gray-500">A combination no package describes.</span>
                            </span>
                        </label>
                    )}
                    {WORKSPACE_ACCESS_PACKAGES.filter(pkg => pkg.id !== teamPackage?.id).map(pkg => (
                        <label key={pkg.id} className={optionClass(choice === pkg.id)}>
                            <input type="radio" name="member-access" checked={choice === pkg.id} onChange={() => setChoice(pkg.id)} />
                            <span>
                                <span className="block text-sm font-bold text-gray-900">{pkg.label}</span>
                                <span className="block text-xs text-gray-500">{pkg.description}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </Modal.Body>
            <Modal.Footer>
                <button
                    onClick={onClose}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
                >
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </Modal.Footer>
        </Modal>
    );
};
