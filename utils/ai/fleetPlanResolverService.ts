import type {
    FleetPlanAiResolverRequest,
    FleetPlanAiResolverResponse,
} from '../fleet-plan/fleetPlanAiResolverTypes';
import type { FleetPlanWorkbook } from '../fleet-plan/types';
import type { FleetPlanValidationResult } from '../fleet-plan/fleetPlanValidation';
import type { FleetPlanResolutionSuggestion } from '../fleet-plan/fleetPlanIssueResolver';
import type { LocalAiHealth } from './scheduleReviewService';

async function parseJsonResponse<T>(response: Response): Promise<T> {
    const data: { message?: unknown; error?: unknown } | null = await response.json().catch((): null => null);
    if (!response.ok) {
        const message = typeof data?.message === 'string'
            ? data.message
            : typeof data?.error === 'string'
                ? data.error
                : `API error: ${response.status}`;
        throw new Error(message);
    }
    return data as T;
}

export async function checkFleetPlanAiResolverHealth(): Promise<LocalAiHealth> {
    const response = await fetch('/api/fleet-plan-ai-resolver', {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });
    return parseJsonResponse<LocalAiHealth>(response);
}

export async function runFleetPlanAiResolver(
    workbook: FleetPlanWorkbook,
    validation: FleetPlanValidationResult,
    deterministicSuggestions: FleetPlanResolutionSuggestion[],
    currentYear: number,
): Promise<FleetPlanAiResolverResponse> {
    const request: FleetPlanAiResolverRequest = {
        workbook,
        validation,
        deterministicSuggestions,
        currentYear,
    };

    const response = await fetch('/api/fleet-plan-ai-resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    return parseJsonResponse<FleetPlanAiResolverResponse>(response);
}
