import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Edit2, Eye, LifeBuoy } from 'lucide-react';

interface SupportMenuProps {
    hasEditSession: boolean;
    onInspectTeam: () => void;
    onInspectMember: () => void;
    onStartEdit: () => void;
    onEndEdit: () => void;
}

const itemClass = 'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50';

export const SupportMenu: React.FC<SupportMenuProps> = ({
    hasEditSession,
    onInspectTeam,
    onInspectMember,
    onStartEdit,
    onEndEdit,
}) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        const handlePointerDown = (event: MouseEvent): void => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [open]);

    const choose = (action: () => void) => () => {
        setOpen(false);
        action();
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                onClick={() => setOpen(value => !value)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex h-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100"
            >
                <LifeBuoy size={16} />
                Support
                <ChevronDown size={14} />
            </button>
            {open && (
                <div role="menu" className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                    <button role="menuitem" onClick={choose(onInspectTeam)} className={itemClass}>
                        <Eye size={16} className="mt-0.5 text-gray-500" />
                        <span>
                            Inspect as team
                            <span className="block text-xs font-normal text-gray-500">Read-only view of what this team sees</span>
                        </span>
                    </button>
                    <button role="menuitem" onClick={choose(onInspectMember)} className={itemClass}>
                        <Eye size={16} className="mt-0.5 text-gray-500" />
                        <span>
                            Inspect as member…
                            <span className="block text-xs font-normal text-gray-500">Pick someone from Members</span>
                        </span>
                    </button>
                    <div className="my-1 border-t border-gray-100" />
                    {hasEditSession ? (
                        <button role="menuitem" onClick={choose(onEndEdit)} className={`${itemClass} text-red-700`}>
                            <Edit2 size={16} className="mt-0.5" />
                            <span>
                                End edit session
                                <span className="block text-xs font-normal text-gray-500">Return to read-only</span>
                            </span>
                        </button>
                    ) : (
                        <button role="menuitem" onClick={choose(onStartEdit)} className={`${itemClass} text-red-700`}>
                            <Edit2 size={16} className="mt-0.5" />
                            <span>
                                Start edit session
                                <span className="block text-xs font-normal text-gray-500">Audited. Expires after 30 minutes.</span>
                            </span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
