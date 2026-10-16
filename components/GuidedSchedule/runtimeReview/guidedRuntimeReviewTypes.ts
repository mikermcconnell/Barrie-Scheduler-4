import type { TripBucketAnalysis, TimeBand } from '../../../utils/ai/runtimeAnalysis';
import type { RuntimeData, SegmentRawData } from '../../NewSchedule/utils/csvParser';

export type GuidedDayType = 'Weekday' | 'Saturday' | 'Sunday';
export type CycleStartDirection = 'North' | 'South';

export interface GuidedDateRange {
    start: string;
    end: string;
}

/** Runtime analysis built from prepared results; the Step 2 review reads from this. */
export interface RuntimeReviewModel {
    parsedData: RuntimeData[];
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    segmentsMap: Record<string, SegmentRawData[]>;
    matrixAnalysis: TripBucketAnalysis[];
    matrixSegmentsMap: Record<string, SegmentRawData[]>;
    troubleshootingPatternWarning: string | null;
    initialCycleStartDirection: CycleStartDirection;
    /** Route number inferred from the runtime rows, used only to warn when it differs from the selected route. */
    detectedRouteNumber: string | null;
}
