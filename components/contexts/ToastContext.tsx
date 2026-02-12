/**
 * Toast Notification System
 *
 * Provides a global toast notification context for displaying
 * success, error, warning, and info messages.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

// Toast types
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
}

interface ToastContextType {
    toasts: Toast[];
    showToast: (type: ToastType, title: string, message?: string, duration?: number) => void;
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
    dismiss: (id: string) => void;
    dismissAll: () => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// Default durations by type (ms)
const DEFAULT_DURATIONS: Record<ToastType, number> = {
    success: 3000,
    error: 5000,
    warning: 4000,
    info: 3000
};

// Toast styling by type
const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: typeof CheckCircle2; iconColor: string }> = {
    success: {
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        icon: CheckCircle2,
        iconColor: 'text-emerald-500'
    },
    error: {
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: XCircle,
        iconColor: 'text-red-500'
    },
    warning: {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        icon: AlertTriangle,
        iconColor: 'text-amber-500'
    },
    info: {
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: Info,
        iconColor: 'text-blue-500'
    }
};

// Generate unique ID
const generateId = () => `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Toast Item Component
const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
    const style = TOAST_STYLES[toast.type];
    const Icon = style.icon;

    return (
        <div
            className={`${style.bg} ${style.border} border rounded-xl p-4 shadow-lg flex items-start gap-3 animate-in slide-in-from-right-5 duration-300 max-w-sm`}
            role="alert"
        >
            <Icon size={20} className={`${style.iconColor} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm">{toast.title}</p>
                {toast.message && (
                    <p className="text-gray-600 text-sm mt-0.5">{toast.message}</p>
                )}
            </div>
            <button
                onClick={() => onDismiss(toast.id)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors flex-shrink-0"
            >
                <X size={16} />
            </button>
        </div>
    );
};

// Toast Provider Component
export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const dismiss = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const dismissAll = useCallback(() => {
        setToasts([]);
    }, []);

    const showToast = useCallback((
        type: ToastType,
        title: string,
        message?: string,
        duration?: number
    ) => {
        const id = generateId();
        const toast: Toast = { id, type, title, message, duration };

        setToasts(prev => [...prev, toast]);

        // Auto-dismiss after duration
        const timeout = duration ?? DEFAULT_DURATIONS[type];
        if (timeout > 0) {
            setTimeout(() => dismiss(id), timeout);
        }
    }, [dismiss]);

    // Convenience methods
    const success = useCallback((title: string, message?: string) => {
        showToast('success', title, message);
    }, [showToast]);

    const error = useCallback((title: string, message?: string) => {
        showToast('error', title, message);
    }, [showToast]);

    const warning = useCallback((title: string, message?: string) => {
        showToast('warning', title, message);
    }, [showToast]);

    const info = useCallback((title: string, message?: string) => {
        showToast('info', title, message);
    }, [showToast]);

    const value: ToastContextType = {
        toasts,
        showToast,
        success,
        error,
        warning,
        info,
        dismiss,
        dismissAll
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
            {/* Toast Container */}
            {toasts.length > 0 && (
                <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2">
                    {toasts.map(toast => (
                        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
                    ))}
                </div>
            )}
        </ToastContext.Provider>
    );
};

// Hook to use toast
export const useToast = (): ToastContextType => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export default ToastProvider;
