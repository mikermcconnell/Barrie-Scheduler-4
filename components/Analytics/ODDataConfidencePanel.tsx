import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
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
    // Default collapsed when all checks pass (100/100), expanded otherwise
    const [expanded, setExpanded] = useState(report.score < 100);

    return (
        <div className="bg-white border border-gray-200 rounded-xl mb-6">
            {/* Always-visible header row — clickable to toggle */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-gray-50/50 transition-colors rounded-xl"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <ShieldCheck size={16} className="text-violet-600 shrink-0" />
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
                        {!expanded && metadata && (
                            <p className="text-xs text-gray-400 truncate mt-0.5">
                                {metadata.fileName}{metadata.dateRange ? ` · ${metadata.dateRange}` : ''}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs shrink-0">
                        <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={12} /> {report.passCount}</span>
                        {report.warnCount > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={12} /> {report.warnCount}</span>}
                        {report.failCount > 0 && <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle size={12} /> {report.failCount}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <div className={`px-3 py-1.5 rounded-lg border text-right ${levelClasses(report.level)}`}>
                        <p className="text-base font-bold leading-none">{report.score}/100</p>
                        <p className="text-[10px] font-semibold mt-0.5">{levelLabel}</p>
                    </div>
                    {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                </div>
            </button>

            {/* Collapsible details */}
            {expanded && (
                <div className="px-4 pb-4 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mt-3 mb-3">{subtitle}</p>

                    {metadata && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4 text-xs">
                            <div className="p-2 bg-gray-50 rounded border border-gray-200">
                                <span className="text-gray-500">File:</span>{' '}
                                <span className="font-medium text-gray-800">{metadata.fileName || 'n/a'}</span>
                            </div>
                            <div className="p-2 bg-gray-50 rounded border border-gray-200">
                                <span className="text-gray-500">Imported:</span>{' '}
                                <span className="font-medium text-gray-800">{formatImportedAt(metadata.importedAt)}</span>
                            </div>
                            {metadata.dateRange && (
                                <div className="p-2 bg-gray-50 rounded border border-gray-200">
                                    <span className="text-gray-500">Date Range:</span>{' '}
                                    <span className="font-medium text-gray-800">{metadata.dateRange}</span>
                                </div>
                            )}
                        </div>
                    )}

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
            )}
        </div>
    );
};
