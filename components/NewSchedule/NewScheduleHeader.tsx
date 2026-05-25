import React, { useState, useEffect } from 'react';
import {
    FolderOpen,
    Plus,
    Loader2,
    Cloud,
    CloudOff,
    ArrowLeft,
    CheckCircle2,
    Save,
    HardDrive,
    X
} from 'lucide-react';

type CloudSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface NewScheduleHeaderProps {
    // Step info
    currentStep: number;
    totalSteps?: number;
    stepLabel: string;

    // Draft/Project management
    projectName: string;
    onRenameProject?: (newName: string) => void;
    onOpenProjects?: () => void;
    onNewProject?: () => void;
    onSaveVersion?: (label?: string) => Promise<void> | void;
    onExport?: () => void;
    onClose: () => void;

    // Navigation
    onStepClick?: (step: number) => void;
    maxStepReached?: number;

    // Unified save status (replaces autoSaveStatus/lastSaved)
    cloudSaveStatus?: CloudSaveStatus;
    lastCloudSaveTime?: Date | null;
    isDirty?: boolean;
    isAuthenticated?: boolean;
    onRetrySave?: () => void;

    // Route summary
    routeNumber?: string;
    dayType?: string;

}

export const NewScheduleHeader: React.FC<NewScheduleHeaderProps> = ({
    currentStep,
    totalSteps = 4,
    stepLabel,
    projectName,
    onRenameProject,
    onOpenProjects,
    onNewProject,
    onSaveVersion,
    onExport,
    onClose,
    onStepClick,
    maxStepReached = 1,
    cloudSaveStatus,
    lastCloudSaveTime,
    isDirty,
    isAuthenticated,
    onRetrySave,
    routeNumber,
    dayType
}) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(projectName);
    const [showExitModal, setShowExitModal] = useState(false);
    const [isExitSaving, setIsExitSaving] = useState(false);

    // Sync rename value when projectName changes
    useEffect(() => {
        setRenameValue(projectName);
    }, [projectName]);

    const handleRename = () => {
        if (renameValue.trim() && onRenameProject) {
            onRenameProject(renameValue.trim());
        }
        setIsRenaming(false);
    };

    const handleExitClick = () => {
        // If no unsaved changes, exit directly
        if (!isDirty) {
            onClose();
            return;
        }
        setShowExitModal(true);
    };

    const handleSaveAndExit = async () => {
        if (!onSaveVersion) {
            setShowExitModal(false);
            onClose();
            return;
        }

        setIsExitSaving(true);
        try {
            await onSaveVersion('Save before exit');
            setShowExitModal(false);
            onClose();
        } finally {
            setIsExitSaving(false);
        }
    };

    const handleExitWithoutSaving = () => {
        setShowExitModal(false);
        onClose();
    };

    const steps = [
        { num: 1, label: 'Upload' },
        { num: 2, label: 'Analysis' },
        { num: 3, label: 'Build' },
        { num: 4, label: 'Schedule' }
    ];

    // Render the unified save status indicator
    const renderSaveStatus = () => {
        if (!isAuthenticated) {
            // Not authenticated - show local save info
            return (
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <HardDrive size={12} />
                    <span>Saved locally</span>
                </div>
            );
        }

        if (cloudSaveStatus === 'saving') {
            return (
                <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600">
                    <Loader2 size={12} className="animate-spin" />
                    <span>Saving...</span>
                </div>
            );
        }

        if (cloudSaveStatus === 'error') {
            return (
                <button
                    onClick={onRetrySave}
                    className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
                    title="Click to retry save"
                >
                    <CloudOff size={12} />
                    <span>Save failed</span>
                </button>
            );
        }

        if (isDirty) {
            return (
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>Unsaved changes</span>
                </div>
            );
        }

        if (cloudSaveStatus === 'saved') {
            return (
                <div className="flex items-center gap-1.5 group cursor-help relative text-xs font-medium text-emerald-600">
                    <Cloud size={12} />
                    <span>Saved</span>
                    {lastCloudSaveTime && (
                        <div className="absolute top-full right-0 mt-1 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                            {lastCloudSaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                </div>
            );
        }

        // idle state - no status to show
        return null;
    };

    return (
        <>
            <div className="sticky top-0 z-[60] border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-2 px-4 py-2.5 lg:px-6">
                    {/* Top row: project identity + project actions */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <button
                                onClick={handleExitClick}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                title="Back to Dashboard"
                            >
                                <ArrowLeft size={19} />
                            </button>

                            <div className="min-w-0">
                                <span className="text-[10px] font-bold uppercase leading-none tracking-wider text-gray-400">Project</span>
                                {isRenaming ? (
                                    <input
                                        autoFocus
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onBlur={handleRename}
                                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                                        className="mt-0.5 w-full min-w-[180px] max-w-sm border-0 border-b border-blue-500 bg-transparent px-0 py-0 text-sm font-bold text-gray-800 outline-none focus:ring-0"
                                    />
                                ) : (
                                    <button
                                        onClick={() => setIsRenaming(true)}
                                        className="mt-0.5 flex max-w-[min(420px,70vw)] items-center gap-1 text-left text-sm font-bold leading-tight text-gray-900 hover:text-blue-600"
                                        title="Rename Project"
                                    >
                                        <span className="truncate">{projectName}</span>
                                        {isDirty && (
                                            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />
                                        )}
                                    </button>
                                )}
                                {(routeNumber || dayType) && (
                                    <p className="mt-1 hidden truncate text-xs font-medium text-gray-500 md:block">
                                        {[routeNumber ? `Route ${routeNumber}` : null, dayType].filter(Boolean).join(' - ')}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            {onNewProject && (
                                <button
                                    onClick={onNewProject}
                                    className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                                    title="Start a new project"
                                >
                                    <Plus size={14} />
                                    New
                                </button>
                            )}

                            {onOpenProjects && (
                                <button
                                    onClick={onOpenProjects}
                                    className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                                    title="Open saved projects"
                                >
                                    <FolderOpen size={14} />
                                    Open
                                </button>
                            )}

                            <div className="hidden h-6 w-px bg-gray-200 sm:block" />

                            <div className="flex min-h-8 items-center rounded-lg bg-gray-50 px-2.5">
                                {renderSaveStatus()}
                            </div>

                            <button
                                onClick={handleExitClick}
                                className="flex h-8 items-center gap-2 rounded-lg bg-gray-100 px-2.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-200 hover:text-gray-900"
                            >
                                <Save size={14} />
                                Exit
                            </button>
                        </div>
                    </div>

                    {/* Stepper */}
                    <div className="overflow-x-auto pb-0.5">
                        <div className="flex min-w-max items-center justify-start gap-2 lg:min-w-0 lg:justify-center">
                            {steps.map((s, idx) => {
                                const isCompleted = s.num < currentStep;
                                const isCurrent = s.num === currentStep;
                                const isReachable = s.num <= maxStepReached;
                                const isLast = idx === steps.length - 1;

                                return (
                                    <React.Fragment key={s.num}>
                                        <button
                                            onClick={() => isReachable && onStepClick && onStepClick(s.num)}
                                            disabled={!isReachable}
                                            className={`flex items-center gap-2 rounded-full border px-2.5 py-1 transition-all ${isCurrent
                                                ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm'
                                                : isCompleted
                                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                    : 'cursor-not-allowed border-gray-100 bg-white text-gray-400'
                                                }`}
                                        >
                                            {isCompleted ? (
                                                <CheckCircle2 size={16} className="text-emerald-500" />
                                            ) : (
                                                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
                                                    }`}>
                                                    {s.num}
                                                </span>
                                            )}
                                            <span className="text-sm font-bold">{s.label}</span>
                                        </button>

                                        {!isLast && (
                                            <div className={`h-0.5 w-6 ${isCompleted ? 'bg-emerald-200' : 'bg-gray-100'
                                                }`} />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Exit Confirmation Modal */}
            {showExitModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={() => setShowExitModal(false)}
                    />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="text-base font-bold text-gray-900">Exit Project?</h3>
                            <button
                                onClick={() => setShowExitModal(false)}
                                className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="px-6 py-4">
                            {isDirty && (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                                    You have unsaved changes.
                                </p>
                            )}

                            {lastCloudSaveTime && (
                                <p className="text-xs text-gray-500 mb-4">
                                    Last cloud save: {lastCloudSaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            )}

                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleSaveAndExit}
                                    disabled={isExitSaving}
                                    className="w-full px-4 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                    {isExitSaving ? 'Saving...' : 'Save & Exit'}
                                </button>
                                <button
                                    onClick={handleExitWithoutSaving}
                                    disabled={isExitSaving}
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                    Exit Without Saving
                                </button>
                                <button
                                    onClick={() => setShowExitModal(false)}
                                    disabled={isExitSaving}
                                    className="w-full px-4 py-2.5 rounded-lg text-gray-500 font-medium text-sm hover:text-gray-700 transition-colors disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default NewScheduleHeader;
