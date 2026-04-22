import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { ArrowLeft, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { parseFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanParser';
import { saveFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanService';
import type { FleetPlanWorkbook } from '../../utils/fleet-plan/types';

interface FleetPlanImportProps {
    teamId: string;
    userId: string;
    onImportComplete: (workbook: FleetPlanWorkbook) => void;
    onCancel: () => void;
}

function describeWorkbook(workbook: FleetPlanWorkbook): string {
    const totalRows = workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    return `${workbook.sheets.length} sheets · ${totalRows} editable rows`;
}

export const FleetPlanImport: React.FC<FleetPlanImportProps> = ({
    teamId,
    userId,
    onImportComplete,
    onCancel,
}) => {
    const { canManageTeam } = useTeam();
    const [errorMessage, setErrorMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [parsedWorkbook, setParsedWorkbook] = useState<FleetPlanWorkbook | null>(null);

    const handleFile = useCallback(async (file: File) => {
        setErrorMessage('');
        setParsedWorkbook(null);

        if (!file.name.match(/\.xlsx?$/i)) {
            setErrorMessage('Please upload an Excel file (.xlsx or .xls).');
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            const { workbook, warnings } = parseFleetPlanWorkbook(buffer, {
                fileName: file.name,
                userId,
            });

            setParsedWorkbook(workbook);
            if (warnings.length > 0) {
                setErrorMessage(warnings.join(' '));
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to parse Fleet Plan workbook.');
        }
    }, [userId]);

    const handleDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (file) {
            void handleFile(file);
        }
    }, [handleFile]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
        },
        multiple: false,
        disabled: !canManageTeam || saving,
    });

    const handleImport = async () => {
        if (!parsedWorkbook) return;
        if (!canManageTeam) {
            setErrorMessage('Only team owners and admins can import or replace the shared Fleet Plan.');
            return;
        }
        setSaving(true);
        try {
            await saveFleetPlanWorkbook(teamId, parsedWorkbook);
            onImportComplete(parsedWorkbook);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to save Fleet Plan.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <button
                    onClick={onCancel}
                    className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700"
                >
                    <ArrowLeft size={16} />
                    Back
                </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Fleet Plan Import</h2>
                <p className="text-sm text-gray-500 mb-6">
                    Upload the supported Fleet Plan workbook to create the shared team dataset. The app will digitize all 3 sheets and preserve the workbook format on export.
                </p>

                {!canManageTeam ? (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        You can view shared Fleet Plan data as a team member, but only team owners and admins can import or replace the workbook.
                    </div>
                ) : null}

                <div
                    {...getRootProps()}
                    className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
                        !canManageTeam
                            ? 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-70'
                            : isDragActive
                                ? 'border-brand-blue bg-blue-50'
                                : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                    }`}
                >
                    <input {...getInputProps()} />
                    <div className="flex flex-col items-center gap-3">
                        <div className="rounded-full bg-white p-3 border border-gray-200 shadow-sm">
                            <Upload size={22} className="text-brand-blue" />
                        </div>
                        <div className="text-base font-semibold text-gray-900">
                            {isDragActive ? 'Drop the workbook here' : 'Upload Fleet Plan workbook'}
                        </div>
                        <div className="text-sm text-gray-500">
                            Supports the current Fleet Plan Excel template (.xlsx / .xls)
                        </div>
                    </div>
                </div>

                {errorMessage ? (
                    <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                        parsedWorkbook ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'
                    }`}>
                        {errorMessage}
                    </div>
                ) : null}

                {parsedWorkbook ? (
                    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={18} />
                            <div className="space-y-2">
                                <div className="text-sm font-semibold text-emerald-900">
                                    Workbook ready to import
                                </div>
                                <div className="text-sm text-emerald-800">
                                    {parsedWorkbook.metadata.sourceFileName} · {describeWorkbook(parsedWorkbook)}
                                </div>
                                <div className="text-xs text-emerald-700">
                                    Supported sheets: {parsedWorkbook.sheets.map((sheet) => sheet.name).join(', ')}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => void handleImport()}
                        disabled={!parsedWorkbook || saving || !canManageTeam}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        Import Fleet Plan
                    </button>
                </div>
            </div>
        </div>
    );
};
