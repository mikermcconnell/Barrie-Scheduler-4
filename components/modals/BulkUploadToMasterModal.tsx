/**
 * Bulk Upload to Master Modal
 *
 * Allows users to select multiple routes and upload them to Master Schedule in bulk.
 */

import React, { useState, useMemo } from 'react';
import { Upload, X, Loader2, Check, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { DayType } from '../../utils/masterScheduleTypes';

export interface RouteForUpload {
    routeNumber: string;
    dayType: DayType;
    displayName: string;
    tripCount: number;
    northStopCount: number;
    southStopCount: number;
}

interface UploadResult {
    routeNumber: string;
    dayType: DayType;
    success: boolean;
    error?: string;
    newVersion?: number;
}

interface BulkUploadToMasterModalProps {
    isOpen: boolean;
    routes: RouteForUpload[];
    onConfirm: (selectedRoutes: RouteForUpload[]) => Promise<UploadResult[]>;
    onCancel: () => void;
}

export const BulkUploadToMasterModal: React.FC<BulkUploadToMasterModalProps> = ({
    isOpen,
    routes,
    onConfirm,
    onCancel
}) => {
    const [selectedRoutes, setSelectedRoutes] = useState<Set<string>>(new Set());
    const [isUploading, setIsUploading] = useState(false);
    const [results, setResults] = useState<UploadResult[] | null>(null);

    // Group routes by route number for display
    const groupedRoutes = useMemo(() => {
        const groups: Record<string, RouteForUpload[]> = {};
        routes.forEach(route => {
            if (!groups[route.routeNumber]) {
                groups[route.routeNumber] = [];
            }
            groups[route.routeNumber].push(route);
        });
        return groups;
    }, [routes]);

    const getRouteKey = (route: RouteForUpload) => `${route.routeNumber}-${route.dayType}`;

    const toggleRoute = (route: RouteForUpload) => {
        const key = getRouteKey(route);
        const newSelected = new Set(selectedRoutes);
        if (newSelected.has(key)) {
            newSelected.delete(key);
        } else {
            newSelected.add(key);
        }
        setSelectedRoutes(newSelected);
    };

    const selectAll = () => {
        const allKeys = routes.map(r => getRouteKey(r));
        setSelectedRoutes(new Set(allKeys));
    };

    const selectNone = () => {
        setSelectedRoutes(new Set());
    };

    const handleUpload = async () => {
        const routesToUpload = routes.filter(r => selectedRoutes.has(getRouteKey(r)));
        if (routesToUpload.length === 0) return;

        setIsUploading(true);
        try {
            const uploadResults = await onConfirm(routesToUpload);
            setResults(uploadResults);
        } catch (error) {
            console.error('Bulk upload failed:', error);
        } finally {
            setIsUploading(false);
        }
    };

    const handleClose = () => {
        setSelectedRoutes(new Set());
        setResults(null);
        onCancel();
    };

    if (!isOpen) return null;

    const successCount = results?.filter(r => r.success).length || 0;
    const failCount = results?.filter(r => !r.success).length || 0;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4">
            <div className="bg-white rounded-xl max-w-lg w-full shadow-2xl max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <Upload className="text-blue-600" size={20} />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900">
                            {results ? 'Upload Complete' : 'Upload Routes to Master'}
                        </h2>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isUploading}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {results ? (
                        /* Results View */
                        <div className="space-y-4">
                            {/* Summary */}
                            <div className={`rounded-lg p-4 ${failCount === 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                                <div className="flex items-center gap-2">
                                    {failCount === 0 ? (
                                        <CheckCircle2 className="text-green-600" size={20} />
                                    ) : (
                                        <AlertTriangle className="text-yellow-600" size={20} />
                                    )}
                                    <span className="font-semibold text-gray-900">
                                        {successCount} of {results.length} routes uploaded successfully
                                    </span>
                                </div>
                            </div>

                            {/* Individual Results */}
                            <div className="space-y-2">
                                {results.map((result, idx) => (
                                    <div
                                        key={idx}
                                        className={`flex items-center justify-between p-3 rounded-lg ${result.success ? 'bg-green-50' : 'bg-red-50'}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {result.success ? (
                                                <CheckCircle2 className="text-green-600" size={16} />
                                            ) : (
                                                <XCircle className="text-red-600" size={16} />
                                            )}
                                            <span className="font-medium text-gray-900">
                                                Route {result.routeNumber} ({result.dayType})
                                            </span>
                                        </div>
                                        <span className={`text-sm ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                                            {result.success ? `v${result.newVersion}` : result.error || 'Failed'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        /* Selection View */
                        <div className="space-y-4">
                            {/* Quick Actions */}
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">
                                    {selectedRoutes.size} of {routes.length} selected
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={selectAll}
                                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                    >
                                        Select All
                                    </button>
                                    <span className="text-gray-300">|</span>
                                    <button
                                        onClick={selectNone}
                                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                    >
                                        Select None
                                    </button>
                                </div>
                            </div>

                            {/* Route List */}
                            <div className="space-y-3">
                                {Object.entries(groupedRoutes).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([routeNum, dayRoutes]) => (
                                    <div key={routeNum} className="border border-gray-200 rounded-lg overflow-hidden">
                                        <div className="bg-gray-50 px-4 py-2 font-semibold text-gray-900 border-b border-gray-200">
                                            Route {routeNum}
                                        </div>
                                        <div className="divide-y divide-gray-100">
                                            {dayRoutes.map(route => {
                                                const key = getRouteKey(route);
                                                const isSelected = selectedRoutes.has(key);
                                                return (
                                                    <label
                                                        key={key}
                                                        className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => toggleRoute(route)}
                                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                                            />
                                                            <span className="font-medium text-gray-900">{route.dayType}</span>
                                                        </div>
                                                        <span className="text-sm text-gray-500">
                                                            {route.tripCount} trips
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Warning */}
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                <div className="flex items-start gap-2">
                                    <AlertTriangle className="text-yellow-600 mt-0.5 flex-shrink-0" size={16} />
                                    <p className="text-sm text-gray-700">
                                        Uploading will create new versions of these routes in the Master Schedule.
                                        Existing versions will be preserved in version history.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                    {results ? (
                        <button
                            onClick={handleClose}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                        >
                            Done
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleClose}
                                disabled={isUploading}
                                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpload}
                                disabled={isUploading || selectedRoutes.size === 0}
                                className="flex-1 px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="animate-spin" size={16} />
                                        Uploading {selectedRoutes.size} routes...
                                    </>
                                ) : (
                                    <>
                                        <Upload size={16} />
                                        Upload {selectedRoutes.size} Route{selectedRoutes.size !== 1 ? 's' : ''}
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
