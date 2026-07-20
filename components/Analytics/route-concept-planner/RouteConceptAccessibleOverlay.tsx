import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

interface RouteConceptAccessibleOverlayProps {
    labelledBy: string;
    onClose: () => void;
    children: ReactNode;
    className: string;
    backdropClassName?: string;
}

/** Shared modal focus contract for Route Concept Planner dialogs and drawers. */
export function RouteConceptAccessibleOverlay({
    labelledBy,
    onClose,
    children,
    className,
    backdropClassName = 'items-center justify-center bg-slate-950/40 p-4',
}: RouteConceptAccessibleOverlayProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = dialogRef.current;
        const initial = dialog?.querySelector<HTMLElement>('[data-autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]');
        initial?.focus();
        return () => openerRef.current?.focus();
    }, []);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (focusable.length === 0) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
        }
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return (
        <div className={`absolute inset-0 z-50 flex ${backdropClassName}`}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                className={className}
            >
                {children}
            </div>
        </div>
    );
}
