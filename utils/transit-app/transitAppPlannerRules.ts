import type {
    TransitAppActionType,
    TransitAppConfidence,
    TransitAppDiagnosisCode,
    TransitAppEffortBand,
    TransitAppImpactBand,
    TransitAppTrend,
} from './transitAppTypes';

export interface PlannerRuleInput {
    confidence: TransitAppConfidence;
    totalViews: number;
    viewToTapRate: number | null;
    tapToSuggestionRate: number | null;
    suggestionToGoRate: number | null;
    compositeScore: number | null;
    trend: TransitAppTrend;
    belowMedian: boolean;
    weekdayScore: number | null;
    weekendScore: number | null;
    seasonalDropPoints: number | null;
}

export interface PlannerRuleResult {
    diagnosisCode: TransitAppDiagnosisCode;
    diagnosisLabel: string;
    recommendedAction: TransitAppActionType;
    recommendedActionLabel: string;
    effortBand: TransitAppEffortBand;
    impactBand: TransitAppImpactBand;
}

const DIAGNOSIS_LABELS: Record<TransitAppDiagnosisCode, string> = {
    healthy: 'Healthy performance',
    low_awareness: 'Low route awareness',
    low_interest_conversion: 'Low view-to-tap conversion',
    low_itinerary_followthrough: 'Low tap-to-suggestion follow-through',
    low_regional_integration: 'Weak GO integration conversion',
    weekday_weekend_mismatch: 'Weekday/weekend mismatch',
    seasonal_drop: 'Seasonal score drop',
    low_data_confidence: 'Low data confidence',
};

const ACTION_LABELS: Record<TransitAppActionType, string> = {
    maintain_service: 'Maintain service',
    improve_marketing: 'Improve rider information/marketing',
    retime_service: 'Retiming review',
    adjust_frequency: 'Frequency adjustment test',
    investigate_go_connections: 'GO connection review',
    monitor_only: 'Monitor only',
    manual_planner_review: 'Manual planner review',
};

export function evaluatePlannerRules(input: PlannerRuleInput): PlannerRuleResult {
    let diagnosisCode: TransitAppDiagnosisCode = 'healthy';
    let recommendedAction: TransitAppActionType = 'maintain_service';
    let effortBand: TransitAppEffortBand = 'Low';
    let impactBand: TransitAppImpactBand = 'Low';

    const weekdayWeekendDelta =
        input.weekdayScore !== null && input.weekendScore !== null
            ? Math.abs(input.weekdayScore - input.weekendScore)
            : null;

    if (input.confidence === 'Low' || input.compositeScore === null) {
        diagnosisCode = 'low_data_confidence';
        recommendedAction = 'manual_planner_review';
        effortBand = 'Low';
        impactBand = 'Low';
    } else if (input.totalViews < 60) {
        diagnosisCode = 'low_awareness';
        recommendedAction = 'improve_marketing';
        effortBand = 'Low';
        impactBand = 'Medium';
    } else if (input.viewToTapRate !== null && input.viewToTapRate < 0.08) {
        diagnosisCode = 'low_interest_conversion';
        recommendedAction = 'retime_service';
        effortBand = 'Medium';
        impactBand = 'Medium';
    } else if (input.tapToSuggestionRate !== null && input.tapToSuggestionRate < 0.35) {
        diagnosisCode = 'low_itinerary_followthrough';
        recommendedAction = 'adjust_frequency';
        effortBand = 'High';
        impactBand = 'High';
    } else if (input.suggestionToGoRate !== null && input.suggestionToGoRate < 0.15) {
        diagnosisCode = 'low_regional_integration';
        recommendedAction = 'investigate_go_connections';
        effortBand = 'Medium';
        impactBand = 'Medium';
    } else if (weekdayWeekendDelta !== null && weekdayWeekendDelta >= 15) {
        diagnosisCode = 'weekday_weekend_mismatch';
        recommendedAction = 'retime_service';
        effortBand = 'Medium';
        impactBand = 'Medium';
    } else if (input.seasonalDropPoints !== null && input.seasonalDropPoints >= 20) {
        diagnosisCode = 'seasonal_drop';
        recommendedAction = 'adjust_frequency';
        effortBand = 'High';
        impactBand = 'High';
    }

    if (input.belowMedian && input.trend === 'Declining' && recommendedAction === 'maintain_service') {
        recommendedAction = 'manual_planner_review';
        effortBand = 'Medium';
        impactBand = 'Medium';
    }
    if (!input.belowMedian && input.trend === 'Stable' && recommendedAction === 'maintain_service') {
        recommendedAction = 'monitor_only';
    }

    return {
        diagnosisCode,
        diagnosisLabel: DIAGNOSIS_LABELS[diagnosisCode],
        recommendedAction,
        recommendedActionLabel: ACTION_LABELS[recommendedAction],
        effortBand,
        impactBand,
    };
}
