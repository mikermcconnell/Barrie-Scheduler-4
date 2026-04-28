import type { FleetPlanWorkbook } from './types';
import type { FleetPlanValidationResult } from './fleetPlanValidation';
import type { FleetPlanResolutionSuggestion } from './fleetPlanIssueResolver';

export interface FleetPlanAiResolverRequest {
    workbook: FleetPlanWorkbook;
    validation: FleetPlanValidationResult;
    deterministicSuggestions: FleetPlanResolutionSuggestion[];
    currentYear: number;
}

export interface FleetPlanAiResolutionSuggestion {
    deterministicSuggestionId: string;
    suggestedValue?: string;
    suggestion: string;
    rationale: string;
    confidence: 'low' | 'medium' | 'high';
}

export interface FleetPlanAiResolverResponse {
    summary: string;
    suggestions: FleetPlanAiResolutionSuggestion[];
    cautions: string[];
    model: {
        provider: 'local';
        modelName: string;
        durationMs?: number;
    };
}
