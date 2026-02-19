import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Upload, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2,
    Loader2, ArrowRight, X, BarChart3,
} from 'lucide-react';
import { parseSTREETSFile, generatePreview } from '../../utils/performanceDataParser';
import { aggregateDailySummaries } from '../../utils/performanceDataAggregator';
import { savePerformanceData } from '../../utils/performanceDataService';
import { computeMissedTripsForDay } from '../../utils/gtfs/gtfsScheduleIndex';
import type { ImportPreview, PerformanceImportPhase, PerformanceDataSummary } from '../../utils/performanceDataTypes';
import { compareDateStrings } from '../../utils/performanceDateUtils';

interface PerformanceImportProps {
    teamId: string;
    userId: string;
    onImportComplete: () => void;
    onCancel: () => void;
}

export const PerformanceImport: React.FC<PerformanceImportProps> = ({
    teamId,
    userId,
    onImportComplete,
    onCancel,
}) => {
    const [phase, setPhase] = useState<PerformanceImportPhase>('select');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [completedStats, setCompletedStats] = useState<{ days: number; records: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback(async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
            setErrorMessage('Please upload an Excel (.xlsx/.xls) or CSV file.');
            setPhase('error');
            return;
        }

        setSelectedFile(file);
        setProgressText('Reading file...');
        setPhase('processing');

        try {
            const { records, warnings } = await parseSTREETSFile(file, (p) => {
                setProgress(Math.round((p.current / p.total) * 30));
                setProgressText(`Parsing: ${p.current.toLocaleString()} / ${p.total.toLocaleString()} rows`);
            });

            if (records.length === 0) {
                setErrorMessage('No valid records found. Check that this is a STREETS Datawarehouse export.');
                setPhase('error');
                return;
            }

            const prev = generatePreview(records, file.name, file.size);
            prev.warnings.push(...warnings);
            setPreview(prev);
            setPhase('preview');
        } catch (err) {
            console.error('Parse failed:', err);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to parse file');
            setPhase('error');
        }
    }, []);

    const handleDrop = useCallback((files: File[]) => {
        if (files[0]) handleFile(files[0]);
    }, [handleFile]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleDrop,
        noClick: true,
        multiple: false,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
            'text/csv': ['.csv'],
        },
    });

    const handleFileSelect = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) handleFile(file);
        };
        input.click();
    };

    const runImport = async () => {
        if (!selectedFile || !preview) return;
        setPhase('processing');
        setProgress(30);
        setProgressText('Parsing full dataset...');

        try {
            const { records } = await parseSTREETSFile(selectedFile, (p) => {
                setProgress(30 + Math.round((p.current / p.total) * 30));
                setProgressText(`Parsing: ${p.current.toLocaleString()} / ${p.total.toLocaleString()} rows`);
            });

            setProgress(65);
            setProgressText('Aggregating daily summaries...');
            const dailySummaries = aggregateDailySummaries(records, (p) => {
                setProgress(65 + Math.round((p.current / p.total) * 15));
                setProgressText(`Aggregating: ${p.phase}`);
            });

            // Enrich with GTFS missed trips
            for (const day of dailySummaries) {
                const result = computeMissedTripsForDay(day.date, day.dayType, day.byTrip);
                if (result) day.missedTrips = result;
            }

            setProgress(85);
            setProgressText('Saving to Firebase...');

            const dates = dailySummaries.map(s => s.date).sort(compareDateStrings);
            const summary: PerformanceDataSummary = {
                dailySummaries,
                metadata: {
                    importedAt: new Date().toISOString(),
                    importedBy: userId,
                    dateRange: { start: dates[0], end: dates[dates.length - 1] },
                    dayCount: dailySummaries.length,
                    totalRecords: records.length,
                },
                schemaVersion: 1,
            };

            await savePerformanceData(teamId, userId, summary);

            setProgress(100);
            setCompletedStats({ days: dailySummaries.length, records: records.length });
            setPhase('complete');
        } catch (err) {
            console.error('Import failed:', err);
            setErrorMessage(err instanceof Error ? err.message : 'Import failed');
            setPhase('error');
        }
    };

    // ─── SELECT ─────────────────────────────────────────────────
    if (phase === 'select') {
        return (
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-gray-900">Import STREETS Data</h2>
                    <p className="text-gray-500">
                        Upload an Excel or CSV export from the STREETS Datawarehouse (Eddy's ODBC pull).
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
                            <p className="text-lg font-bold text-gray-700">Drag and drop file here</p>
                            <p className="text-sm text-gray-500 mt-1">Excel (.xlsx) or CSV — typically ~7MB / ~36K rows per day</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 justify-center">
                    <button
                        onClick={handleFileSelect}
                        className="px-5 py-2.5 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors flex items-center gap-2"
                    >
                        <FileSpreadsheet size={18} />
                        Select File
                    </button>
                    <button
                        onClick={onCancel}
                        className="px-5 py-2.5 text-gray-500 hover:text-gray-700 font-medium"
                    >
                        Cancel
                    </button>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500 space-y-1">
                    <p className="font-medium text-gray-600">Expected columns include:</p>
                    <p className="text-xs text-gray-400">
                        VehicleID, Date, Day, ArrivalTime, ObservedArrivalTime, Boardings, Alightings,
                        RouteName, RouteID, StopName, TimePoint, InBetween, Block, TripName, DepartureLoad...
                    </p>
                </div>
            </div>
        );
    }

    // ─── PREVIEW ────────────────────────────────────────────────
    if (phase === 'preview' && preview) {
        return (
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-gray-900">Data Preview</h2>
                    <p className="text-gray-500">
                        <span className="font-bold text-cyan-600">{preview.rowCount.toLocaleString()}</span> records from{' '}
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{preview.fileName}</code>
                    </p>
                </div>

                {preview.dateRange && (
                    <div className="flex justify-center">
                        <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-cyan-50 text-cyan-700 rounded-full text-sm font-medium border border-cyan-200">
                            {preview.dateRange.start} to {preview.dateRange.end}
                        </span>
                    </div>
                )}

                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                    <div className="flex items-center justify-between px-4 py-3">
                        <span className="font-medium text-gray-700">Routes</span>
                        <span className="text-sm font-bold text-gray-500">{preview.routeIds.join(', ')}</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                        <span className="font-medium text-gray-700">Day Types</span>
                        <span className="text-sm font-bold text-gray-500">{preview.dayTypes.join(', ')}</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                        <span className="font-medium text-gray-700">File Size</span>
                        <span className="text-sm font-bold text-gray-500">{(preview.fileSize / 1024 / 1024).toFixed(1)} MB</span>
                    </div>
                </div>

                {preview.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                        <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-amber-700 space-y-1">
                            {preview.warnings.map((w, i) => <p key={i}>{w}</p>)}
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-center gap-3">
                    <button
                        onClick={runImport}
                        className="px-6 py-2.5 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors flex items-center gap-2"
                    >
                        <ArrowRight size={18} />
                        Import & Aggregate
                    </button>
                    <button
                        onClick={() => {
                            setPhase('select');
                            setSelectedFile(null);
                            setPreview(null);
                        }}
                        className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Back
                    </button>
                </div>
            </div>
        );
    }

    // ─── PROCESSING ─────────────────────────────────────────────
    if (phase === 'processing') {
        return (
            <div className="max-w-lg mx-auto space-y-6 text-center py-12">
                <Loader2 className="mx-auto text-cyan-500 animate-spin" size={48} />
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">Processing Data</h2>
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

    // ─── COMPLETE ───────────────────────────────────────────────
    if (phase === 'complete') {
        return (
            <div className="max-w-lg mx-auto space-y-6 text-center py-12">
                <CheckCircle2 className="mx-auto text-emerald-500" size={48} />
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">Import Complete</h2>
                    <p className="text-sm text-gray-500">
                        Aggregated {completedStats?.records.toLocaleString()} records across {completedStats?.days} day{completedStats?.days !== 1 ? 's' : ''}.
                    </p>
                </div>
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

    // ─── ERROR ──────────────────────────────────────────────────
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
                        setSelectedFile(null);
                        setPreview(null);
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
