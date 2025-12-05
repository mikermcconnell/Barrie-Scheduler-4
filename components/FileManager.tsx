import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import {
    getAllFiles,
    getAllSchedules,
    deleteFile,
    deleteSchedule,
    uploadFile,
    SavedFile,
    SavedSchedule
} from '../utils/dataService';
import {
    FolderOpen,
    FileText,
    Calendar,
    Trash2,
    Download,
    Upload,
    Search,
    Grid3X3,
    List,
    MoreVertical,
    Clock,
    HardDrive,
    Filter,
    ChevronDown,
    FileSpreadsheet,
    Bus,
    Loader2,
    AlertCircle,
    X,
    Plus
} from 'lucide-react';

interface FileManagerProps {
    onSelectFile?: (file: SavedFile) => void;
    onSelectSchedule?: (schedule: SavedSchedule) => void;
    onClose: () => void;
}

type ViewMode = 'grid' | 'list';
type Tab = 'files' | 'schedules';
type FileFilter = 'all' | 'schedule_master' | 'rideco' | 'barrie_tod' | 'other';

export const FileManager: React.FC<FileManagerProps> = ({
    onSelectFile,
    onSelectSchedule,
    onClose
}) => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<Tab>('schedules');
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [files, setFiles] = useState<SavedFile[]>([]);
    const [schedules, setSchedules] = useState<SavedSchedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [fileFilter, setFileFilter] = useState<FileFilter>('all');
    const [uploading, setUploading] = useState(false);
    const [menuOpen, setMenuOpen] = useState<string | null>(null);

    useEffect(() => {
        if (user) {
            loadData();
        }
    }, [user]);

    const loadData = async () => {
        if (!user) return;
        setLoading(true);
        setError('');
        try {
            const [filesData, schedulesData] = await Promise.all([
                getAllFiles(user.uid),
                getAllSchedules(user.uid)
            ]);
            setFiles(filesData);
            setSchedules(schedulesData);
        } catch (err: any) {
            setError(err.message || 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!user || !e.target.files?.length) return;
        const file = e.target.files[0];

        // Determine file type from name
        let fileType: SavedFile['type'] = 'other';
        const lowerName = file.name.toLowerCase();
        if (lowerName.includes('schedule') && lowerName.includes('master')) {
            fileType = 'schedule_master';
        } else if (lowerName.includes('rideco') || lowerName.includes('template') && lowerName.includes('shift')) {
            fileType = 'rideco';
        } else if (lowerName.includes('barrie') || lowerName.includes('tod') || lowerName.includes('on demand') || lowerName.includes('on-demand')) {
            fileType = 'barrie_tod';
        }

        setUploading(true);
        try {
            const savedFile = await uploadFile(user.uid, file, fileType);
            setFiles(prev => [savedFile, ...prev]);
        } catch (err: any) {
            setError(err.message || 'Failed to upload file');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleDeleteFile = async (file: SavedFile) => {
        if (!user || !confirm(`Delete "${file.name}"?`)) return;
        try {
            await deleteFile(user.uid, file.id, file.storagePath);
            setFiles(prev => prev.filter(f => f.id !== file.id));
        } catch (err: any) {
            setError(err.message || 'Failed to delete file');
        }
        setMenuOpen(null);
    };

    const handleDeleteSchedule = async (schedule: SavedSchedule) => {
        if (!user || !confirm(`Delete "${schedule.name}"?`)) return;
        try {
            await deleteSchedule(user.uid, schedule.id);
            setSchedules(prev => prev.filter(s => s.id !== schedule.id));
        } catch (err: any) {
            setError(err.message || 'Failed to delete schedule');
        }
        setMenuOpen(null);
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

    const filteredFiles = files.filter(file => {
        const matchesSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = fileFilter === 'all' || file.type === fileFilter;
        return matchesSearch && matchesFilter;
    });

    const filteredSchedules = schedules.filter(schedule =>
        schedule.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getFileIcon = (type: SavedFile['type']) => {
        switch (type) {
            case 'schedule_master':
                return <Calendar className="text-brand-green" size={24} />;
            case 'rideco':
                return <Bus className="text-brand-blue" size={24} />;
            case 'barrie_tod':
                return <Bus className="text-purple-500" size={24} />;
            default:
                return <FileSpreadsheet className="text-gray-400" size={24} />;
        }
    };

    // Human-readable category names
    const getCategoryLabel = (type: SavedFile['type']) => {
        switch (type) {
            case 'schedule_master':
                return 'Master Schedule';
            case 'rideco':
                return 'RideCo Shift Templates';
            case 'barrie_tod':
                return 'Barrie Transit On Demand';
            default:
                return 'Other';
        }
    };

    const getStatusColor = (status: SavedSchedule['status']) => {
        switch (status) {
            case 'draft':
                return 'bg-amber-100 text-amber-700';
            case 'published':
                return 'bg-green-100 text-green-700';
            case 'archived':
                return 'bg-gray-100 text-gray-500';
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-300">

                {/* Header */}
                <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-5 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/10 p-2 rounded-xl">
                            <FolderOpen size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-extrabold">File Manager</h2>
                            <p className="text-white/60 text-sm font-medium">Manage your schedules and uploaded files</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4 bg-gray-50">
                    {/* Tabs */}
                    <div className="flex bg-gray-200 rounded-xl p-1">
                        <button
                            onClick={() => setActiveTab('schedules')}
                            className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${activeTab === 'schedules'
                                ? 'bg-white text-gray-800 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Calendar size={16} />
                                Schedules
                                <span className="bg-brand-green text-white text-xs px-2 py-0.5 rounded-full">
                                    {schedules.length}
                                </span>
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('files')}
                            className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${activeTab === 'files'
                                ? 'bg-white text-gray-800 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <FileText size={16} />
                                Files
                                <span className="bg-brand-blue text-white text-xs px-2 py-0.5 rounded-full">
                                    {files.length}
                                </span>
                            </span>
                        </button>
                    </div>

                    {/* Search & Actions */}
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-10 pr-4 py-2 bg-white border-2 border-gray-200 rounded-xl text-sm font-medium w-64 focus:border-brand-blue outline-none"
                            />
                        </div>

                        {activeTab === 'files' && (
                            <div className="relative">
                                <select
                                    value={fileFilter}
                                    onChange={e => setFileFilter(e.target.value as FileFilter)}
                                    className="appearance-none pl-3 pr-8 py-2 bg-white border-2 border-gray-200 rounded-xl text-sm font-medium focus:border-brand-blue outline-none cursor-pointer"
                                >
                                    <option value="all">All Categories</option>
                                    <option value="rideco">RideCo Shift Templates</option>
                                    <option value="schedule_master">Master Schedule</option>
                                    <option value="barrie_tod">Barrie Transit On Demand</option>
                                    <option value="other">Other</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                            </div>
                        )}

                        <div className="flex bg-gray-200 rounded-lg p-0.5">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-white shadow-sm' : ''}`}
                            >
                                <Grid3X3 size={16} className={viewMode === 'grid' ? 'text-gray-800' : 'text-gray-400'} />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-white shadow-sm' : ''}`}
                            >
                                <List size={16} className={viewMode === 'list' ? 'text-gray-800' : 'text-gray-400'} />
                            </button>
                        </div>

                        {activeTab === 'files' && (
                            <label className="bg-brand-blue hover:bg-blue-600 text-white font-bold px-4 py-2 rounded-xl cursor-pointer transition-colors flex items-center gap-2">
                                {uploading ? (
                                    <Loader2 className="animate-spin" size={18} />
                                ) : (
                                    <Upload size={18} />
                                )}
                                Upload
                                <input
                                    type="file"
                                    accept=".csv,.xlsx,.xls"
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                    className="hidden"
                                />
                            </label>
                        )}
                    </div>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="bg-red-50 border-b border-red-100 px-6 py-3 flex items-center gap-2 text-red-600 text-sm font-medium">
                        <AlertCircle size={16} />
                        {error}
                        <button onClick={() => setError('')} className="ml-auto hover:bg-red-100 p-1 rounded">
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* Content Area */}
                <div className="flex-1 overflow-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="animate-spin text-gray-400" size={32} />
                        </div>
                    ) : activeTab === 'schedules' ? (
                        /* Schedules View */
                        filteredSchedules.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                <Calendar size={48} className="mb-4 opacity-50" />
                                <p className="font-bold text-lg">No schedules yet</p>
                                <p className="text-sm">Create a schedule from the Transit On-Demand workspace</p>
                            </div>
                        ) : viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredSchedules.map(schedule => (
                                    <div
                                        key={schedule.id}
                                        className="bg-white border-2 border-gray-100 rounded-2xl p-5 hover:border-brand-green hover:shadow-lg transition-all cursor-pointer group relative"
                                        onClick={() => onSelectSchedule?.(schedule)}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="bg-green-100 p-3 rounded-xl">
                                                <Calendar className="text-brand-green" size={24} />
                                            </div>
                                            <div className="relative">
                                                <button
                                                    onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === schedule.id ? null : schedule.id); }}
                                                    className="p-2 hover:bg-gray-100 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <MoreVertical size={16} className="text-gray-400" />
                                                </button>
                                                {menuOpen === schedule.id && (
                                                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[120px] z-10">
                                                        <button
                                                            onClick={e => { e.stopPropagation(); handleDeleteSchedule(schedule); }}
                                                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                                        >
                                                            <Trash2 size={14} /> Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <h3 className="font-bold text-gray-800 mb-1 truncate">{schedule.name}</h3>
                                        {schedule.description && (
                                            <p className="text-sm text-gray-500 mb-3 line-clamp-2">{schedule.description}</p>
                                        )}
                                        <div className="flex items-center justify-between">
                                            <span className={`text-xs font-bold px-2 py-1 rounded-lg uppercase ${getStatusColor(schedule.status)}`}>
                                                {schedule.status}
                                            </span>
                                            <span className="text-xs text-gray-400 flex items-center gap-1">
                                                <Clock size={12} />
                                                {formatDate(schedule.updatedAt)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            /* List View for Schedules */
                            <div className="bg-white border-2 border-gray-100 rounded-2xl overflow-hidden">
                                <table className="w-full">
                                    <thead className="bg-gray-50 border-b border-gray-100">
                                        <tr>
                                            <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Name</th>
                                            <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Status</th>
                                            <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Last Updated</th>
                                            <th className="w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredSchedules.map(schedule => (
                                            <tr
                                                key={schedule.id}
                                                onClick={() => onSelectSchedule?.(schedule)}
                                                className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <Calendar className="text-brand-green" size={20} />
                                                        <span className="font-bold text-gray-800">{schedule.name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-lg uppercase ${getStatusColor(schedule.status)}`}>
                                                        {schedule.status}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-4 text-sm text-gray-500">{formatDate(schedule.updatedAt)}</td>
                                                <td className="px-3">
                                                    <button
                                                        onClick={e => { e.stopPropagation(); handleDeleteSchedule(schedule); }}
                                                        className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    ) : (
                        /* Files View */
                        filteredFiles.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                <FileText size={48} className="mb-4 opacity-50" />
                                <p className="font-bold text-lg">No files uploaded</p>
                                <p className="text-sm">Upload CSV or Excel files to get started</p>
                            </div>
                        ) : viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredFiles.map(file => (
                                    <div
                                        key={file.id}
                                        className="bg-white border-2 border-gray-100 rounded-2xl p-5 hover:border-brand-blue hover:shadow-lg transition-all cursor-pointer group relative"
                                        onClick={() => onSelectFile?.(file)}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="bg-gray-100 p-3 rounded-xl">
                                                {getFileIcon(file.type)}
                                            </div>
                                            <div className="relative">
                                                <button
                                                    onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === file.id ? null : file.id); }}
                                                    className="p-2 hover:bg-gray-100 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <MoreVertical size={16} className="text-gray-400" />
                                                </button>
                                                {menuOpen === file.id && (
                                                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[120px] z-10">
                                                        <a
                                                            href={file.downloadUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={e => e.stopPropagation()}
                                                            className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                                        >
                                                            <Download size={14} /> Download
                                                        </a>
                                                        <button
                                                            onClick={e => { e.stopPropagation(); handleDeleteFile(file); }}
                                                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                                        >
                                                            <Trash2 size={14} /> Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <h3 className="font-bold text-gray-800 mb-1 truncate">{file.name}</h3>
                                        <div className="text-xs text-gray-500 mb-2">
                                            {getCategoryLabel(file.type)}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-gray-400">
                                            <span className="flex items-center gap-1">
                                                <HardDrive size={12} />
                                                {formatFileSize(file.size)}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} />
                                                {formatDate(file.uploadedAt)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            /* List View for Files */
                            <div className="bg-white border-2 border-gray-100 rounded-2xl overflow-hidden">
                                <table className="w-full">
                                    <thead className="bg-gray-50 border-b border-gray-100">
                                        <tr>
                                            <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Name</th>
                                            <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Type</th>
                                            <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Size</th>
                                            <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Uploaded</th>
                                            <th className="w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredFiles.map(file => (
                                            <tr
                                                key={file.id}
                                                onClick={() => onSelectFile?.(file)}
                                                className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-3">
                                                        {getFileIcon(file.type)}
                                                        <span className="font-bold text-gray-800">{file.name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4 text-sm text-gray-500">{getCategoryLabel(file.type)}</td>
                                                <td className="px-5 py-4 text-sm text-gray-500">{formatFileSize(file.size)}</td>
                                                <td className="px-5 py-4 text-sm text-gray-500">{formatDate(file.uploadedAt)}</td>
                                                <td className="px-3">
                                                    <button
                                                        onClick={e => { e.stopPropagation(); handleDeleteFile(file); }}
                                                        className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}
                </div>

                {/* Footer Stats */}
                <div className="border-t border-gray-200 px-6 py-3 bg-gray-50 flex items-center justify-between text-sm text-gray-500">
                    <div className="flex items-center gap-4">
                        <span className="font-medium">
                            {activeTab === 'schedules'
                                ? `${filteredSchedules.length} schedule${filteredSchedules.length !== 1 ? 's' : ''}`
                                : `${filteredFiles.length} file${filteredFiles.length !== 1 ? 's' : ''}`
                            }
                        </span>
                    </div>
                    <span className="text-xs text-gray-400">
                        Cloud storage powered by Firebase
                    </span>
                </div>
            </div>
        </div>
    );
};
