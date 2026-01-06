/**
 * Version History Panel
 *
 * Shows version history for a master schedule route with rollback capability.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, RotateCcw, CheckCircle, Loader2, Clock } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import {
    getVersionHistory,
    rollbackToVersion
} from '../utils/masterScheduleService';
import type { MasterScheduleVersion, RouteIdentity } from '../utils/masterScheduleTypes';

interface VersionHistoryPanelProps {
    teamId: string;
    routeIdentity: RouteIdentity;
    currentVersion: number;
    onClose: () => void;
}

export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({
    teamId,
    routeIdentity,
    currentVersion,
    onClose
}) => {
    const { user } = useAuth();
    const toast = useToast();

    const [versions, setVersions] = useState<MasterScheduleVersion[]>([]);
    const [loading, setLoading] = useState(true);
    const [rolling, setRolling] = useState<number | null>(null);

    const loadVersionHistory = useCallback(async () => {
        setLoading(true);
        try {
            const history = await getVersionHistory(teamId, routeIdentity);
            setVersions(history);
        } catch (error) {
            console.error('Error loading version history:', error);
            toast?.error('Failed to load version history');
        } finally {
            setLoading(false);
        }
    }, [teamId, routeIdentity, toast]);

    useEffect(() => {
        loadVersionHistory();
    }, [loadVersionHistory]);

    const handleRollback = async (versionNumber: number) => {
        if (!user) return;

        if (!confirm(`Rollback to version ${versionNumber}? This will create a new version with the old content.`)) {
            return;
        }

        setRolling(versionNumber);
        try {
            await rollbackToVersion(
                teamId,
                user.uid,
                user.displayName || user.email?.split('@')[0] || 'User',
                routeIdentity,
                versionNumber
            );

            toast?.success(`Rolled back to version ${versionNumber}`);
            onClose(); // Close and refresh parent
        } catch (error) {
            console.error('Error rolling back:', error);
            toast?.error('Failed to rollback version');
        } finally {
            setRolling(null);
        }
    };

    const formatDate = (date: Date): string => {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);
    };

    const formatRelativeTime = (date: Date): string => {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return formatDate(date);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <button
                    onClick={onClose}
                    className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
                >
                    <ArrowLeft size={20} />
                    Back to Master Schedule
                </button>

                <div className="flex items-center gap-3">
                    <div className="p-3 bg-brand-green/10 rounded-lg">
                        <Clock className="text-brand-green" size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Version History</h1>
                        <p className="text-gray-600">{routeIdentity}</p>
                    </div>
                </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-900">
                    <strong>Note:</strong> Rolling back creates a new version with the selected version's content.
                    The original version remains in history.
                </p>
            </div>

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-brand-green" size={32} />
                </div>
            )}

            {/* Version List */}
            {!loading && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="divide-y divide-gray-200">
                        {versions.map(version => {
                            const isCurrent = version.versionNumber === currentVersion;
                            const isRolling = rolling === version.versionNumber;

                            return (
                                <div
                                    key={version.id}
                                    className={`p-6 ${isCurrent ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                                >
                                    <div className="flex items-start justify-between">
                                        {/* Version Info */}
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-bold text-gray-900">
                                                    Version {version.versionNumber}
                                                </h3>
                                                {isCurrent && (
                                                    <span className="flex items-center gap-1 px-2 py-1 bg-brand-green text-white text-xs font-semibold rounded-full">
                                                        <CheckCircle size={12} />
                                                        Current
                                                    </span>
                                                )}
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                    version.source === 'wizard' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-purple-100 text-purple-700'
                                                }`}>
                                                    {version.source === 'wizard' ? 'Wizard' : 'Tweaker'}
                                                </span>
                                            </div>

                                            <div className="space-y-1 text-sm text-gray-600">
                                                <p>
                                                    Uploaded by <span className="font-medium text-gray-900">{version.uploaderName}</span>
                                                </p>
                                                <p>
                                                    {formatDate(version.createdAt)} ({formatRelativeTime(version.createdAt)})
                                                </p>
                                                <p>
                                                    {version.tripCount} trips
                                                </p>
                                            </div>
                                        </div>

                                        {/* Rollback Button */}
                                        {!isCurrent && (
                                            <button
                                                onClick={() => handleRollback(version.versionNumber)}
                                                disabled={isRolling}
                                                className="flex items-center gap-2 px-4 py-2 border border-brand-green text-brand-green font-semibold rounded-lg hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isRolling ? (
                                                    <>
                                                        <Loader2 className="animate-spin" size={16} />
                                                        Rolling back...
                                                    </>
                                                ) : (
                                                    <>
                                                        <RotateCcw size={16} />
                                                        Rollback
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {!loading && versions.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <Clock className="mx-auto mb-4 text-gray-300" size={48} />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No version history</h3>
                    <p className="text-gray-600">This schedule has no previous versions.</p>
                </div>
            )}

            {/* Stats */}
            {!loading && versions.length > 0 && (
                <div className="mt-4 text-sm text-gray-600 text-center">
                    {versions.length} version{versions.length !== 1 ? 's' : ''} (maximum 5 retained)
                </div>
            )}
        </div>
    );
};
