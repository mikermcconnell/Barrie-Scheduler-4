/**
 * Transit App Data Import
 *
 * Folder upload + drag-and-drop import of Transit App CSV files.
 * Three states: Select → Preview → Processing/Complete.
 */

import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Upload,
    FolderOpen,
    FileText,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    ArrowRight,
    X,
    BarChart3,
} from 'lucide-react';
import { detectTransitAppFiles } from '../../utils/transitAppParsers';
import { parseAllFiles } from '../../utils/transitAppParsers';
import { aggregateTransitAppData } from '../../utils/transitAppAggregator';
import { saveTransitAppData } from '../../utils/transitAppService';
import type {
    DetectedTransitAppFile,
    TransitAppFileType,
    TransitAppFileStats,
} from '../../utils/transitAppTypes';

interface TransitAppImportProps {
    teamId: string;
    userId: string;
    onImportComplete: () => void;
    onCancel: () => void;
}

type ImportPhase = 'select' | 'preview' | 'processing' | 'complete' | 'error';

const FILE_TYPE_LABELS: Record<TransitAppFileType, string> = {
    lines: 'Route Metrics',
    trips: 'Trip Requests',
    locations: 'User Locations',
    go_trip_legs: 'GO Trip Legs',
    planned_go_trip_legs: 'Planned Trip Legs',
    tapped_trip_view_legs: 'Tapped Trip Legs',
    users: 'App Usage',
};

const FILE_TYPE_ORDER: TransitAppFileType[] = [
    'lines', 'trips', 'locations',
    'go_trip_legs', 'planned_go_trip_legs', 'tapped_trip_view_legs',
    'users',
];

export const TransitAppImport: React.FC<TransitAppImportProps> = ({
    teamId,
    userId,
    onImportComplete,
    onCancel,
}) => {
    const [phase, setPhase] = useState<ImportPhase>('select');
    const [detected, setDetected] = useState<DetectedTransitAppFile[]>([]);
    const [unrecognized, setUnrecognized] = useState<File[]>([]);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [completedStats, setCompletedStats] = useState<TransitAppFileStats | null>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    // Handle files from dropzone or folder input
    const handleFiles = useCallback((files: File[]) => {
        const result = detectTransitAppFiles(files);
        if (result.detected.length === 0) {
            setErrorMessage('No Transit App CSV files detected. Expected files like lines_2025-01-01.csv, trips_2025-01-01.csv, etc.');
            setPhase('error');
            return;
        }
        setDetected(result.detected);
        setUnrecognized(result.unrecognized);
        setPhase('preview');
    }, []);

    // Dropzone for drag-and-drop
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleFiles,
        noClick: true, // We have our own click handlers
        multiple: true,
    });

    // Folder input handler
    const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) handleFiles(files);
    };

    // File click handler (for choosing individual files)
    const handleFileClick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.csv';
        input.onchange = (e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            if (files.length > 0) handleFiles(files);
        };
        input.click();
    };

    // Run the import
    const runImport = async () => {
        setPhase('processing');
        setProgress(0);
        setProgressText('Starting import...');

        try {
            // Phase 1: Parse all files
            const { data, stats } = await parseAllFiles(detected, (p) => {
                const pct = Math.round((p.current / p.total) * 70); // Parsing = 0-70%
                setProgress(pct);
                setProgressText(`${p.phase}... ${p.current}/${p.total}`);
            });

            // Phase 2: Aggregate
            setProgress(75);
            setProgressText('Aggregating data...');
            const summary = aggregateTransitAppData(data, stats, userId);

            // Phase 3: Save to Firebase
            setProgress(90);
            setProgressText('Saving to Firebase...');
            await saveTransitAppData(teamId, userId, summary);

            setProgress(100);
            setCompletedStats(stats);
            setPhase('complete');
        } catch (err) {
            console.error('Import failed:', err);
            setErrorMessage(err instanceof Error ? err.message : 'Import failed');
            setPhase('error');
        }
    };

    // Compute preview stats
    const getPreviewStats = () => {
        const byType: Partial<Record<TransitAppFileType, number>> = {};
        const dates: string[] = [];
        for (const f of detected) {
            byType[f.type] = (byType[f.type] || 0) + 1;
            if (f.date) dates.push(f.date);
        }
        dates.sort();
        return {
            byType,
            dateRange: dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null,
            totalFiles: detected.length,
        };
    };

    // ============ RENDER ============

    // SELECT PHASE
    if (phase === 'select') {
        return (
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-gray-900">Import Transit App Data</h2>
                    <p className="text-gray-500">
                        Upload the folder of CSV files exported from Transit App. Files should be named like{' '}
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">lines_2025-01-01.csv</code>.
                    </p>
                </div>

                <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-200 ${
                        isDragActive
                            ? 'border-cyan-500 bg-cyan-50 scale-[1.01]'
                            : 'border-gray-300 hover:border-cyan-400 hover:bg-gray-50'
                    }`}
                >
                    <input {...getInputProps()} />
                    <div className="flex flex-col items-center space-y-4">
                        <div className="bg-cyan-50 p-4 rounded-full">
                            <Upload className="text-cyan-600" size={32} />
                        </div>
                        <div>
                            <p className="text-lg font-bold text-gray-700">Drag and drop files here</p>
                            <p className="text-sm text-gray-500 mt-1">Or use the buttons below</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 justify-center">
                    <button
                        onClick={() => folderInputRef.current?.click()}
                        className="px-5 py-2.5 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors flex items-center gap-2"
                    >
                        <FolderOpen size={18} />
                        Upload Folder
                    </button>
                    <button
                        onClick={handleFileClick}
                        className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                    >
                        <FileText size={18} />
                        Select Files
                    </button>
                    <button
                        onClick={onCancel}
                        className="px-5 py-2.5 text-gray-500 hover:text-gray-700 font-medium"
                    >
                        Cancel
                    </button>
                </div>

                {/* Hidden folder input */}
                <input
                    ref={folderInputRef}
                    type="file"
                    /* @ts-expect-error webkitdirectory is non-standard but widely supported */
                    webkitdirectory=""
                    directory=""
                    multiple
                    className="hidden"
                    onChange={handleFolderSelect}
                />

                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500 space-y-1">
                    <p className="font-medium text-gray-600">Expected file types:</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                        {FILE_TYPE_ORDER.map(type => (
                            <span key={type}>
                                <code className="text-gray-400">{type === 'users' ? 'users.csv' : `${type}_*.csv`}</code>{' '}
                                — {FILE_TYPE_LABELS[type]}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // PREVIEW PHASE
    if (phase === 'preview') {
        const stats = getPreviewStats();

        return (
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-gray-900">Files Detected</h2>
                    <p className="text-gray-500">
                        Found <span className="font-bold text-cyan-600">{stats.totalFiles}</span> Transit App files.
                        Review and confirm the import.
                    </p>
                </div>

                {/* Date range badge */}
                {stats.dateRange && (
                    <div className="flex justify-center">
                        <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-cyan-50 text-cyan-700 rounded-full text-sm font-medium border border-cyan-200">
                            {stats.dateRange.start} to {stats.dateRange.end}
                        </span>
                    </div>
                )}

                {/* Files by type */}
                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                    {FILE_TYPE_ORDER.map(type => {
                        const count = stats.byType[type] || 0;
                        if (count === 0) return null;
                        return (
                            <div key={type} className="flex items-center justify-between px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <FileText size={16} className="text-gray-400" />
                                    <span className="font-medium text-gray-700">{FILE_TYPE_LABELS[type]}</span>
                                </div>
                                <span className="text-sm font-bold text-gray-500">{count} file{count !== 1 ? 's' : ''}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Missing types warning */}
                {FILE_TYPE_ORDER.filter(t => !stats.byType[t]).length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                        <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-amber-700">
                            <span className="font-medium">Missing file types: </span>
                            {FILE_TYPE_ORDER.filter(t => !stats.byType[t]).map(t => FILE_TYPE_LABELS[t]).join(', ')}.
                            Import will continue — those dashboard sections will show "No data."
                        </div>
                    </div>
                )}

                {/* Unrecognized files warning */}
                {unrecognized.length > 0 && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-3">
                        <AlertTriangle size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-gray-500">
                            {unrecognized.length} unrecognized file{unrecognized.length !== 1 ? 's' : ''} will be skipped.
                        </div>
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center justify-center gap-3">
                    <button
                        onClick={runImport}
                        className="px-6 py-2.5 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors flex items-center gap-2"
                    >
                        <ArrowRight size={18} />
                        Import {stats.totalFiles} Files
                    </button>
                    <button
                        onClick={() => {
                            setPhase('select');
                            setDetected([]);
                            setUnrecognized([]);
                        }}
                        className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Back
                    </button>
                </div>
            </div>
        );
    }

    // PROCESSING PHASE
    if (phase === 'processing') {
        return (
            <div className="max-w-lg mx-auto space-y-6 text-center py-12">
                <Loader2 className="mx-auto text-cyan-500 animate-spin" size={48} />
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">Importing Data</h2>
                    <p className="text-sm text-gray-500">{progressText}</p>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                        className="bg-cyan-500 h-3 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <p className="text-sm font-medium text-gray-400">{progress}%</p>
            </div>
        );
    }

    // COMPLETE PHASE
    if (phase === 'complete') {
        return (
            <div className="max-w-lg mx-auto space-y-6 text-center py-12">
                <CheckCircle2 className="mx-auto text-emerald-500" size={48} />
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">Import Complete</h2>
                    <p className="text-sm text-gray-500">
                        Parsed {completedStats?.rowsParsed.toLocaleString()} rows from {completedStats?.totalFiles} files.
                        {(completedStats?.rowsSkipped ?? 0) > 0 && (
                            <span className="text-amber-600"> ({completedStats?.rowsSkipped} rows skipped)</span>
                        )}
                    </p>
                </div>

                {completedStats?.dateRange && (
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-cyan-50 text-cyan-700 rounded-full text-sm font-medium border border-cyan-200">
                        {completedStats.dateRange.start} to {completedStats.dateRange.end}
                    </div>
                )}

                <button
                    onClick={onImportComplete}
                    className="px-6 py-2.5 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors flex items-center gap-2 mx-auto"
                >
                    <BarChart3 size={18} />
                    View Dashboard
                </button>
            </div>
        );
    }

    // ERROR PHASE
    return (
        <div className="max-w-lg mx-auto space-y-6 text-center py-12">
            <div className="bg-red-50 p-4 rounded-full inline-block">
                <X className="text-red-500" size={48} />
            </div>
            <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Import Failed</h2>
                <p className="text-sm text-red-600">{errorMessage}</p>
            </div>
            <div className="flex items-center justify-center gap-3">
                <button
                    onClick={() => {
                        setPhase('select');
                        setDetected([]);
                        setUnrecognized([]);
                        setErrorMessage('');
                    }}
                    className="px-6 py-2.5 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors"
                >
                    Try Again
                </button>
                <button
                    onClick={onCancel}
                    className="px-6 py-2.5 text-gray-500 hover:text-gray-700 font-medium"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};
