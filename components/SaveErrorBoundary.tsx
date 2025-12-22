import React, { Component, ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
    children: ReactNode;
    onRetry?: () => void;
    fallbackMessage?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error boundary for save-related operations.
 * Catches errors in child components and provides a retry option.
 */
export class SaveErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('SaveErrorBoundary caught an error:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
        this.props.onRetry?.();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-xl border border-red-200">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                        <AlertTriangle size={32} className="text-red-500" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">Something went wrong</h3>
                    <p className="text-sm text-gray-600 mb-4 text-center max-w-md">
                        {this.props.fallbackMessage || 'An error occurred while saving your work. Your changes may not have been saved.'}
                    </p>
                    {this.state.error && (
                        <p className="text-xs text-red-500 mb-4 font-mono bg-red-100 px-3 py-1 rounded">
                            {this.state.error.message}
                        </p>
                    )}
                    <button
                        onClick={this.handleRetry}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 transition-colors"
                    >
                        <RefreshCw size={16} />
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default SaveErrorBoundary;
