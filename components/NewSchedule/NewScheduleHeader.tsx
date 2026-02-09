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
    GitCompare,
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
    onSaveVersion?: (label?: string) => void;
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

    // Compare to Master (toggle)
    isMasterCompareActive?: boolean;
    onToggleMasterCompare?: () => void;
    isCompareLoading?: boolean;
    compareAvailable?: boolean;
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
    dayType,
    isMasterCompareActive,
    onToggleMasterCompare,
    isCompareLoading,
    compareAvailable
}) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(projectName);
    const [showExitModal, setShowExitModal] = useState(false);

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

    const handleSaveAndExit = () => {
        if (onSaveVersion) {
            onSaveVersion('Save before exit');
        }
        setShowExitModal(false);
        onClose();
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
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-[60]">
                {/* Left Section: Back + Project Menu */}
                <div className="flex items-center gap-4 w-1/4">
                    {/* Back Button */}
                    <button
                        onClick={handleExitClick}
                        className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                        title="Back to Dashboard"
                    >
                        <ArrowLeft size={20} />
                    </button>

                    {/* Project File Menu */}
                    <div className="flex items-center gap-2">
                        {/* Project Name (Editable) */}
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-gray-400 leading-none tracking-wider">Project</span>
                            {isRenaming ? (
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={handleRename}
                                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                                    className="text-sm font-bold text-gray-800 bg-transparent border-b border-blue-500 outline-none px-0 py-0 min-w-[150px]"
                                />
                            ) : (
                                <button
                                    onClick={() => setIsRenaming(true)}
                                    className="text-sm font-bold text-gray-800 hover:text-blue-600 truncate max-w-[200px] text-left leading-tight flex items-center gap-1"
                                    title="Rename Project"
                                >
                                    {projectName}
                                    {isDirty && (
                                        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="Unsaved changes" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Middle Section: Interactive Stepper */}
                <div className="flex items-center justify-center gap-2 flex-grow">
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
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${isCurrent
                                        ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm'
                                        : isCompleted
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                            : 'bg-white border-transparent text-gray-400 cursor-not-allowed'
                                        }`}
                                >
                                    {isCompleted ? (
                                        <CheckCircle2 size={16} className="text-emerald-500" />
                                    ) : (
                                        <span className={`flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
                                            }`}>
                                            {s.num}
                                        </span>
                                    )}
                                    <span className="text-sm font-bold">{s.label}</span>
                                </button>

                                {!isLast && (
                                    <div className={`w-8 h-0.5 ${isCompleted ? 'bg-emerald-200' : 'bg-gray-100'
                                        }`} />
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Right Section: Project Actions + Save Status + Exit */}
                <div className="flex items-center gap-3 w-1/4 justify-end">
                    {/* Compare to Master Toggle */}
                    {compareAvailable && onToggleMasterCompare && (
                        <button
                            onClick={onToggleMasterCompare}
                            disabled={isCompareLoading}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 ${
                                isMasterCompareActive
                                    ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                    : 'text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50'
                            }`}
                            title={isMasterCompareActive ? 'Turn off Master comparison' : 'Compare to Master Schedule'}
                        >
                            {isCompareLoading ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <GitCompare size={14} />
                            )}
                            {isMasterCompareActive ? 'Master Diff ON' : 'Compare to Master'}
                        </button>
                    )}

                    {/* New Project Button */}
                    {onNewProject && (
                        <button
                            onClick={onNewProject}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Start a new project"
                        >
                            <Plus size={14} />
                            New
                        </button>
                    )}

                    {/* Open Projects Button */}
                    {onOpenProjects && (
                        <button
                            onClick={onOpenProjects}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Open saved projects"
                        >
                            <FolderOpen size={14} />
                            Open
                        </button>
                    )}

                    <div className="h-6 w-px bg-gray-200" />

                    {/* Unified Save Status */}
                    <div className="flex items-center px-2">
                        {renderSaveStatus()}
                    </div>

                    {/* Exit Button */}
                    <button
                        onClick={handleExitClick}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        <Save size={14} />
                        Exit
                    </button>
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
                                    className="w-full px-4 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors"
                                >
                                    Save & Exit
                                </button>
                                <button
                                    onClick={handleExitWithoutSaving}
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors"
                                >
                                    Exit Without Saving
                                </button>
                                <button
                                    onClick={() => setShowExitModal(false)}
                                    className="w-full px-4 py-2.5 rounded-lg text-gray-500 font-medium text-sm hover:text-gray-700 transition-colors"
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
