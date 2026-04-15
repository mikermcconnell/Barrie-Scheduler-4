import type {
    ScheduleReviewAction,
    ScheduleReviewRequest,
    ScheduleReviewResponse,
    ScheduleReviewSnapshot,
} from './scheduleReviewTypes';

export interface LocalAiHealth {
    enabled: boolean;
    available: boolean;
    provider: string;
    modelName: string;
    baseUrl?: string;
    message: string;
}

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

export async function checkLocalAiHealth(): Promise<LocalAiHealth> {
    const response = await fetch('/api/local-ai-review', {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });
    return parseJsonResponse<LocalAiHealth>(response);
}

export async function runScheduleReview(
    action: ScheduleReviewAction,
    snapshot: ScheduleReviewSnapshot,
): Promise<ScheduleReviewResponse> {
    const request: ScheduleReviewRequest = {
        action,
        snapshot,
    };

    const response = await fetch('/api/local-ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    return parseJsonResponse<ScheduleReviewResponse>(response);
}
