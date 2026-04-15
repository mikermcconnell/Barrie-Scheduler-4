import type { VercelRequest, VercelResponse } from '@vercel/node';
import type {
    ScheduleReviewAction,
    ScheduleReviewFinding,
    ScheduleReviewRequest,
    ScheduleReviewResponse,
    ScheduleReviewSnapshot,
} from '../utils/ai/scheduleReviewTypes';

type JsonResponse = Pick<VercelResponse, 'statusCode' | 'setHeader' | 'end'>;

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

const SYSTEM_PROMPT = `You are a transit schedule review assistant for Barrie Transit.

Use only the supplied review snapshot.
Do not invent facts.
Do not propose automatic schedule edits.
Do not claim certainty when evidence is weak.

Your job is to help a planner review a draft schedule by:
- identifying the most notable anomalies
- citing evidence from the snapshot
- grouping issues by operational significance
- suggesting what the planner should inspect manually

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

function readRequestBody(body: VercelRequest['body']): ScheduleReviewRequest | null {
    if (typeof body === 'string') {
        try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed === 'object') {
                return parsed as ScheduleReviewRequest;
            }
        } catch {
            return null;
        }
        return null;
    }

    if (body && typeof body === 'object') {
        return body as ScheduleReviewRequest;
    }

    return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidSnapshot(snapshot: unknown): snapshot is ScheduleReviewSnapshot {
    return isPlainObject(snapshot)
        && typeof snapshot.draftName === 'string'
        && typeof snapshot.routeGroupName === 'string'
        && typeof snapshot.dayType === 'string'
        && typeof snapshot.routeIdentity === 'string'
        && typeof snapshot.generatedAt === 'string'
        && isPlainObject(snapshot.summary)
        && Array.isArray(snapshot.rows)
        && Array.isArray(snapshot.deterministicFindings);
}

function parseReviewRequest(body: VercelRequest['body']): ScheduleReviewRequest | null {
    const parsed = readRequestBody(body);
    if (
        !parsed
        || !['find-anomalies', 'summarize-draft-vs-master'].includes(String(parsed.action))
        || !isValidSnapshot(parsed.snapshot)
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

function trimSnapshotForPrompt(snapshot: ScheduleReviewSnapshot): ScheduleReviewSnapshot {
    const sortedRows = [...snapshot.rows].sort((a, b) => b.flags.length - a.flags.length);
    const rowLimit = sortedRows.length > 80 ? 80 : sortedRows.length;
    const findingLimit = snapshot.deterministicFindings.length > 60 ? 60 : snapshot.deterministicFindings.length;

    return {
        ...snapshot,
        rows: sortedRows.slice(0, rowLimit),
        deterministicFindings: snapshot.deterministicFindings.slice(0, findingLimit),
    };
}

function buildAnomalyPrompt(snapshot: ScheduleReviewSnapshot): string {
    const trimmedSnapshot = trimSnapshotForPrompt(snapshot);
    return [
        'Review this draft schedule snapshot and find the most important anomalies.',
        '',
        'Focus on:',
        '- unusual headways',
        '- unusually low or high recovery',
        '- suspicious new or ambiguous trips compared with master',
        '- patterns that may deserve planner review',
        '',
        'Prioritize the top findings only.',
        'Prefer concrete evidence over broad commentary.',
        '',
        'Return this JSON shape:',
        '{',
        '  "summary": "short plain-English summary",',
        '  "overallRisk": "low | medium | high",',
        '  "findings": [',
        '    {',
        '      "title": "short issue title",',
        '      "severity": "info | warning | critical",',
        '      "category": "headway | recovery | compare | service-pattern",',
        '      "evidence": ["fact 1", "fact 2"],',
        '      "affectedRows": [{"rowKey": "row-1", "blockId": "101"}],',
        '      "plannerNote": "what to inspect manually",',
        '      "confidence": "low | medium | high"',
        '    }',
        '  ],',
        '  "cautions": ["optional caution"]',
        '}',
        '',
        `Snapshot: ${JSON.stringify(trimmedSnapshot)}`,
    ].join('\n');
}

function buildDraftVsMasterPrompt(snapshot: ScheduleReviewSnapshot): string {
    const trimmedSnapshot = trimSnapshotForPrompt(snapshot);
    return [
        'Summarize how this draft differs from the current master schedule.',
        '',
        'Focus on:',
        '- service that was added, removed, or now needs compare review',
        '- timing pattern changes that seem operationally meaningful',
        '- likely planner or approver takeaways',
        '',
        'Keep the summary plain-English and concrete.',
        'Use only the supplied snapshot.',
        '',
        'Return this JSON shape:',
        '{',
        '  "summary": "plain-English change summary",',
        '  "overallRisk": "low | medium | high",',
        '  "findings": [',
        '    {',
        '      "title": "short change title",',
        '      "severity": "info | warning | critical",',
        '      "category": "headway | recovery | compare | service-pattern",',
        '      "evidence": ["fact 1", "fact 2"],',
        '      "affectedRows": [{"rowKey": "row-1", "blockId": "101"}],',
        '      "plannerNote": "what to verify manually",',
        '      "confidence": "low | medium | high"',
        '    }',
        '  ],',
        '  "cautions": ["optional caution"]',
        '}',
        '',
        `Snapshot: ${JSON.stringify(trimmedSnapshot)}`,
    ].join('\n');
}

function buildUserPrompt(action: ScheduleReviewAction, snapshot: ScheduleReviewSnapshot): string {
    return action === 'summarize-draft-vs-master'
        ? buildDraftVsMasterPrompt(snapshot)
        : buildAnomalyPrompt(snapshot);
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

function normalizeFinding(entry: unknown): ScheduleReviewFinding | null {
    if (!isPlainObject(entry)) return null;

    const severity = entry.severity;
    const category = entry.category;
    const confidence = entry.confidence;
    if (!['info', 'warning', 'critical'].includes(String(severity))) return null;
    if (!['headway', 'recovery', 'compare', 'service-pattern'].includes(String(category))) return null;
    if (!['low', 'medium', 'high'].includes(String(confidence))) return null;

    const evidence = Array.isArray(entry.evidence)
        ? entry.evidence.filter((item): item is string => typeof item === 'string').slice(0, 6)
        : [];
    const affectedRows = Array.isArray(entry.affectedRows)
        ? entry.affectedRows
            .filter(isPlainObject)
            .map(item => ({
                rowKey: typeof item.rowKey === 'string' ? item.rowKey : '',
                blockId: typeof item.blockId === 'string' ? item.blockId : '',
            }))
            .filter(item => item.rowKey || item.blockId)
            .slice(0, 8)
        : [];

    return {
        title: typeof entry.title === 'string' ? entry.title : 'Untitled finding',
        severity: severity as ScheduleReviewFinding['severity'],
        category: category as ScheduleReviewFinding['category'],
        evidence,
        affectedRows,
        plannerNote: typeof entry.plannerNote === 'string' ? entry.plannerNote : 'Review this issue manually in the schedule grid.',
        confidence: confidence as ScheduleReviewFinding['confidence'],
    };
}

function normalizeResponse(raw: unknown, modelName: string, durationMs?: number): ScheduleReviewResponse {
    if (!isPlainObject(raw)) {
        throw new Error('Local model returned an invalid response shape.');
    }

    const overallRisk = ['low', 'medium', 'high'].includes(String(raw.overallRisk))
        ? raw.overallRisk as ScheduleReviewResponse['overallRisk']
        : 'medium';
    const findings = Array.isArray(raw.findings)
        ? raw.findings.map(normalizeFinding).filter((item): item is ScheduleReviewFinding => !!item)
        : [];
    const cautions = Array.isArray(raw.cautions)
        ? raw.cautions.filter((item): item is string => typeof item === 'string').slice(0, 6)
        : [];

    return {
        summary: typeof raw.summary === 'string'
            ? raw.summary
            : 'The local model completed a review, but did not provide a summary.',
        overallRisk,
        findings,
        cautions,
        model: {
            provider: 'local',
            modelName,
            durationMs,
        },
    };
}

async function callOllamaReview(
    config: LocalAiConfig,
    action: ScheduleReviewAction,
    snapshot: ScheduleReviewSnapshot,
): Promise<ScheduleReviewResponse> {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(`${config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: config.modelName,
            system: SYSTEM_PROMPT,
            prompt: buildUserPrompt(action, snapshot),
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
    return normalizeResponse(JSON.parse(jsonText), config.modelName, Date.now() - startedAt);
}

async function callOpenAiCompatibleReview(
    config: LocalAiConfig,
    action: ScheduleReviewAction,
    snapshot: ScheduleReviewSnapshot,
): Promise<ScheduleReviewResponse> {
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
                { role: 'user', content: buildUserPrompt(action, snapshot) },
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
    return normalizeResponse(JSON.parse(jsonText), config.modelName, Date.now() - startedAt);
}

export async function handleLocalAiReview(
    action: ScheduleReviewAction,
    snapshot: ScheduleReviewSnapshot,
): Promise<ScheduleReviewResponse> {
    const config = getLocalAiConfig();
    if (!config.enabled) {
        throw new Error('Local AI is disabled. Set LOCAL_AI_ENABLED=true to use AI Review.');
    }

    const health = await getLocalAiHealth(config);
    if (!health.available) {
        throw new Error(health.message);
    }

    if (config.provider === 'ollama') {
        return callOllamaReview(config, action, snapshot);
    }

    return callOpenAiCompatibleReview(config, action, snapshot);
}

export async function handleLocalAiReviewRequest(req: VercelRequest, res: VercelResponse): Promise<void> {
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

    const payload = parseReviewRequest(req.body);
    if (!payload) {
        sendJson(res, 400, { error: 'Missing or invalid action/snapshot.' });
        return;
    }

    try {
        if (payload.action === 'summarize-draft-vs-master' && !payload.snapshot.compareToMaster) {
            sendJson(res, 400, {
                error: 'Draft vs master summary is unavailable',
                message: 'This route/day snapshot does not have a master comparison baseline yet.',
            });
            return;
        }

        const result = await handleLocalAiReview(payload.action, payload.snapshot);
        sendJson(res, 200, result);
    } catch (error) {
        sendJson(res, 500, {
            error: 'Local AI review failed',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    return handleLocalAiReviewRequest(req, res);
}
