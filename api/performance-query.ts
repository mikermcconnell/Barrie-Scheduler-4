import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a transit performance analyst for Barrie Transit, a mid-size municipal transit agency in Ontario, Canada.

You are given performance data from the STREETS AVL/APC system. Answer questions accurately using ONLY the provided data. If the data doesn't contain enough information to answer, say so.

Key definitions:
- OTP (On-Time Performance): Trips arriving within -3 min (early) to +5 min (late) of schedule
- BPH (Boardings Per Hour): Ridership efficiency metric = total boardings / service hours
- Load: Passengers on board at a given stop
- Timepoint: A stop where schedule adherence is measured
- Service Hours: Total vehicle hours operated

When providing analysis:
- Cite specific numbers from the data
- Highlight concerning trends (OTP < 85%, declining ridership)
- Suggest possible causes when patterns are clear
- Keep responses concise and actionable
- Use bullet points and tables where appropriate`;

type PerformanceQueryBody = {
    question?: unknown;
    context?: unknown;
};

type JsonResponse = Pick<VercelResponse, 'statusCode' | 'setHeader' | 'end'>;

function sendJson(res: JsonResponse, statusCode: number, payload: Record<string, unknown>) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
}

function readRequestBody(body: VercelRequest['body']): PerformanceQueryBody | null {
    if (typeof body === 'string') {
        try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed === 'object') {
                return parsed as PerformanceQueryBody;
            }
        } catch {
            return null;
        }
        return null;
    }

    if (body && typeof body === 'object') {
        return body as PerformanceQueryBody;
    }

    return null;
}

function parsePerformanceQueryPayload(body: VercelRequest['body']) {
    const parsed = readRequestBody(body);
    if (!parsed) {
        return null;
    }

    const { question, context } = parsed;
    if (typeof question !== 'string' || typeof context !== 'string') {
        return null;
    }

    const trimmedQuestion = question.trim();
    const trimmedContext = context.trim();
    if (!trimmedQuestion || !trimmedContext) {
        return null;
    }

    return {
        question: trimmedQuestion,
        context: trimmedContext,
    };
}

export async function performanceQueryHandler(
    question: string,
    context: string,
    apiKey: string,
): Promise<{ answer: string }> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
            temperature: 0.3,
        },
    });

    const prompt = `Here is the performance data for the selected period:\n\n${context}\n\n---\n\nQuestion: ${question}`;

    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    return { answer: answer || 'No response generated.' };
}

export async function handlePerformanceQueryRequest(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
        return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY is not set in environment variables');
        sendJson(res, 500, { error: 'Server configuration error' });
        return;
    }

    const payload = parsePerformanceQueryPayload(req.body);
    if (!payload) {
        sendJson(res, 400, { error: 'Missing or invalid question/context' });
        return;
    }

    try {
        const result = await performanceQueryHandler(payload.question, payload.context, apiKey);
        sendJson(res, 200, result);
    } catch (error) {
        console.error('Performance query error:', error);
        sendJson(res, 500, {
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    return handlePerformanceQueryRequest(req, res);
}
