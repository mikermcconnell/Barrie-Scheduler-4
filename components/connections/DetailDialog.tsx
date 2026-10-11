import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Modal shell for connection details: focus trap, Escape and backdrop close. */
export function DetailDialog({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: React.ReactNode }) {
    const closeButton = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const priorFocus = document.activeElement as HTMLElement | null;
        closeButton.current?.focus();
        const keydown = (key: KeyboardEvent) => {
            if (key.key === 'Escape') { key.preventDefault(); onClose(); }
            if (key.key !== 'Tab') return;
            const targets = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]') ?? []);
            const first = targets[0], last = targets[targets.length - 1];
            if (key.shiftKey && document.activeElement === first) { key.preventDefault(); last?.focus(); }
            else if (!key.shiftKey && document.activeElement === last) { key.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => { document.removeEventListener('keydown', keydown); priorFocus?.focus(); };
    }, [onClose]);

    return createPortal(<div className="regional-go-modal" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="regional-go-detail">
            <button ref={closeButton} type="button" onClick={onClose} className="regional-go-button regional-go-close" aria-label="Close connection detail"><X size={16} /> Close</button>
            {children}
        </div>
    </div>, document.body);
}
