import { createContext, useContext } from 'react';
import type { PerformanceAggregation } from '../../utils/performanceAggregation';

const AggregationContext = createContext<PerformanceAggregation>({
    mode: 'sum', divisor: 1, unit: 'day', coveredDays: 0, expectedDays: 0, label: 'Sum',
});

export const PerformanceAggregationProvider = AggregationContext.Provider;
export function usePerformanceAggregation(): PerformanceAggregation {
    return useContext(AggregationContext);
}
