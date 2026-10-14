import React from 'react';
import { LogOut, Shield, Trash2, User } from 'lucide-react';
import type { TeamMember, TeamWithMembers } from '../../utils/masterScheduleTypes';
import {
    getMemberWorkspaceGrant,
    getTeamDefaultWorkspaceGrant,
    haveSameWorkspaceAccess,
} from '../../utils/workspaceAccess';
import { findWorkspaceAccessPackage } from '../../utils/workspaceAccessPackages';

interface MembersPanelProps {
    team: TeamWithMembers;
    currentUserId?: string;
    canManage: boolean;
    isGlobalAdmin: boolean;
    canLeave: boolean;
    leaving: boolean;
    onSetException: (member: TeamMember) => void;
    onRemove: (member: TeamMember) => void;
    onInspect: (member: TeamMember) => void;
    onViewFiles: (member: TeamMember) => void;
    onLeave: () => void;
}

const ROLE_STYLES: Record<TeamMember['role'], string> = {
    owner: 'bg-brand-green/20 text-brand-green',
    admin: 'bg-blue-100 text-blue-700',
    member: 'bg-gray-100 text-gray-700',
};

const rowButton = 'rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50';

export const MembersPanel: React.FC<MembersPanelProps> = ({
    team,
    currentUserId,
    canManage,
    isGlobalAdmin,
    canLeave,
    leaving,
    onSetException,
    onRemove,
    onInspect,
    onViewFiles,
    onLeave,
}) => {
    const teamGrant = getTeamDefaultWorkspaceGrant(team);

    return (
        <div>
            <div className="rounded-xl border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-4 py-3">
                    <p className="text-sm font-bold text-gray-900">Members</p>
                    <p className="text-xs text-gray-500">
                        Members follow the team&apos;s access package. Only exceptions are labelled.
                    </p>
                </div>
                <div className="divide-y divide-gray-100">
                    {team.members.map(member => {
                        const memberGrant = getMemberWorkspaceGrant(member);
                        const isException = !haveSameWorkspaceAccess(memberGrant, teamGrant);
                        const exceptionLabel = findWorkspaceAccessPackage(memberGrant)?.label ?? 'Custom access';
                        const isSelf = member.userId === currentUserId;

                        return (
                            <div key={member.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="rounded-full bg-gray-100 p-2">
                                        {member.role === 'owner'
                                            ? <Shield size={16} className="text-brand-green" />
                                            : <User size={16} className="text-gray-600" />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-gray-900">
                                            {member.displayName}
                                            {isSelf && <span className="ml-2 text-sm text-gray-500">(You)</span>}
                                        </p>
                                        <p className="truncate text-sm text-gray-500">{member.email}</p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ROLE_STYLES[member.role]}`}>
                                        {member.role}
                                    </span>
                                    {isException && (
                                        <span
                                            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800"
                                            title="Differs from the team access package"
                                        >
                                            Custom: {exceptionLabel}
                                        </span>
                                    )}
                                    {isGlobalAdmin && (
                                        <>
                                            <button onClick={() => onInspect(member)} className={rowButton}>Inspect as</button>
                                            <button onClick={() => onViewFiles(member)} className={rowButton}>Files</button>
                                        </>
                                    )}
                                    {canManage && (
                                        <button onClick={() => onSetException(member)} className={rowButton}>
                                            {isException ? 'Edit exception' : 'Set exception…'}
                                        </button>
                                    )}
                                    {canManage && !isSelf && member.role !== 'owner' && (
                                        <button
                                            onClick={() => onRemove(member)}
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

            {canLeave && (
                <button
                    onClick={onLeave}
                    disabled={leaving}
                    className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                    <LogOut size={16} />
                    Leave team
                </button>
            )}
        </div>
    );
};
