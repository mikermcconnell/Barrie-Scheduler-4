import React, { createContext, useContext, useMemo } from 'react';
import type { PerformanceDataScope } from '../../utils/performanceDataScope';
import { getPerformanceScopeLabel } from '../../utils/performanceDataScope';

interface PerformanceScopeContextValue {
    scope: PerformanceDataScope;
    label: string;
}

const PerformanceScopeContext = createContext<PerformanceScopeContextValue | null>(null);

export const PerformanceScopeProvider: React.FC<{
    scope: PerformanceDataScope;
    label?: string;
    children: React.ReactNode;
}> = ({ scope, label, children }) => {
    const value = useMemo<PerformanceScopeContextValue>(() => ({
        scope,
        label: label ?? getPerformanceScopeLabel(scope),
    }), [scope, label]);

    return (
        <PerformanceScopeContext.Provider value={value}>
            {children}
        </PerformanceScopeContext.Provider>
    );
};

export function usePerformanceScope(): PerformanceScopeContextValue | null {
    return useContext(PerformanceScopeContext);
}
