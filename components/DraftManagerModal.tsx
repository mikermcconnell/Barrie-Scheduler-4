import React, { useState, useEffect } from 'react';
import { FileText, Trash2, Copy, Clock, ChevronRight, X, Loader2, FolderOpen, Plus, RotateCcw } from 'lucide-react';
import { getAllDrafts, deleteDraft, getDraftVersions, restoreDraftVersion, ScheduleDraft, DraftVersion } from '../utils/services/dataService';

interface Props {
    isOpen: boolean;
    userId: string | null;
    currentDraftId: string | null;
    onClose: () => void;
    onLoadDraft: (draft: ScheduleDraft) => void;
    onNewDraft: () => void;
    onRestoreVersion?: (draft: ScheduleDraft) => void;
}

export const DraftManagerModal: React.FC<Props> = ({
    isOpen,
    userId,
    currentDraftId,
    onClose,
    onLoadDraft,
    onNewDraft,
    onRestoreVersion
}) => {
    const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDraft, setSelectedDraft] = useState<ScheduleDraft | null>(null);
    const [versions, setVersions] = useState<DraftVersion[]>([]);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

    // Load drafts on open
    useEffect(() => {
        if (isOpen && userId) {
            loadDrafts();
        }
    }, [isOpen, userId]);

    const loadDrafts = async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const allDrafts = await getAllDrafts(userId);
            setDrafts(allDrafts);
        } catch (e) {
            console.error('Failed to load drafts:', e);
        } finally {
            setLoading(false);
        }
    };

    const loadVersions = async (draft: ScheduleDraft) => {
        if (!userId) return;
        setLoadingVersions(true);
        setSelectedDraft(draft);
        try {
            const draftVersions = await getDraftVersions(userId, draft.id);
            setVersions(draftVersions);
        } catch (e) {
            console.error('Failed to load versions:', e);
            setVersions([]);
        } finally {
            setLoadingVersions(false);
        }
    };

    const handleDelete = async (draftId: string) => {
        if (!userId) return;
        try {
            await deleteDraft(userId, draftId);
            setDrafts(drafts.filter(d => d.id !== draftId));
            if (selectedDraft?.id === draftId) {
                setSelectedDraft(null);
                setVersions([]);
            }
            setDeleteConfirm(null);
        } catch (e) {
            console.error('Failed to delete draft:', e);
        }
    };

    const handleRestore = async (versionId: string) => {
        if (!userId || !selectedDraft) return;
        setRestoringVersionId(versionId);
        try {
            const restoredDraft = await restoreDraftVersion(userId, selectedDraft.id, versionId);
            if (restoredDraft) {
                onRestoreVersion?.(restoredDraft);
                onClose();
            }
        } catch (e) {
            console.error('Failed to restore version:', e);
            alert('Failed to restore version. Please try again.');
        } finally {
            setRestoringVersionId(null);
        }
    };

    const formatDate = (date: Date) => {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                            <FolderOpen size={20} className="text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Legacy Drafts</h2>
                            <p className="text-xs text-gray-500">{drafts.length} saved legacy draft{drafts.length !== 1 ? 's' : ''}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { onNewDraft(); onClose(); }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
                        >
                            <Plus size={16} /> New Draft
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Draft List */}
                    <div className="w-1/2 border-r border-gray-100 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-20 text-gray-400">
                                <Loader2 size={32} className="animate-spin" />
                            </div>
                        ) : drafts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                <FileText size={48} className="mb-4 opacity-30" />
                                <p className="font-bold">No drafts yet</p>
                                <p className="text-sm">Your saved schedules will appear here</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {drafts.map(draft => (
                                    <div
                                        key={draft.id}
                                        onClick={() => loadVersions(draft)}
                                        className={`p-4 cursor-pointer transition-colors group relative ${selectedDraft?.id === draft.id
                                            ? 'bg-blue-50 border-l-4 border-blue-600'
                                            : 'hover:bg-gray-50 border-l-4 border-transparent'
                                            } ${currentDraftId === draft.id ? 'ring-2 ring-inset ring-green-200' : ''}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <FileText size={16} className="text-gray-400 flex-shrink-0" />
                                                    <span className="font-bold text-gray-900 truncate">{draft.name}</span>
                                                    {currentDraftId === draft.id && (
                                                        <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">CURRENT</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                                    <span>{draft.routeCount || 0} route{(draft.routeCount || 0) !== 1 ? 's' : ''}</span>
                                                    <span>•</span>
                                                    <span className="flex items-center gap-1">
                                                        <Clock size={10} />
                                                        {formatDate(draft.updatedAt)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {deleteConfirm === draft.id ? (
                                                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            onClick={() => handleDelete(draft.id)}
                                                            className="px-2 py-1 bg-red-600 text-white text-[10px] font-bold rounded hover:bg-red-700"
                                                        >
                                                            Delete
                                                        </button>
                                                        <button
                                                            onClick={() => setDeleteConfirm(null)}
                                                            className="px-2 py-1 bg-gray-200 text-gray-600 text-[10px] font-bold rounded hover:bg-gray-300"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(draft.id); }}
                                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                                                        title="Delete draft"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                                <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Detail Panel */}
                    <div className="w-1/2 overflow-y-auto bg-gray-50">
                        {selectedDraft ? (
                            <div className="p-6">
                                <h3 className="text-lg font-bold text-gray-900 mb-1">{selectedDraft.name}</h3>
                                <p className="text-xs text-gray-500 mb-6">
                                    Created {formatDate(selectedDraft.createdAt)} • Updated {formatDate(selectedDraft.updatedAt)}
                                </p>

                                {/* Actions */}
                                <div className="flex gap-2 mb-6">
                                    <button
                                        onClick={() => { onLoadDraft(selectedDraft); onClose(); }}
                                        disabled={currentDraftId === selectedDraft.id}
                                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-colors ${currentDraftId === selectedDraft.id
                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                            : 'bg-blue-600 text-white hover:bg-blue-700'
                                            }`}
                                    >
                                        <FolderOpen size={16} />
                                        {currentDraftId === selectedDraft.id ? 'Already Open' : 'Load Draft'}
                                    </button>
                                    {deleteConfirm === selectedDraft.id ? (
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleDelete(selectedDraft.id)}
                                                className="px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700"
                                            >
                                                Confirm
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirm(null)}
                                                className="px-3 py-2 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setDeleteConfirm(selectedDraft.id)}
                                            className="p-2.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                                            title="Delete draft"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>

                                {/* Routes Summary */}
                                <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Routes</h4>
                                    {selectedDraft.schedules?.length > 0 ? (
                                        <div className="space-y-2">
                                            {selectedDraft.schedules.slice(0, 5).map((s, i) => (
                                                <div key={i} className="flex items-center gap-2 text-sm">
                                                    <div className="w-6 h-6 bg-blue-100 rounded-md flex items-center justify-center text-xs font-bold text-blue-600">
                                                        {s.routeName?.charAt(0) || '?'}
                                                    </div>
                                                    <span className="font-medium text-gray-700">{s.routeName}</span>
                                                    <span className="text-gray-400 text-xs">{s.trips?.length || 0} trips</span>
                                                </div>
                                            ))}
                                            {selectedDraft.schedules.length > 5 && (
                                                <p className="text-xs text-gray-400">+{selectedDraft.schedules.length - 5} more routes</p>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-400">No routes in this draft</p>
                                    )}
                                </div>

                                {/* Version History */}
                                <div>
                                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Version History</h4>
                                    {loadingVersions ? (
                                        <div className="flex items-center justify-center py-8">
                                            <Loader2 size={20} className="animate-spin text-gray-400" />
                                        </div>
                                    ) : versions.length > 0 ? (
                                        <div className="space-y-2">
                                            {versions.slice(0, 5).map(v => (
                                                <div key={v.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-700">{v.label || 'Auto-save'}</p>
                                                        <p className="text-xs text-gray-400">{formatDate(v.savedAt)}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRestore(v.id)}
                                                        disabled={restoringVersionId === v.id}
                                                        className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {restoringVersionId === v.id ? (
                                                            <><Loader2 size={12} className="animate-spin" /> Restoring...</>
                                                        ) : (
                                                            <><RotateCcw size={12} /> Restore</>
                                                        )}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-400 bg-white rounded-lg border border-gray-200 p-4 text-center">No saved versions yet</p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 py-20">
                                <FileText size={48} className="mb-4 opacity-20" />
                                <p className="font-bold">Select a draft</p>
                                <p className="text-sm">to view details and actions</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
