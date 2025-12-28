import React, { useState } from 'react';
import { History, ChevronDown, ChevronRight, Clock, Edit3, Trash2, Plus, RotateCcw, X } from 'lucide-react';

export interface AuditEntry {
    id: string;
    timestamp: Date;
    action: 'edit' | 'delete' | 'add' | 'bulk_adjust';
    description: string;
    details: {
        tripId?: string;
        blockId?: string;
        field?: string;
        oldValue?: string | number;
        newValue?: string | number;
        count?: number;
    };
    // Store state snapshot for potential revert (first N only)
    snapshotIndex?: number;
}

interface AuditLogPanelProps {
    entries: AuditEntry[];
    isOpen: boolean;
    onToggle: () => void;
    onRevertTo?: (entryIndex: number) => void;
    maxEntriesShown?: number;
}

const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
};

const getActionIcon = (action: AuditEntry['action']) => {
    switch (action) {
        case 'edit': return <Edit3 size={12} className="text-blue-500" />;
        case 'delete': return <Trash2 size={12} className="text-red-500" />;
        case 'add': return <Plus size={12} className="text-green-500" />;
        case 'bulk_adjust': return <RotateCcw size={12} className="text-purple-500" />;
        default: return <Clock size={12} className="text-gray-400" />;
    }
};

const getActionColor = (action: AuditEntry['action']) => {
    switch (action) {
        case 'edit': return 'bg-blue-50 border-blue-200';
        case 'delete': return 'bg-red-50 border-red-200';
        case 'add': return 'bg-green-50 border-green-200';
        case 'bulk_adjust': return 'bg-purple-50 border-purple-200';
        default: return 'bg-gray-50 border-gray-200';
    }
};

export const AuditLogPanel: React.FC<AuditLogPanelProps> = ({
    entries,
    isOpen,
    onToggle,
    onRevertTo,
    maxEntriesShown = 50
}) => {
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

    const displayEntries = entries.slice(-maxEntriesShown).reverse(); // Show most recent first

    if (!isOpen) {
        return (
            <button
                onClick={onToggle}
                className="fixed bottom-4 right-4 flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-lg hover:shadow-xl transition-all text-sm font-medium text-gray-700 z-40"
            >
                <History size={16} className="text-blue-500" />
                Activity Log
                {entries.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full">
                        {entries.length}
                    </span>
                )}
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 w-96 max-h-[60vh] bg-white border border-gray-200 rounded-xl shadow-2xl z-40 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-center gap-2">
                    <History size={18} className="text-blue-600" />
                    <span className="font-bold text-gray-800">Activity Log</span>
                    <span className="text-xs text-gray-500">({entries.length} actions)</span>
                </div>
                <button
                    onClick={onToggle}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                >
                    <X size={16} className="text-gray-500" />
                </button>
            </div>

            {/* Entries */}
            <div className="flex-1 overflow-y-auto">
                {displayEntries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                        <History size={32} className="mb-2 opacity-30" />
                        <p className="text-sm font-medium">No activity yet</p>
                        <p className="text-xs">Changes will appear here</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {displayEntries.map((entry, idx) => {
                            const isExpanded = expandedEntry === entry.id;
                            const entryIndex = entries.length - 1 - idx; // Actual index in original array

                            return (
                                <div
                                    key={entry.id}
                                    className={`p-3 hover:bg-gray-50 transition-colors ${getActionColor(entry.action)} border-l-2`}
                                >
                                    <div
                                        className="flex items-start gap-2 cursor-pointer"
                                        onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                                    >
                                        <div className="flex-shrink-0 mt-0.5">
                                            {getActionIcon(entry.action)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-gray-700 truncate">
                                                    {entry.description}
                                                </span>
                                                {isExpanded ? (
                                                    <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
                                                ) : (
                                                    <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
                                                )}
                                            </div>
                                            <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                                                <Clock size={10} />
                                                {formatTime(entry.timestamp)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div className="mt-2 ml-5 p-2 bg-white rounded border border-gray-100 text-xs">
                                            {entry.details.blockId && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Block:</span>
                                                    <span className="font-mono font-bold">{entry.details.blockId}</span>
                                                </div>
                                            )}
                                            {entry.details.field && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Field:</span>
                                                    <span className="font-medium">{entry.details.field}</span>
                                                </div>
                                            )}
                                            {entry.details.oldValue !== undefined && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Old:</span>
                                                    <span className="font-mono text-red-600 line-through">{entry.details.oldValue}</span>
                                                </div>
                                            )}
                                            {entry.details.newValue !== undefined && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">New:</span>
                                                    <span className="font-mono text-green-600 font-bold">{entry.details.newValue}</span>
                                                </div>
                                            )}
                                            {entry.details.count !== undefined && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Count:</span>
                                                    <span className="font-bold">{entry.details.count} trips</span>
                                                </div>
                                            )}

                                            {/* Revert Button (if snapshot available) */}
                                            {onRevertTo && entry.snapshotIndex !== undefined && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onRevertTo(entry.snapshotIndex!);
                                                    }}
                                                    className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition-colors font-medium"
                                                >
                                                    <RotateCcw size={10} />
                                                    Revert to this point
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            {entries.length > maxEntriesShown && (
                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 text-center">
                    Showing last {maxEntriesShown} of {entries.length} actions
                </div>
            )}
        </div>
    );
};

// Hook for managing audit log
export const useAuditLog = (maxSnapshots: number = 20) => {
    const [entries, setEntries] = useState<AuditEntry[]>([]);

    const logAction = (
        action: AuditEntry['action'],
        description: string,
        details: AuditEntry['details'],
        snapshotIndex?: number
    ) => {
        const entry: AuditEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            action,
            description,
            details,
            snapshotIndex
        };
        setEntries(prev => [...prev, entry]);
    };

    const clearLog = () => setEntries([]);

    return {
        entries,
        logAction,
        clearLog
    };
};
