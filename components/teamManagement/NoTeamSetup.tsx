import React, { useState } from 'react';
import { Users, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { createTeam, joinTeamByInviteCode } from '../../utils/services/teamService';

interface NoTeamSetupProps {
    onClose?: () => void;
}

export const NoTeamSetup: React.FC<NoTeamSetupProps> = ({ onClose }) => {
    const { user } = useAuth();
    const { refreshTeam } = useTeam();
    const toast = useToast();
    const [isCreating, setIsCreating] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const [teamName, setTeamName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);

    const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

    const handleCreateTeam = async (): Promise<void> => {
        if (!user || !teamName.trim()) return;

        setLoading(true);
        try {
            await createTeam(user.uid, teamName.trim(), displayName, user.email || '');
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

    const handleJoinTeam = async (): Promise<void> => {
        if (!user || !inviteCode.trim()) return;

        setLoading(true);
        try {
            await joinTeamByInviteCode(user.uid, inviteCode.toUpperCase(), displayName, user.email || '');
            await refreshTeam();
            toast?.success('Joined team successfully!');
            setInviteCode('');
            setIsJoining(false);
        } catch (error) {
            console.error('Error joining team:', error);
            toast?.error(error instanceof Error && error.message ? error.message : 'Failed to join team');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-8">
            {onClose && (
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
                    aria-label="Close"
                >
                    <X size={20} />
                </button>
            )}

            <div className="mb-6 flex items-center gap-3">
                <div className="rounded-lg bg-brand-green/10 p-3">
                    <Users className="text-brand-green" size={24} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Team Setup</h2>
            </div>

            <p className="mb-6 text-gray-600">
                Join an existing team or create a new team to get started. Workspaces stay hidden until access is assigned in Team Management.
            </p>

            <div className="space-y-4">
                {!isJoining && (
                    <div className="rounded-lg border border-gray-200 p-6">
                        <h3 className="mb-3 font-semibold text-gray-900">Create New Team</h3>
                        <p className="mb-3 text-sm text-gray-500">
                            This creates the team and makes you the owner. You can grant workspace access after setup.
                        </p>

                        {isCreating ? (
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    value={teamName}
                                    onChange={(event) => setTeamName(event.target.value)}
                                    placeholder="Team name"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                                    autoFocus
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => void handleCreateTeam()}
                                        disabled={!teamName.trim() || loading}
                                        className="flex-1 rounded-lg bg-brand-green px-4 py-2 font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {loading ? 'Creating...' : 'Create'}
                                    </button>
                                    <button
                                        onClick={() => setIsCreating(false)}
                                        className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsCreating(true)}
                                className="w-full rounded-lg bg-brand-green px-4 py-2 font-bold text-white hover:bg-green-700"
                            >
                                Create Team
                            </button>
                        )}
                    </div>
                )}

                {!isCreating && (
                    <div className="rounded-lg border border-gray-200 p-6">
                        <h3 className="mb-3 font-semibold text-gray-900">Join Existing Team</h3>

                        {isJoining ? (
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    value={inviteCode}
                                    onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                                    placeholder="Enter 6-digit code"
                                    maxLength={6}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center font-mono text-lg uppercase tracking-wider focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                                    autoFocus
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => void handleJoinTeam()}
                                        disabled={inviteCode.length !== 6 || loading}
                                        className="flex-1 rounded-lg bg-brand-green px-4 py-2 font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {loading ? 'Joining...' : 'Join'}
                                    </button>
                                    <button
                                        onClick={() => setIsJoining(false)}
                                        className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsJoining(true)}
                                className="w-full rounded-lg border-2 border-brand-green px-4 py-2 font-bold text-brand-green hover:bg-green-50"
                            >
                                Join with Code
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
