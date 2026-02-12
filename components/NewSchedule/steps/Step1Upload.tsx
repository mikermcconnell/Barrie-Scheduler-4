
import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileUp, X, Calendar, Database, FileSpreadsheet, ArrowRight } from 'lucide-react';
import { GTFSImport } from '../../GTFSImport';
import type { GTFSImportResult } from '../../../utils/gtfs/gtfsTypes';

type ImportMode = 'csv' | 'gtfs';

interface Step1Props {
    files: File[];
    setFiles: (files: File[]) => void;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    setDayType: (type: 'Weekday' | 'Saturday' | 'Sunday') => void;
    userId?: string;
    onGTFSImport?: (result: GTFSImportResult) => void;
}

export const Step1Upload: React.FC<Step1Props> = ({
    files,
    setFiles,
    dayType,
    setDayType,
    userId,
    onGTFSImport
}) => {
    const [importMode, setImportMode] = useState<ImportMode>('csv');

    const onDrop = useCallback((acceptedFiles: File[]) => {
        // Limit to 2 files max (North/South or Single Loop)
        const newFiles = [...files, ...acceptedFiles].slice(0, 2);
        setFiles(newFiles);
    }, [files, setFiles]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
        maxFiles: 2
    });

    const removeFile = (index: number) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        setFiles(newFiles);
    };

    const handleGTFSImportComplete = (result: GTFSImportResult) => {
        if (onGTFSImport) {
            onGTFSImport(result);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">Let's Get Started</h2>
                <p className="text-gray-500">Choose how you want to create your schedule.</p>
            </div>

            {/* Import Mode Selector */}
            <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
                <button
                    onClick={() => setImportMode('csv')}
                    className={`flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 ${
                        importMode === 'csv'
                            ? 'border-brand-blue bg-blue-50 text-brand-blue shadow-md scale-[1.02]'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    <FileSpreadsheet className={`mb-3 ${importMode === 'csv' ? 'text-brand-blue' : 'text-gray-400'}`} size={32} />
                    <span className="font-bold text-lg">Create from Runtime CSV</span>
                    <span className="text-sm text-gray-500 mt-1">Build a new optimized schedule</span>
                </button>
                <button
                    onClick={() => setImportMode('gtfs')}
                    className={`flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 ${
                        importMode === 'gtfs'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-600 shadow-md scale-[1.02]'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    <Database className={`mb-3 ${importMode === 'gtfs' ? 'text-indigo-600' : 'text-gray-400'}`} size={32} />
                    <span className="font-bold text-lg">Import from GTFS</span>
                    <span className="text-sm text-gray-500 mt-1">Import existing Barrie Transit schedule</span>
                </button>
            </div>

            {/* CSV Upload Mode */}
            {importMode === 'csv' && (
                <>
                    {/* Day Type Selector */}
                    <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
                        {(['Weekday', 'Saturday', 'Sunday'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => setDayType(type)}
                                className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-200 ${dayType === type
                                        ? 'border-brand-blue bg-blue-50 text-brand-blue shadow-md scale-[1.02]'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                            >
                                <Calendar className={`mb-2 ${dayType === type ? 'text-brand-blue' : 'text-gray-400'}`} size={24} />
                                <span className="font-bold text-lg">{type}</span>
                            </button>
                        ))}
                    </div>

                    {/* File Upload */}
                    <div className="max-w-2xl mx-auto">
                        <div
                            {...getRootProps()}
                            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${isDragActive
                                    ? 'border-brand-blue bg-blue-50 scale-[1.01]'
                                    : 'border-gray-300 hover:border-brand-blue/50 hover:bg-gray-50'
                                }`}
                        >
                            <input {...getInputProps()} />
                            <div className="flex flex-col items-center space-y-4">
                                <div className="bg-gray-100 p-4 rounded-full">
                                    <Upload className="text-gray-500" size={32} />
                                </div>
                                <div>
                                    <p className="text-lg font-bold text-gray-700">Click to upload or drag and drop</p>
                                    <p className="text-sm text-gray-500">Upload your Observed Runtime CSVs (Max 2 files)</p>
                                </div>
                            </div>
                        </div>

                        {/* File List */}
                        {files.length > 0 && (
                            <div className="mt-6 space-y-3">
                                {files.map((file, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-emerald-50 p-2 rounded-lg"><FileUp size={20} className="text-emerald-600" /></div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-800">{file.name}</p>
                                                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeFile(idx)}
                                            className="p-1 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* GTFS Import Mode */}
            {importMode === 'gtfs' && userId && (
                <div className="max-w-2xl mx-auto">
                    <GTFSImport
                        userId={userId}
                        onImportComplete={handleGTFSImportComplete}
                        showHeader={false}
                        className="border-2 border-indigo-200"
                    />
                </div>
            )}

            {/* GTFS Import Mode - No User */}
            {importMode === 'gtfs' && !userId && (
                <div className="max-w-2xl mx-auto text-center p-8 bg-gray-50 rounded-xl border border-gray-200">
                    <Database className="mx-auto text-gray-300 mb-4" size={48} />
                    <p className="text-gray-600 font-medium">Sign in to import from GTFS</p>
                    <p className="text-gray-400 text-sm mt-1">
                        You need to be signed in to import schedules from the GTFS feed
                    </p>
                </div>
            )}
        </div>
    );
};
