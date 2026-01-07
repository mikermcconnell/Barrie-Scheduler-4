import React, { useState, useRef, useEffect } from 'react';
import {
    FileText,
    ChevronDown,
    FolderOpen,
    Plus,
    Edit3,
    History,
    Download,
    XCircle,
    Loader2,
    Cloud,
    CloudOff,
    Check,
    ArrowLeft,
    CalendarPlus,
    CheckCircle2,
    Save
} from 'lucide-react';
import { AutoSaveStatus } from '../../hooks/useAutoSave';

interface NewScheduleHeaderProps {
    // Step info
    currentStep: number;
    totalSteps?: number;
    stepLabel: string; // Kept for backwards compatibility if needed, but we define labels internally now

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

    // Auto-save status
    autoSaveStatus?: AutoSaveStatus;
    lastSaved?: Date | null;

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
    autoSaveStatus,
    lastSaved,
    routeNumber,
    dayType
}) => {
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(projectName);
    const menuRef = useRef<HTMLDivElement>(null);

    // Sync rename value when projectName changes
    useEffect(() => {
        setRenameValue(projectName);
    }, [projectName]);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setFileMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleRename = () => {
        if (renameValue.trim() && onRenameProject) {
            onRenameProject(renameValue.trim());
        }
        setIsRenaming(false);
    };

    const steps = [
        { num: 1, label: 'Upload' },
        { num: 2, label: 'Analysis' },
        { num: 3, label: 'Build' },
        { num: 4, label: 'Schedule' }
    ];

    return (
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-[60]">
            {/* Left Section: Back + Project Menu */}
            <div className="flex items-center gap-4 w-1/4">
                {/* Back Button */}
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                    title="Back to Dashboard"
                >
                    <ArrowLeft size={20} />
                </button>

                {/* Project File Menu */}
                <div className="flex items-center gap-2">
                    {/* Project Name (Editable-ish) */}
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
                                className="text-sm font-bold text-gray-800 hover:text-blue-600 truncate max-w-[200px] text-left leading-tight"
                                title="Rename Project"
                            >
                                {projectName}
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

            {/* Right Section: Project Actions + Auto-save Status + Exit */}
            <div className="flex items-center gap-3 w-1/4 justify-end">
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

                {/* Auto-save Status (when available) */}
                {autoSaveStatus && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg">
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                            {autoSaveStatus === 'saving' && (
                                <div className="flex items-center gap-1.5">
                                    <Loader2 size={12} className="animate-spin text-blue-500" />
                                    <span className="text-blue-600">Saving...</span>
                                </div>
                            )}
                            {autoSaveStatus === 'saved' && (
                                <div className="flex items-center gap-1.5 group cursor-help relative">
                                    <Cloud size={12} className="text-emerald-500" />
                                    <span className="text-emerald-600">Saved</span>
                                    {lastSaved && (
                                        <div className="absolute top-full right-0 mt-1 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                            {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    )}
                                </div>
                            )}
                            {autoSaveStatus === 'error' && (
                                <div className="flex items-center gap-1.5">
                                    <CloudOff size={12} className="text-red-500" />
                                    <span className="text-red-600">Error</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Check if we can show a dedicated Save Action here or keep it in menu */}
                {onSaveVersion && (
                    <button
                        onClick={() => {
                            if (confirm('Save version and exit?')) {
                                onSaveVersion('Autosave before exit');
                                onClose();
                            }
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        <Save size={14} />
                        Exit
                    </button>
                )}
            </div>
        </div>
    );
};

export default NewScheduleHeader;
