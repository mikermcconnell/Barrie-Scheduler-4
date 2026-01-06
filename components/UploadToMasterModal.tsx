/**
 * Upload to Master Modal
 *
 * Confirmation dialog shown before uploading a schedule to the Master Schedule.
 * Shows what will be replaced and version information.
 */

import React from 'react';
import { AlertTriangle, Upload, X, Loader2, FileSpreadsheet } from 'lucide-react';
import type { UploadConfirmation } from '../utils/masterScheduleTypes';

interface UploadToMasterModalProps {
    isOpen: boolean;
    confirmation: UploadConfirmation | null;
    onConfirm: () => void;
    onCancel: () => void;
    isUploading: boolean;
}

export const UploadToMasterModal: React.FC<UploadToMasterModalProps> = ({
    isOpen,
    confirmation,
    onConfirm,
    onCancel,
    isUploading
}) => {
    if (!isOpen || !confirmation) return null;

    const isReplacing = confirmation.existingEntry !== null;
    const atMaxVersions = confirmation.existingVersionCount >= 5;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4">
            <div className="bg-white rounded-xl max-w-md w-full shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand-green/10 rounded-lg">
                            <Upload className="text-brand-green" size={20} />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900">
                            Upload to Master Schedule
                        </h2>
                    </div>
                    <button
                        onClick={onCancel}
                        disabled={isUploading}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* Route Info */}
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <FileSpreadsheet className="text-gray-600" size={16} />
                            <h3 className="font-semibold text-gray-900">Route Information</h3>
                        </div>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Route:</span>
                                <span className="font-semibold text-gray-900">
                                    {confirmation.routeNumber} ({confirmation.dayType})
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Trips:</span>
                                <span className="font-medium text-gray-900">{confirmation.tripCount}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Stops:</span>
                                <span className="font-medium text-gray-900">
                                    {confirmation.northStopCount}N + {confirmation.southStopCount}S
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Version Info */}
                    <div className={`rounded-lg p-4 ${isReplacing ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                        <div className="flex items-start gap-2">
                            {isReplacing && <AlertTriangle className="text-yellow-600 mt-0.5" size={16} />}
                            <div className="flex-1">
                                <h3 className="font-semibold text-gray-900 mb-1">
                                    {isReplacing ? 'Replacing Existing Schedule' : 'New Master Schedule'}
                                </h3>
                                <div className="text-sm space-y-1">
                                    {isReplacing ? (
                                        <>
                                            <p className="text-gray-700">
                                                Current version: <span className="font-semibold">v{confirmation.existingEntry!.currentVersion}</span>
                                            </p>
                                            <p className="text-gray-700">
                                                New version will be: <span className="font-semibold">v{confirmation.newVersionNumber}</span>
                                            </p>
                                            <p className="text-gray-700">
                                                Existing versions: <span className="font-semibold">{confirmation.existingVersionCount}</span>
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-gray-700">
                                            This will create version <span className="font-semibold">v1</span> of this route
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Max Versions Warning */}
                    {atMaxVersions && (
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="text-orange-600 mt-0.5" size={16} />
                                <div className="flex-1">
                                    <h3 className="font-semibold text-gray-900 mb-1">Version Limit</h3>
                                    <p className="text-sm text-gray-700">
                                        This upload will remove the oldest version (v{confirmation.newVersionNumber - 5}) to maintain the 5-version limit.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Last Upload Info (if replacing) */}
                    {isReplacing && confirmation.existingEntry && (
                        <div className="text-sm text-gray-600">
                            <p>
                                Last updated by <span className="font-medium">{confirmation.existingEntry.uploaderName}</span> on{' '}
                                {new Intl.DateTimeFormat('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit'
                                }).format(confirmation.existingEntry.updatedAt)}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                    <button
                        onClick={onCancel}
                        disabled={isUploading}
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isUploading}
                        className="flex-1 px-4 py-2 bg-brand-green text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isUploading ? (
                            <>
                                <Loader2 className="animate-spin" size={16} />
                                Uploading...
                            </>
                        ) : (
                            <>
                                <Upload size={16} />
                                {isReplacing ? 'Replace' : 'Upload'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
