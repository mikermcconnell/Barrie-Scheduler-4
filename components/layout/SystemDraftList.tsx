/**
 * System Draft List Component
 *
 * Displays and manages system-wide drafts containing all routes for a day type.
 * Provides UI for viewing, opening, and deleting system drafts.
 */

import React, { useState, useEffect } from 'react';
import {
    Layers,
    Calendar,
    Clock,
    Trash2,
    ChevronRight,
    Loader2,
    AlertCircle,
    RefreshCw,
    Bus,
    Database
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { SystemDraftMetadata, SystemDraft } from '../../utils/schedule/scheduleTypes';
import { getAllSystemDrafts, getSystemDraft, deleteSystemDraft } from '../../utils/services/systemDraftService';

interface SystemDraftListProps {
    onSelectDraft: (draft: SystemDraft) => void;
    onRefresh?: () => void;
    className?: string;
}

export const SystemDraftList: React.FC<SystemDraftListProps> = ({
    onSelectDraft,
    onRefresh,
    className = ''
}) => {
    const { user } = useAuth();
    const [drafts, setDrafts] = useState<SystemDraftMetadata[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingDraft, setIsLoadingDraft] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Load drafts on mount
    useEffect(() => {
        loadDrafts();
    }, [user?.uid]);

    const loadDrafts = async () => {
        if (!user) return;

        setIsLoading(true);
        setError(null);

        try {
            const systemDrafts = await getAllSystemDrafts(user.uid);
            setDrafts(systemDrafts);
        } catch (err) {
            console.error('Failed to load system drafts:', err);
            setError(err instanceof Error ? err.message : 'Failed to load drafts');
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenDraft = async (draftId: string) => {
        if (!user) return;

        setIsLoadingDraft(draftId);
        setError(null);

        try {
            const draft = await getSystemDraft(user.uid, draftId);
            if (draft) {
                onSelectDraft(draft);
            } else {
                setError('Draft not found');
            }
        } catch (err) {
            console.error('Failed to load draft:', err);
            setError(err instanceof Error ? err.message : 'Failed to load draft');
        } finally {
            setIsLoadingDraft(null);
        }
    };

    const handleDeleteDraft = async (draftId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!user) return;

        if (!confirm('Are you sure you want to delete this system draft? This action cannot be undone.')) {
            return;
        }

        setDeletingId(draftId);
        try {
            await deleteSystemDraft(user.uid, draftId);
            setDrafts(prev => prev.filter(d => d.id !== draftId));
        } catch (err) {
            console.error('Failed to delete draft:', err);
            setError(err instanceof Error ? err.message : 'Failed to delete draft');
        } finally {
            setDeletingId(null);
        }
    };

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);
    };

    const getDayTypeColor = (dayType: string) => {
        switch (dayType) {
            case 'Weekday': return 'bg-blue-100 text-blue-700';
            case 'Saturday': return 'bg-green-100 text-green-700';
            case 'Sunday': return 'bg-orange-100 text-orange-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    if (isLoading) {
        return (
            <div className={`flex items-center justify-center py-12 ${className}`}>
                <Loader2 className="animate-spin text-indigo-600 mr-3" size={24} />
                <span className="text-gray-600">Loading system drafts...</span>
            </div>
        );
    }

    return (
        <div className={className}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Layers className="text-indigo-600" size={20} />
                    <h3 className="font-bold text-gray-800">System Drafts</h3>
                    <span className="text-sm text-gray-400">({drafts.length})</span>
                </div>
                <button
                    onClick={() => { loadDrafts(); onRefresh?.(); }}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={16} />
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                    <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={16} />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {/* Empty State */}
            {drafts.length === 0 && !error && (
                <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                    <Database className="mx-auto text-gray-300 mb-3" size={40} />
                    <p className="text-gray-600 font-medium">No system drafts yet</p>
                    <p className="text-sm text-gray-400 mt-1">
                        Import from GTFS to create a system draft
                    </p>
                </div>
            )}

            {/* Draft List */}
            {drafts.length > 0 && (
                <div className="space-y-2">
                    {drafts.map(draft => (
                        <div
                            key={draft.id}
                            onClick={() => !(isLoadingDraft === draft.id || deletingId === draft.id) && handleOpenDraft(draft.id)}
                            className={`w-full p-4 bg-white border border-gray-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition-all text-left group cursor-pointer ${
                                isLoadingDraft === draft.id || deletingId === draft.id ? 'opacity-70 cursor-wait' : ''
                            }`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    {/* Title Row */}
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getDayTypeColor(draft.dayType)}`}>
                                            {draft.dayType}
                                        </span>
                                        <h4 className="font-medium text-gray-800 truncate">
                                            {draft.name}
                                        </h4>
                                    </div>

                                    {/* Metadata Row */}
                                    <div className="flex items-center gap-4 text-xs text-gray-500">
                                        <div className="flex items-center gap-1">
                                            <Bus size={12} />
                                            <span>{draft.routeCount} routes</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Clock size={12} />
                                            <span>{formatDate(draft.updatedAt)}</span>
                                        </div>
                                        {draft.basedOn?.type === 'gtfs' && (
                                            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-xs">
                                                GTFS
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 ml-4">
                                    {/* Delete Button */}
                                    <button
                                        onClick={(e) => handleDeleteDraft(draft.id, e)}
                                        disabled={deletingId === draft.id}
                                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                        title="Delete draft"
                                    >
                                        {deletingId === draft.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={16} />
                                        )}
                                    </button>

                                    {/* Open Arrow */}
                                    {isLoadingDraft === draft.id ? (
                                        <Loader2 size={20} className="text-indigo-600 animate-spin" />
                                    ) : (
                                        <ChevronRight
                                            size={20}
                                            className="text-gray-400 group-hover:text-indigo-600 transition-colors"
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SystemDraftList;
