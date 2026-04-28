import type { VercelRequest, VercelResponse } from '@vercel/node';
import type {
    FleetPlanAiResolutionSuggestion,
    FleetPlanAiResolverRequest,
    FleetPlanAiResolverResponse,
} from '../utils/fleet-plan/fleetPlanAiResolverTypes';
import type { FleetPlanWorkbook } from '../utils/fleet-plan/types';
import type { FleetPlanValidationIssue } from '../utils/fleet-plan/fleetPlanValidation';
import type { FleetPlanResolutionSuggestion } from '../utils/fleet-plan/fleetPlanIssueResolver';

interface JsonResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: string): void;
}

type LocalAiProvider = 'ollama' | 'openai-compatible';

interface LocalAiHealthPayload {
    enabled: boolean;
    available: boolean;
    provider: string;
    modelName: string;
    baseUrl?: string;
    message: string;
}

interface LocalAiConfig {
    enabled: boolean;
    provider: LocalAiProvider;
    baseUrl: string;
    modelName: string;
    timeoutMs: number;
    apiKey?: string;
}

interface FleetPlanResolverPromptPayload {
    currentYear: number;
    workbook: {
        sourceFileName: string;
        updatedAt: string;
        rowCount: number;
    };
    blockingIssues: Array<Pick<FleetPlanValidationIssue, 'code' | 'message' | 'sheetKey' | 'rowId' | 'unitNumber'>>;
    allowedSuggestions: Array<{
        id: string;
        issueCode: string;
        issueSeverity: string;
        issueMessage: string;
        title: string;
        currentSuggestion: string;
        actionType: string;
        currentSuggestedValue: string;
        rowContext: {
            sheetKey?: string;
            unitNumber?: string;
            makeModel?: string;
            year?: string;
            onOrder?: string;
            timeline?: Record<string, string>;
        };
    }>;
}

const SYSTEM_PROMPT = `You are Gemma 4 acting as a transit fleet planning resolver assistant.

Use only the supplied Fleet Plan snapshot.
Do not invent buses, purchases, retirements, policy, or missing source data.
Do not apply changes.
Only suggest values for the provided allowedSuggestions IDs.
The planner must accept, dismiss, or manually override every suggestion.

Return JSON only.`;

function sendJson(res: JsonResponse, statusCode: number, payload: unknown) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}

function getLocalAiConfig(): LocalAiConfig {
    const enabled = parseOptionalBoolean(process.env.LOCAL_AI_ENABLED) ?? true;
    const provider = (process.env.LOCAL_AI_PROVIDER?.trim().toLowerCase() === 'openai-compatible'
        ? 'openai-compatible'
        : 'ollama') as LocalAiProvider;
    const baseUrl = (process.env.LOCAL_AI_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
    const modelName = (process.env.LOCAL_AI_MODEL || 'gemma4').trim();
    const timeoutMsRaw = Number.parseInt(process.env.LOCAL_AI_TIMEOUT_MS || '', 10);
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 45000;
    const apiKey = process.env.LOCAL_AI_API_KEY?.trim();

    return {
        enabled,
        provider,
        baseUrl,
        modelName,
        timeoutMs,
        apiKey: apiKey || undefined,
    };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readRequestBody(body: VercelRequest['body']): FleetPlanAiResolverRequest | null {
    if (typeof body === 'string') {
        try {
            const parsed = JSON.parse(body);
            return isPlainObject(parsed) ? parsed as unknown as FleetPlanAiResolverRequest : null;
        } catch {
            return null;
        }
    }

    return isPlainObject(body) ? body as unknown as FleetPlanAiResolverRequest : null;
}

function isValidWorkbook(value: unknown): value is FleetPlanWorkbook {
    return isPlainObject(value)
        && value.schemaVersion === 1
        && isPlainObject(value.metadata)
        && Array.isArray(value.sheets);
}

function parseResolverRequest(body: VercelRequest['body']): FleetPlanAiResolverRequest | null {
    const parsed = readRequestBody(body);
    if (!parsed) return null;

    if (
        !isValidWorkbook(parsed.workbook)
        || !isPlainObject(parsed.validation)
        || !Array.isArray(parsed.validation.errors)
        || !Array.isArray(parsed.deterministicSuggestions)
        || !Number.isFinite(Number(parsed.currentYear))
    ) {
        return null;
    }

    return parsed;
}

async function getLocalAiHealth(config: LocalAiConfig): Promise<LocalAiHealthPayload> {
    if (!config.enabled) {
        return {
            enabled: false,
            available: false,
            provider: config.provider,
            modelName: config.modelName,
            baseUrl: config.baseUrl,
            message: 'Local AI is disabled by LOCAL_AI_ENABLED.',
        };
    }

    try {
        if (config.provider === 'ollama') {
            const response = await fetchWithTimeout(`${config.baseUrl}/api/tags`, {
                method: 'GET',
                headers: { Accept: 'application/json' },
            }, 5000);

            if (!response.ok) {
                return {
                    enabled: true,
                    available: false,
                    provider: config.provider,
                    modelName: config.modelName,
                    baseUrl: config.baseUrl,
                    message: `Ollama health check failed with ${response.status}.`,
                };
            }

            const payload = await response.json().catch(() => ({})) as { models?: Array<{ name?: string; model?: string }> };
            const models = Array.isArray(payload.models) ? payload.models : [];
            const found = models.some(model => model.name === config.modelName || model.model === config.modelName);

            return {
                enabled: true,
                available: found,
                provider: config.provider,
                modelName: config.modelName,
                baseUrl: config.baseUrl,
                message: found
                    ? 'Local model is available.'
                    : `Connected to Ollama, but model "${config.modelName}" was not found.`,
            };
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (config.apiKey) {
            headers.Authorization = `Bearer ${config.apiKey}`;
        }
        const response = await fetchWithTimeout(`${config.baseUrl}/models`, {
            method: 'GET',
            headers,
        }, 5000);

        if (!response.ok) {
            return {
                enabled: true,
                available: false,
                provider: config.provider,
                modelName: config.modelName,
                baseUrl: config.baseUrl,
                message: `OpenAI-compatible health check failed with ${response.status}.`,
            };
        }

        const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
        const models = Array.isArray(payload.data) ? payload.data : [];
        const found = models.some(model => model.id === config.modelName);

        return {
            enabled: true,
            available: found || models.length > 0,
            provider: config.provider,
            modelName: config.modelName,
            baseUrl: config.baseUrl,
            message: found
                ? 'Local model is available.'
                : models.length > 0
                    ? `Connected to the local runtime. Requested model "${config.modelName}" was not listed.`
                    : 'Connected to the local runtime, but no models were listed.',
        };
    } catch (error) {
        return {
            enabled: true,
            available: false,
            provider: config.provider,
            modelName: config.modelName,
            baseUrl: config.baseUrl,
            message: error instanceof Error ? error.message : 'Local AI health check failed.',
        };
    }
}

function getSuggestedValue(suggestion: FleetPlanResolutionSuggestion): string {
    if (suggestion.action.type === 'set-unit-number') return suggestion.action.suggestedUnitNumber;
    return suggestion.action.suggestedRetirementYear;
}

function getRowContext(workbook: FleetPlanWorkbook, suggestion: FleetPlanResolutionSuggestion): FleetPlanResolverPromptPayload['allowedSuggestions'][number]['rowContext'] {
    const sheet = workbook.sheets.find((entry) => entry.key === suggestion.action.sheetKey);
    const row = sheet?.rows.find((entry) => entry.id === suggestion.action.rowId);
    if (!row) return { sheetKey: suggestion.action.sheetKey };

    const compactTimeline = Object.fromEntries(
        Object.entries(row.timeline)
            .filter(([, value]) => value.trim())
            .slice(0, 24),
    );

    return {
        sheetKey: suggestion.action.sheetKey,
        unitNumber: row.unitNumber,
        makeModel: row.makeModel,
        year: row.year,
        onOrder: row.onOrder,
        timeline: compactTimeline,
    };
}

function buildPromptPayload(request: FleetPlanAiResolverRequest): FleetPlanResolverPromptPayload {
    const rowCount = request.workbook.sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
    const allowedSuggestions = request.deterministicSuggestions.slice(0, 40).map((suggestion) => ({
        id: suggestion.id,
        issueCode: suggestion.issueCode,
        issueSeverity: suggestion.issueSeverity,
        issueMessage: suggestion.issueMessage,
        title: suggestion.title,
        currentSuggestion: suggestion.suggestion,
        actionType: suggestion.action.type,
        currentSuggestedValue: getSuggestedValue(suggestion),
        rowContext: getRowContext(request.workbook, suggestion),
    }));

    return {
        currentYear: Number(request.currentYear),
        workbook: {
            sourceFileName: request.workbook.metadata.sourceFileName,
            updatedAt: request.workbook.metadata.updatedAt,
            rowCount,
        },
        blockingIssues: request.validation.errors.slice(0, 60).map((issue) => ({
            code: issue.code,
            message: issue.message,
            sheetKey: issue.sheetKey,
            rowId: issue.rowId,
            unitNumber: issue.unitNumber,
        })),
        allowedSuggestions,
    };
}

function buildUserPrompt(request: FleetPlanAiResolverRequest): string {
    const promptPayload = buildPromptPayload(request);
    return [
        'Suggest safe quick fixes for Fleet Plan blocking issues and warnings.',
        '',
        'Rules:',
        '- Only return suggestions for IDs listed in allowedSuggestions.',
        '- For duplicate or missing units, suggestedValue must be a unit number string.',
        '- For multiple retirement markers, suggestedValue must be a four-digit year from the affected row timeline unless there is clear reason to keep the deterministic value.',
        '- If unsure, keep the currentSuggestedValue and mark confidence low.',
        '- Include short planner-facing rationale. Do not mention internal row IDs unless needed.',
        '',
        'Return this JSON shape:',
        '{',
        '  "summary": "plain-English summary",',
        '  "suggestions": [',
        '    {',
        '      "deterministicSuggestionId": "exact allowedSuggestions id",',
        '      "suggestedValue": "optional replacement value",',
        '      "suggestion": "planner-facing suggestion text",',
        '      "rationale": "why this is safe or what to verify",',
        '      "confidence": "low | medium | high"',
        '    }',
        '  ],',
        '  "cautions": ["optional caution"]',
        '}',
        '',
        `Fleet Plan snapshot: ${JSON.stringify(promptPayload)}`,
    ].join('\n');
}

function extractJsonText(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return trimmed.slice(start, end + 1);
    }

    throw new Error('Local model did not return valid JSON.');
}

function normalizeAiSuggestion(entry: unknown, allowedIds: Set<string>): FleetPlanAiResolutionSuggestion | null {
    if (!isPlainObject(entry)) return null;

    const deterministicSuggestionId = typeof entry.deterministicSuggestionId === 'string'
        ? entry.deterministicSuggestionId
        : '';
    if (!allowedIds.has(deterministicSuggestionId)) return null;

    const confidence = ['low', 'medium', 'high'].includes(String(entry.confidence))
        ? entry.confidence as FleetPlanAiResolutionSuggestion['confidence']
        : 'low';

    return {
        deterministicSuggestionId,
        suggestedValue: typeof entry.suggestedValue === 'string' ? entry.suggestedValue.trim() : undefined,
        suggestion: typeof entry.suggestion === 'string' && entry.suggestion.trim()
            ? entry.suggestion.trim()
            : 'Review and apply the suggested value if it matches the source workbook.',
        rationale: typeof entry.rationale === 'string' && entry.rationale.trim()
            ? entry.rationale.trim()
            : 'Generated from the supplied Fleet Plan issue context.',
        confidence,
    };
}

function normalizeResponse(raw: unknown, request: FleetPlanAiResolverRequest, modelName: string, durationMs?: number): FleetPlanAiResolverResponse {
    if (!isPlainObject(raw)) {
        throw new Error('Local model returned an invalid response shape.');
    }

    const allowedIds = new Set(request.deterministicSuggestions.map((suggestion) => suggestion.id));
    const suggestions = Array.isArray(raw.suggestions)
        ? raw.suggestions
            .map((entry) => normalizeAiSuggestion(entry, allowedIds))
            .filter((entry): entry is FleetPlanAiResolutionSuggestion => !!entry)
            .slice(0, 40)
        : [];
    const cautions = Array.isArray(raw.cautions)
        ? raw.cautions.filter((item): item is string => typeof item === 'string').slice(0, 6)
        : [];

    return {
        summary: typeof raw.summary === 'string' && raw.summary.trim()
            ? raw.summary.trim()
            : 'Gemma 4 reviewed the Fleet Plan blocking issues.',
        suggestions,
        cautions,
        model: {
            provider: 'local',
            modelName,
            durationMs,
        },
    };
}

async function callOllamaResolver(config: LocalAiConfig, request: FleetPlanAiResolverRequest): Promise<FleetPlanAiResolverResponse> {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(`${config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: config.modelName,
            system: SYSTEM_PROMPT,
            prompt: buildUserPrompt(request),
            stream: false,
            format: 'json',
            options: {
                temperature: 0.2,
            },
        }),
    }, config.timeoutMs);

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `Local AI request failed with ${response.status}.`);
    }

    const payload = await response.json().catch(() => ({})) as { response?: string };
    const jsonText = extractJsonText(typeof payload.response === 'string' ? payload.response : '');
    return normalizeResponse(JSON.parse(jsonText), request, config.modelName, Date.now() - startedAt);
}

async function callOpenAiCompatibleResolver(config: LocalAiConfig, request: FleetPlanAiResolverRequest): Promise<FleetPlanAiResolverResponse> {
    const startedAt = Date.now();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: config.modelName,
            temperature: 0.2,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildUserPrompt(request) },
            ],
            response_format: { type: 'json_object' },
        }),
    }, config.timeoutMs);

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `Local AI request failed with ${response.status}.`);
    }

    const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content || '';
    const jsonText = extractJsonText(content);
    return normalizeResponse(JSON.parse(jsonText), request, config.modelName, Date.now() - startedAt);
}

export async function handleFleetPlanAiResolver(request: FleetPlanAiResolverRequest): Promise<FleetPlanAiResolverResponse> {
    const config = getLocalAiConfig();
    if (!config.enabled) {
        throw new Error('Local AI is disabled. Set LOCAL_AI_ENABLED=true to use Gemma 4 Fleet Plan suggestions.');
    }

    if (request.deterministicSuggestions.length === 0) {
        return {
            summary: 'No blocking issues have generated suggestions available.',
            suggestions: [],
            cautions: [],
            model: {
                provider: 'local',
                modelName: config.modelName,
                durationMs: 0,
            },
        };
    }

    const health = await getLocalAiHealth(config);
    if (!health.available) {
        throw new Error(health.message);
    }

    if (config.provider === 'ollama') {
        return callOllamaResolver(config, request);
    }

    return callOpenAiCompatibleResolver(config, request);
}

export async function handleFleetPlanAiResolverRequest(req: VercelRequest, res: VercelResponse): Promise<void> {
    const config = getLocalAiConfig();

    if (req.method === 'GET') {
        const health = await getLocalAiHealth(config);
        sendJson(res, 200, health);
        return;
    }

    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed. Use GET or POST.' });
        return;
    }

    const payload = parseResolverRequest(req.body);
    if (!payload) {
        sendJson(res, 400, { error: 'Missing or invalid Fleet Plan resolver request.' });
        return;
    }

    try {
        const result = await handleFleetPlanAiResolver(payload);
        sendJson(res, 200, result);
    } catch (error) {
        sendJson(res, 500, {
            error: 'Gemma 4 Fleet Plan resolver failed',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    return handleFleetPlanAiResolverRequest(req, res);
}
