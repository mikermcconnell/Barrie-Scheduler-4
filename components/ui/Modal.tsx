/**
 * Modal Base Component
 *
 * Provides consistent modal structure with customizable overlay, sizing, and animations.
 * Use this as a wrapper for modal content to reduce boilerplate across the app.
 *
 * Usage:
 * <Modal isOpen={showModal} onClose={() => setShowModal(false)} size="md">
 *   <Modal.Header>Title</Modal.Header>
 *   <Modal.Body>Content here</Modal.Body>
 *   <Modal.Footer>
 *     <button onClick={onClose}>Cancel</button>
 *     <button onClick={onConfirm}>Confirm</button>
 *   </Modal.Footer>
 * </Modal>
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

// --- Types ---

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
type ZIndexLevel = 'default' | 'high' | 'highest';

interface ModalProps {
    /** Whether the modal is visible */
    isOpen: boolean;
    /** Called when modal should close (backdrop click, ESC key, X button) */
    onClose: () => void;
    /** Modal width: sm (384px), md (512px), lg (640px), xl (768px), full (95vw) */
    size?: ModalSize;
    /** Z-index level: default (50), high (200), highest (10000) */
    zIndex?: ZIndexLevel;
    /** Whether clicking backdrop closes modal */
    closeOnBackdropClick?: boolean;
    /** Whether ESC key closes modal */
    closeOnEscape?: boolean;
    /** Whether to show backdrop blur effect */
    blur?: boolean;
    /** Whether to animate entrance */
    animate?: boolean;
    /** Additional class name for the modal container */
    className?: string;
    /** Modal content */
    children: React.ReactNode;
}

interface ModalHeaderProps {
    /** Header content (title) */
    children: React.ReactNode;
    /** Show close button */
    showClose?: boolean;
    /** Close handler (from parent Modal context) */
    onClose?: () => void;
    /** Additional class name */
    className?: string;
}

interface ModalBodyProps {
    children: React.ReactNode;
    className?: string;
}

interface ModalFooterProps {
    children: React.ReactNode;
    className?: string;
}

// --- Size & Z-Index Mapping ---

const sizeClasses: Record<ModalSize, string> = {
    sm: 'max-w-sm',      // 384px
    md: 'max-w-md',      // 512px
    lg: 'max-w-lg',      // 640px
    xl: 'max-w-xl',      // 768px
    full: 'max-w-[95vw]' // 95% viewport width
};

const zIndexClasses: Record<ZIndexLevel, string> = {
    default: 'z-50',
    high: 'z-[200]',
    highest: 'z-[10000]'
};

// --- Context for passing onClose to children ---

const ModalContext = React.createContext<{ onClose: () => void } | null>(null);

// --- Sub-components ---

const ModalHeader: React.FC<ModalHeaderProps> = ({
    children,
    showClose = true,
    onClose,
    className = ''
}) => {
    const context = React.useContext(ModalContext);
    const handleClose = onClose || context?.onClose;

    return (
        <div className={`flex items-center justify-between px-6 py-4 border-b border-gray-100 ${className}`}>
            <h2 className="text-lg font-semibold text-gray-800">
                {children}
            </h2>
            {showClose && handleClose && (
                <button
                    onClick={handleClose}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
                    aria-label="Close modal"
                >
                    <X className="h-5 w-5" />
                </button>
            )}
        </div>
    );
};

const ModalBody: React.FC<ModalBodyProps> = ({ children, className = '' }) => (
    <div className={`px-6 py-4 overflow-y-auto ${className}`}>
        {children}
    </div>
);

const ModalFooter: React.FC<ModalFooterProps> = ({ children, className = '' }) => (
    <div className={`px-6 py-4 border-t border-gray-100 flex justify-end gap-3 ${className}`}>
        {children}
    </div>
);

// --- Main Modal Component ---

const Modal: React.FC<ModalProps> & {
    Header: typeof ModalHeader;
    Body: typeof ModalBody;
    Footer: typeof ModalFooter;
} = ({
    isOpen,
    onClose,
    size = 'md',
    zIndex = 'default',
    closeOnBackdropClick = true,
    closeOnEscape = true,
    blur = true,
    animate = true,
    className = '',
    children
}) => {
    const modalRef = useRef<HTMLDivElement>(null);

    // Handle ESC key
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (closeOnEscape && e.key === 'Escape') {
            onClose();
        }
    }, [closeOnEscape, onClose]);

    // Add/remove escape listener
    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            // Prevent body scroll when modal is open
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, handleKeyDown]);

    // Handle backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
            onClose();
        }
    };

    // Focus trap - focus modal when opened
    useEffect(() => {
        if (isOpen && modalRef.current) {
            modalRef.current.focus();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const overlayClasses = [
        'fixed inset-0 flex items-center justify-center p-4',
        zIndexClasses[zIndex],
        blur ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50',
        animate ? 'animate-in fade-in duration-200' : ''
    ].filter(Boolean).join(' ');

    const contentClasses = [
        'bg-white rounded-2xl shadow-2xl w-full',
        sizeClasses[size],
        'max-h-[90vh] flex flex-col',
        animate ? 'animate-in zoom-in-95 duration-200' : '',
        className
    ].filter(Boolean).join(' ');

    return (
        <ModalContext.Provider value={{ onClose }}>
            <div
                className={overlayClasses}
                onClick={handleBackdropClick}
                role="dialog"
                aria-modal="true"
            >
                <div
                    ref={modalRef}
                    className={contentClasses}
                    tabIndex={-1}
                >
                    {children}
                </div>
            </div>
        </ModalContext.Provider>
    );
};

// Attach sub-components
Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;

export { Modal };
export type { ModalProps, ModalSize, ZIndexLevel };
