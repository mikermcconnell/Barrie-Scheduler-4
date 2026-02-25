/**
 * OD Import File Manager
 *
 * Self-contained dropdown for managing saved OD matrix datasets.
 * Supports switching, renaming, and deleting imports.
 * Fetches the import list on open — no parent state required.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FolderOpen, ChevronDown, Check, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
    listODMatrixImports,
    renameODMatrixImport,
    deleteODMatrixImport,
} from '../../utils/od-matrix/odMatrixService';
import type { ODMatrixImportRecord } from '../../utils/od-matrix/odMatrixTypes';

interface ODImportFileManagerProps {
    teamId: string;
    activeImportId: string | undefined;
    onSwitch: (importId: string) => void;
    onDeleted: (deletedId: string, result: string | null | 'unchanged') => void;
    onReimport: () => void;
}

export const ODImportFileManager: React.FC<ODImportFileManagerProps> = ({
    teamId,
    activeImportId,
    onSwitch,
    onDeleted,
    onReimport,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [imports, setImports] = useState<ODMatrixImportRecord[]>([]);
    const [loadingImports, setLoadingImports] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Click-outside dismissal (suppressed while delete modal is open)
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (deletingId !== null) return;
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setRenamingId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, deletingId]);

    // Fetch imports when dropdown opens
    const handleToggle = useCallback(async () => {
        if (isOpen) {
            setIsOpen(false);
            setRenamingId(null);
            return;
        }
        setIsOpen(true);
        setLoadingImports(true);
        try {
            const list = await listODMatrixImports(teamId);
            setImports(list);
        } finally {
            setLoadingImports(false);
        }
    }, [isOpen, teamId]);

    // Focus rename input
    useEffect(() => {
        if (renamingId && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingId]);

    const handleStartRename = (imp: ODMatrixImportRecord, e: React.MouseEvent) => {
        e.stopPropagation();
        setRenamingId(imp.id);
        setRenameValue(imp.fileName);
    };

    const handleCommitRename = async (importId: string) => {
        const trimmed = renameValue.trim();
        if (!trimmed || trimmed === imports.find(i => i.id === importId)?.fileName) {
            setRenamingId(null);
            return;
        }
        setBusy(true);
        try {
            await renameODMatrixImport(teamId, importId, trimmed);
            setImports(prev =>
                prev.map(imp => imp.id === importId ? { ...imp, fileName: trimmed } : imp)
            );
        } finally {
            setBusy(false);
            setRenamingId(null);
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deletingId) return;
        const idToDelete = deletingId;
        setBusy(true);
        try {
            const result = await deleteODMatrixImport(teamId, idToDelete);
            setImports(prev => prev.filter(imp => imp.id !== idToDelete));
            onDeleted(idToDelete, result);
        } catch (err) {
            console.error('Failed to delete OD import:', err);
        } finally {
            setBusy(false);
            setDeletingId(null);
            setIsOpen(false);
        }
    };

    const handleSwitch = (imp: ODMatrixImportRecord) => {
        if (imp.id === activeImportId || renamingId) return;
        setIsOpen(false);
        onSwitch(imp.id);
    };

    return (
        <>
            <div className="relative" ref={dropdownRef}>
                <button
                    onClick={handleToggle}
                    className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                    <FolderOpen size={16} />
                    <span className="hidden sm:inline">Datasets</span>
                    <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute top-full right-0 mt-1 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50">
                        {/* Header */}
                        <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                                Saved Datasets
                            </p>
                            <button
                                onClick={() => { setIsOpen(false); onReimport(); }}
                                className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                            >
                                + Import New
                            </button>
                        </div>

                        {/* List */}
                        <div className="max-h-64 overflow-y-auto">
                            {loadingImports ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 size={18} className="animate-spin text-gray-400" />
                                </div>
                            ) : imports.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-8">No datasets found.</p>
                            ) : (
                                imports.map(imp => {
                                    const isActive = imp.id === activeImportId;
                                    const isRenaming = renamingId === imp.id;
                                    const date = new Date(imp.importedAt).toLocaleDateString('en-CA', {
                                        month: 'short',
                                        day: 'numeric',
                                    });

                                    return (
                                        <div
                                            key={imp.id}
                                            onClick={() => !isRenaming && handleSwitch(imp)}
                                            className={`flex items-center gap-2 px-3 py-2.5 group transition-colors ${
                                                isActive
                                                    ? 'bg-violet-50'
                                                    : 'hover:bg-gray-50 cursor-pointer'
                                            }`}
                                        >
                                            {/* Active indicator */}
                                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                                isActive ? 'bg-violet-500' : 'bg-gray-200'
                                            }`} />

                                            {/* Name + meta */}
                                            <div className="flex-1 min-w-0">
                                                {isRenaming ? (
                                                    <input
                                                        ref={renameInputRef}
                                                        value={renameValue}
                                                        onChange={e => setRenameValue(e.target.value)}
                                                        onBlur={() => handleCommitRename(imp.id)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') handleCommitRename(imp.id);
                                                            if (e.key === 'Escape') setRenamingId(null);
                                                        }}
                                                        onClick={e => e.stopPropagation()}
                                                        disabled={busy}
                                                        className="w-full text-sm border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                                    />
                                                ) : (
                                                    <p
                                                        className={`text-sm font-medium truncate ${
                                                            isActive ? 'text-violet-800' : 'text-gray-700'
                                                        }`}
                                                        title={imp.fileName}
                                                    >
                                                        {imp.fileName}
                                                    </p>
                                                )}
                                                <p className="text-[11px] text-gray-400">
                                                    {date} &middot; {imp.stationCount} stations &middot; {imp.totalJourneys.toLocaleString()} journeys
                                                </p>
                                            </div>

                                            {/* Active check */}
                                            {isActive && !isRenaming && (
                                                <Check size={14} className="text-violet-500 flex-shrink-0" />
                                            )}

                                            {/* Action buttons */}
                                            <div
                                                className={`flex items-center gap-0.5 flex-shrink-0 transition-opacity ${
                                                    isRenaming ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
                                                }`}
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <button
                                                    onClick={e => handleStartRename(imp, e)}
                                                    disabled={busy}
                                                    className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-200 transition-colors"
                                                    title="Rename"
                                                >
                                                    <Pencil size={12} />
                                                </button>
                                                <button
                                                    onClick={() => setDeletingId(imp.id)}
                                                    disabled={busy || imports.length <= 1}
                                                    className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    title={imports.length <= 1 ? 'Cannot delete the only dataset' : 'Delete'}
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Delete confirmation modal */}
            <Modal
                isOpen={deletingId !== null}
                onClose={() => setDeletingId(null)}
                size="sm"
                zIndex="high"
            >
                <Modal.Header>Delete Dataset</Modal.Header>
                <Modal.Body>
                    <p className="text-sm text-gray-600">
                        Delete <strong>{imports.find(i => i.id === deletingId)?.fileName}</strong>?
                        This removes the data file permanently and cannot be undone.
                    </p>
                    {deletingId === activeImportId && (
                        <p className="mt-2 text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
                            This is the active dataset. The most recent remaining import will become active.
                        </p>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <button
                        onClick={() => setDeletingId(null)}
                        className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleDeleteConfirm}
                        disabled={busy}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {busy && <Loader2 size={14} className="animate-spin" />}
                        Delete
                    </button>
                </Modal.Footer>
            </Modal>
        </>
    );
};
