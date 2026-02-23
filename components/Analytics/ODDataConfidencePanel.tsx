import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { ODConfidenceReport, ODConfidenceStatus } from '../../utils/od-matrix/odDataConfidence';

interface ActiveDatasetMeta {
    importId?: string;
    fileName?: string;
    importedAt?: string;
    importedBy?: string;
    dateRange?: string;
}

interface ODDataConfidencePanelProps {
    report: ODConfidenceReport;
    title: string;
    subtitle: string;
    metadata?: ActiveDatasetMeta;
}

function statusClasses(status: ODConfidenceStatus): string {
    if (status === 'pass') return 'bg-emerald-100 text-emerald-700';
    if (status === 'warn') return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
}

function levelClasses(level: ODConfidenceReport['level']): string {
    if (level === 'high') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (level === 'medium') return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-red-700 bg-red-50 border-red-200';
}

function formatImportedAt(importedAt?: string): string {
    if (!importedAt) return 'n/a';
    const parsed = new Date(importedAt);
    if (Number.isNaN(parsed.getTime())) return importedAt;
    return parsed.toLocaleString();
}

export const ODDataConfidencePanel: React.FC<ODDataConfidencePanelProps> = ({
    report,
    title,
    subtitle,
    metadata,
}) => {
    const levelLabel = report.level === 'high' ? 'High Confidence' : report.level === 'medium' ? 'Medium Confidence' : 'Low Confidence';

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                        <ShieldCheck size={16} className="text-violet-600" />
                        {title}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
                </div>
                <div className={`px-3 py-2 rounded-lg border text-right ${levelClasses(report.level)}`}>
                    <p className="text-lg font-bold leading-none">{report.score}/100</p>
                    <p className="text-[11px] font-semibold mt-1">{levelLabel}</p>
                </div>
            </div>

            {metadata && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4 text-xs">
                    <div className="p-2 bg-gray-50 rounded border border-gray-200">
                        <span className="text-gray-500">File:</span>{' '}
                        <span className="font-medium text-gray-800">{metadata.fileName || 'n/a'}</span>
                    </div>
                    <div className="p-2 bg-gray-50 rounded border border-gray-200">
                        <span className="text-gray-500">Imported:</span>{' '}
                        <span className="font-medium text-gray-800">{formatImportedAt(metadata.importedAt)}</span>
                    </div>
                    <div className="p-2 bg-gray-50 rounded border border-gray-200">
                        <span className="text-gray-500">Imported By:</span>{' '}
                        <span className="font-medium text-gray-800">{metadata.importedBy || 'n/a'}</span>
                    </div>
                    <div className="p-2 bg-gray-50 rounded border border-gray-200">
                        <span className="text-gray-500">Import ID:</span>{' '}
                        <span className="font-mono text-[11px] text-gray-800">{metadata.importId || 'legacy'}</span>
                    </div>
                    {metadata.dateRange && (
                        <div className="p-2 bg-gray-50 rounded border border-gray-200 md:col-span-2">
                            <span className="text-gray-500">Date Range:</span>{' '}
                            <span className="font-medium text-gray-800">{metadata.dateRange}</span>
                        </div>
                    )}
                </div>
            )}

            <div className="flex items-center gap-4 text-xs mb-3">
                <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} /> {report.passCount} pass</span>
                <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13} /> {report.warnCount} warn</span>
                <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle size={13} /> {report.failCount} fail</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-200">
                            <th className="py-2 pr-2 font-semibold">Check</th>
                            <th className="py-2 pr-2 font-semibold">Uploaded</th>
                            <th className="py-2 pr-2 font-semibold">Displayed</th>
                            <th className="py-2 pr-2 font-semibold">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {report.rows.map(row => (
                            <tr key={row.id} className="border-b border-gray-100 align-top">
                                <td className="py-2 pr-2">
                                    <p className="font-medium text-gray-800">{row.label}</p>
                                    {row.details && <p className="text-[11px] text-gray-500 mt-0.5">{row.details}</p>}
                                </td>
                                <td className="py-2 pr-2 text-gray-700">{row.uploaded}</td>
                                <td className="py-2 pr-2 text-gray-700">{row.displayed}</td>
                                <td className="py-2 pr-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${statusClasses(row.status)}`}>
                                        {row.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
