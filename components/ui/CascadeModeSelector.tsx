/**
 * CascadeModeSelector Component
 *
 * Allows users to control how time edits cascade:
 * - 'always': Cascade within trip + to subsequent trips in block (current behavior)
 * - 'within-trip': Only cascade to subsequent stops in same trip
 * - 'none': Just edit the single cell, no cascade
 */

import React from 'react';
import { ChevronDown, Zap, ArrowRight, Target } from 'lucide-react';

export type CascadeMode = 'always' | 'within-trip' | 'none';

interface CascadeModeSelectorProps {
    mode: CascadeMode;
    onChange: (mode: CascadeMode) => void;
    disabled?: boolean;
}

const modeConfig: Record<CascadeMode, { label: string; description: string; icon: React.ReactNode }> = {
    always: {
        label: 'Full Cascade',
        description: 'Cascade to trip and block',
        icon: <Zap size={14} />
    },
    'within-trip': {
        label: 'Trip Only',
        description: 'Only cascade within trip',
        icon: <ArrowRight size={14} />
    },
    none: {
        label: 'Single Cell',
        description: 'Edit only this cell',
        icon: <Target size={14} />
    }
};

export const CascadeModeSelector: React.FC<CascadeModeSelectorProps> = ({
    mode,
    onChange,
    disabled = false
}) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const currentConfig = modeConfig[mode];

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    disabled
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                title={`Time Cascade Mode: ${currentConfig.description}`}
            >
                {currentConfig.icon}
                <span className="hidden sm:inline">{currentConfig.label}</span>
                <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    <div className="px-3 py-2 border-b border-gray-100">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Time Cascade Mode
                        </p>
                    </div>

                    {(Object.keys(modeConfig) as CascadeMode[]).map(modeKey => {
                        const config = modeConfig[modeKey];
                        const isActive = mode === modeKey;

                        return (
                            <button
                                key={modeKey}
                                onClick={() => {
                                    onChange(modeKey);
                                    setIsOpen(false);
                                }}
                                className={`w-full flex items-start gap-3 px-3 py-2 text-left transition-colors ${
                                    isActive
                                        ? 'bg-blue-50 text-blue-800'
                                        : 'hover:bg-gray-50 text-gray-700'
                                }`}
                            >
                                <span className={`mt-0.5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                                    {config.icon}
                                </span>
                                <div>
                                    <div className="font-medium text-sm">{config.label}</div>
                                    <div className="text-xs text-gray-500">{config.description}</div>
                                </div>
                                {isActive && (
                                    <span className="ml-auto text-blue-600">✓</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

/**
 * Compact version for toolbar integration
 */
export const CascadeModeBadge: React.FC<{
    mode: CascadeMode;
    onClick?: () => void;
}> = ({ mode, onClick }) => {
    const config = modeConfig[mode];

    return (
        <button
            onClick={onClick}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            title={`Cascade: ${config.description}`}
        >
            {config.icon}
            <span>{config.label}</span>
        </button>
    );
};
