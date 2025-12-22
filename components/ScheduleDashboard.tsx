
import React, { useState } from 'react';
import {
    Plus,
    FileText,
    ChevronRight,
    FileSpreadsheet,
    Loader2,
    Sparkles,
    Trash2
} from 'lucide-react';
import { FileUpload } from './FileUpload';
import { ScheduleDraft, SavedFile } from '../utils/dataService';

interface ScheduleDashboardProps {
    drafts: ScheduleDraft[];
    savedFiles: SavedFile[];
    user: any; // Using any for now to match rapid refactor, ideally User type
    isProcessing: boolean;
    onLoadDraft: (draft: ScheduleDraft) => void;
    onLoadFile: (file: SavedFile) => void;
    onDeleteFile?: (file: SavedFile) => void;
    onUpload: (file: File) => void;
    onViewNewSchedule: () => void;
}

export const ScheduleDashboard: React.FC<ScheduleDashboardProps> = ({
    drafts,
    savedFiles,
    user,
    isProcessing,
    onLoadDraft,
    onLoadFile,
    onDeleteFile,
    onUpload,
    onViewNewSchedule
}) => {
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            <div className="max-w-6xl mx-auto mt-8 animate-in fade-in slide-in-from-bottom-2 duration-500 px-6 pb-12">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Schedule Manager</h2>
                        <p className="text-gray-500 text-sm mt-1">Upload a master schedule file or load a saved version.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* Upload Column */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm col-span-1 lg:col-span-5 hover:border-blue-300 transition-colors">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="bg-gray-100 p-2 rounded-lg text-gray-600">
                                <Plus size={20} />
                            </div>
                            <h3 className="font-bold text-gray-900">Upload New Schedule</h3>
                        </div>

                        {isProcessing ? (
                            <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/50">
                                <Loader2 className="animate-spin text-blue-600 mb-4" size={32} />
                                <h2 className="text-sm font-semibold text-gray-900">Processing File...</h2>
                                <p className="text-xs text-gray-500">Parsing blocks, trips, and stops.</p>
                            </div>
                        ) : (
                            <div className="h-64">
                                <FileUpload
                                    onFileUpload={onUpload}
                                    title="Drop Master Schedule (.xlsx)"
                                    subtitle="Auto-detects routes and blocks"
                                    accept=".xlsx"
                                    allowMultiple={false}
                                />
                            </div>
                        )}

                        <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
                            <Sparkles size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-blue-800">
                                <span className="font-bold">Pro Tip:</span> Ensure your Excel file has sheets named by route number (e.g., "400", "8A") for automatic detection.
                            </div>
                        </div>
                    </div>

                    {/* Recent Drafts Column */}
                    <div className="bg-white p-0 rounded-xl border border-gray-200 shadow-sm h-full max-h-[500px] flex flex-col overflow-hidden col-span-1 lg:col-span-4 hover:border-blue-300 transition-colors">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <h3 className="font-bold text-gray-900 text-sm">Saved Drafts</h3>
                            <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{drafts.length}</span>
                        </div>

                        <div className="flex-grow overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {user ? (
                                drafts.length === 0 ? (
                                    <div className="text-center py-12 text-gray-400">
                                        <FileText className="mx-auto mb-2 opacity-20" size={32} />
                                        <p className="text-xs">No saved drafts.</p>
                                    </div>
                                ) : (
                                    drafts.slice(0, 10).map(draft => (
                                        <button
                                            key={draft.id}
                                            onClick={() => onLoadDraft(draft)}
                                            className="w-full text-left p-3 rounded-lg border border-transparent hover:bg-blue-50/50 hover:border-blue-100 transition-all group flex items-center gap-3"
                                        >
                                            <div className="bg-blue-50 text-blue-600 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <FileText size={16} />
                                            </div>
                                            <div className="flex-grow min-w-0">
                                                <h4 className="font-medium text-gray-900 text-sm truncate group-hover:text-blue-700 transition-colors">{draft.name}</h4>
                                                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                                    <span>{new Date(draft.updatedAt).toLocaleDateString()}</span>
                                                    <span>•</span>
                                                    <span>{draft.routeCount || 0} routes</span>
                                                </div>
                                            </div>
                                            <ChevronRight size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </button>
                                    ))
                                )
                            ) : (
                                <div className="p-4 text-center">
                                    <p className="text-xs text-gray-500">Sign in to view saved drafts.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Recent Files Column */}
                    <div className="bg-white p-0 rounded-xl border border-gray-200 shadow-sm h-full max-h-[500px] flex flex-col overflow-hidden col-span-1 lg:col-span-3 hover:border-green-300 transition-colors">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <h3 className="font-bold text-gray-900 text-sm">Recent Files</h3>
                            <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{savedFiles.length}</span>
                        </div>

                        <div className="flex-grow overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {user ? (
                                savedFiles.length === 0 ? (
                                    <div className="text-center py-12 text-gray-400">
                                        <FileSpreadsheet className="mx-auto mb-2 opacity-20" size={32} />
                                        <p className="text-xs">No saved schedules.</p>
                                    </div>
                                ) : (
                                    savedFiles.map(file => (
                                        <div key={file.id} className="relative group">
                                            <button
                                                onClick={() => onLoadFile(file)}
                                                disabled={isProcessing}
                                                className="w-full text-left p-3 rounded-lg border border-transparent hover:bg-gray-50 hover:border-gray-100 transition-all flex items-center gap-3"
                                            >
                                                <div className="bg-green-50 text-green-600 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
                                                    <FileSpreadsheet size={16} />
                                                </div>
                                                <div className="flex-grow min-w-0">
                                                    <h4 className="font-medium text-gray-900 text-sm truncate group-hover:text-blue-600 transition-colors">{file.name}</h4>
                                                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                                        <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                                                        <span>•</span>
                                                        <span>{(file.size / 1024).toFixed(0)} KB</span>
                                                    </div>
                                                </div>
                                                <ChevronRight size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </button>
                                            {/* Delete button */}
                                            {onDeleteFile && (
                                                deleteConfirmId === file.id ? (
                                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 bg-white shadow-lg rounded-lg p-1 border border-gray-200">
                                                        <button
                                                            onClick={() => { onDeleteFile(file); setDeleteConfirmId(null); }}
                                                            className="px-2 py-1 bg-red-600 text-white text-[10px] font-bold rounded hover:bg-red-700"
                                                        >
                                                            Delete
                                                        </button>
                                                        <button
                                                            onClick={() => setDeleteConfirmId(null)}
                                                            className="px-2 py-1 bg-gray-100 text-gray-600 text-[10px] font-bold rounded hover:bg-gray-200"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(file.id); }}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                                                        title="Delete file"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    ))
                                )
                            ) : (
                                <div className="p-4 text-center">
                                    <p className="text-xs text-gray-500">Sign in to view saved files.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
