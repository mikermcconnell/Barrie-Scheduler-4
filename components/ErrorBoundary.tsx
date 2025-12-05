import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallbackTitle?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing.
 */
export class ErrorBoundary extends Component<Props, State> {
    public state: State = { hasError: false, error: null, errorInfo: null };

    static getDerivedStateFromError(error: Error): Partial<State> {
        // Update state so the next render shows the fallback UI
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Log the error to console (could also send to error reporting service)
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReload = (): void => {
        window.location.reload();
    };

    handleReset = (): void => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="min-h-[400px] flex items-center justify-center p-8">
                    <div className="bg-white rounded-2xl border-2 border-red-100 p-8 max-w-lg text-center shadow-lg">
                        <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertTriangle className="text-red-500" size={32} />
                        </div>
                        <h2 className="text-xl font-extrabold text-gray-800 mb-2">
                            {this.props.fallbackTitle || 'Something went wrong'}
                        </h2>
                        <p className="text-gray-500 font-medium mb-4">
                            An unexpected error occurred. Please try again.
                        </p>

                        {this.state.error && (
                            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-left">
                                <p className="text-xs font-mono text-red-600 break-all">
                                    {this.state.error.message}
                                </p>
                            </div>
                        )}

                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={this.handleReset}
                                className="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                            >
                                Try Again
                            </button>
                            <button
                                onClick={this.handleReload}
                                className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white font-bold rounded-xl hover:bg-blue-600 transition-colors"
                            >
                                <RefreshCw size={16} />
                                Reload Page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
