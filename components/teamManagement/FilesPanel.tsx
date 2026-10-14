import React, { useEffect, useState } from 'react';
import { Clock, Download, FileText, FolderOpen, HardDrive, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
    getAllFiles,
    getAllUploadedFilesForAdmin,
    type SavedFile,
} from '../../utils/services/dataService';
import { filterUploadsForTeam } from '../../utils/adminUploadScope';

type UploadScope = 'team' | 'mine' | 'all';
type FileTypeFilter = 'all' | SavedFile['type'];

interface FilesPanelProps {
    teamId?: string;
    initialSearch?: string;
}

const SCOPE_LABELS: Record<UploadScope, string> = {
    team: 'Team uploads',
    mine: 'My uploads',
    all: 'All uploads',
};

const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (date: Date): string => new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
}).format(date);

const getFileCategoryLabel = (type: SavedFile['type']): string => {
    switch (type) {
        case 'schedule_master':
            return 'Master Schedule';
        case 'rideco':
            return 'RideCo';
        case 'barrie_tod':
            return 'Barrie TOD';
        default:
            return 'Other';
    }
};

const getUploaderLabel = (file: SavedFile): string => (
    file.ownerDisplayName || file.ownerEmail || file.ownerUserId || 'Unknown user'
);

export const FilesPanel: React.FC<FilesPanelProps> = ({ teamId, initialSearch = '' }) => {
    const { user } = useAuth();
    const userId = user?.uid;
    const [scope, setScope] = useState<UploadScope>('team');
    const [files, setFiles] = useState<SavedFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [search, setSearch] = useState(initialSearch);
    const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all');

    useEffect(() => {
        if (!userId) return undefined;

        let cancelled = false;
        setLoading(true);
        setError('');

        const load = async (): Promise<void> => {
            try {
                const loaded = scope === 'mine'
                    ? await getAllFiles(userId)
                    : await getAllUploadedFilesForAdmin();
                if (cancelled) return;
                setFiles(scope === 'team' ? filterUploadsForTeam(loaded, teamId) : loaded);
            } catch (loadError) {
                if (cancelled) return;
                console.error('Error loading uploads:', loadError);
                setError('Failed to load uploads.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();
        return () => { cancelled = true; };
    }, [scope, teamId, userId]);

    const query = search.trim().toLowerCase();
    const visibleFiles = files.filter(file => {
        const matchesSearch = !query ||
            file.name.toLowerCase().includes(query) ||
            getUploaderLabel(file).toLowerCase().includes(query) ||
            file.teamNameAtUpload?.toLowerCase().includes(query) ||
            file.teamIdAtUpload?.toLowerCase().includes(query) ||
            file.resolvedTeamName?.toLowerCase().includes(query) ||
            file.resolvedTeamId?.toLowerCase().includes(query);
        return matchesSearch && (typeFilter === 'all' || file.type === typeFilter);
    });

    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <p className="text-base font-bold text-gray-950">Files</p>
                        <p className="text-sm text-gray-500">Review File Manager uploads by upload-time team, your account, or all users.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(SCOPE_LABELS) as UploadScope[]).map(option => (
                            <button
                                key={option}
                                onClick={() => setScope(option)}
                                className={`rounded-lg px-3 py-2 text-sm font-bold ${
                                    scope === option ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                {SCOPE_LABELS[option]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search file, uploader, or team"
                            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
                        />
                    </div>
                    <select
                        value={typeFilter}
                        onChange={(event) => setTypeFilter(event.target.value as FileTypeFilter)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700"
                    >
                        <option value="all">All file types</option>
                        <option value="schedule_master">Master Schedule</option>
                        <option value="rideco">RideCo</option>
                        <option value="barrie_tod">Barrie TOD</option>
                        <option value="other">Other</option>
                    </select>
                </div>
            </div>

            {error && <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

            {loading ? (
                <p className="p-6 text-sm text-gray-500">Loading files...</p>
            ) : visibleFiles.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                    <FolderOpen className="mx-auto mb-3 opacity-40" size={42} />
                    <p className="font-bold">No files found</p>
                    <p className="text-sm">Try another scope or search.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-3">File</th>
                                <th className="px-4 py-3">Uploader</th>
                                <th className="px-4 py-3">Team</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Size</th>
                                <th className="px-4 py-3">Uploaded</th>
                                <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleFiles.map(file => (
                                <tr key={`${file.ownerUserId ?? 'mine'}-${file.id}`} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <FileText size={16} className="text-brand-blue" />
                                            <span className="truncate font-bold text-gray-900">{file.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-blue-700">{getUploaderLabel(file)}</td>
                                    <td className="px-4 py-3 text-gray-600">
                                        <span className="font-semibold">
                                            {file.resolvedTeamName || file.teamNameAtUpload || file.resolvedTeamId || file.teamIdAtUpload || 'No team recorded'}
                                        </span>
                                        {file.teamAttributionSource === 'owner_profile_fallback' && (
                                            <span className="ml-1 text-xs text-amber-600">(legacy profile)</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">{getFileCategoryLabel(file.type)}</td>
                                    <td className="px-4 py-3 text-gray-600">
                                        <span className="inline-flex items-center gap-1"><HardDrive size={13} />{formatFileSize(file.size)}</span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">
                                        <span className="inline-flex items-center gap-1"><Clock size={13} />{formatDate(file.uploadedAt)}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <a
                                            href={file.downloadUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                                        >
                                            <Download size={14} />
                                            Open
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
