import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContentMock, getGenerativeModelMock } = vi.hoisted(() => {
    const generateContentMock = vi.fn();
    const getGenerativeModelMock = vi.fn(() => ({
        generateContent: generateContentMock,
    }));
    return { generateContentMock, getGenerativeModelMock };
});

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI(this: unknown) {
        return {
            getGenerativeModel: getGenerativeModelMock,
        };
    }),
}));

import handler, {
    handlePerformanceQueryRequest,
    performanceQueryHandler,
} from '../api/performance-query';

function createMockResponse() {
    const headers: Record<string, string> = {};
    let body: string | undefined;

    return {
        statusCode: 200,
        headers,
        body: () => body,
        setHeader: vi.fn((key: string, value: string) => {
            headers[key] = value;
        }),
        end: vi.fn((value: string) => {
            body = value;
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
});

afterEach(() => {
    delete process.env.GEMINI_API_KEY;
});

describe('performance query route', () => {
    it('rejects non-POST requests', async () => {
        const res = createMockResponse();

        await handlePerformanceQueryRequest({ method: 'GET' } as any, res as any);

        expect(res.statusCode).toBe(405);
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
        expect(JSON.parse(res.body() ?? '{}')).toEqual({ error: 'Method not allowed. Use POST.' });
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it('returns a server configuration error when GEMINI_API_KEY is missing', async () => {
        delete process.env.GEMINI_API_KEY;
        const res = createMockResponse();

        await handlePerformanceQueryRequest(
            {
                method: 'POST',
                body: { question: 'How was OTP?', context: 'summary' },
            } as any,
            res as any
        );

        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res.body() ?? '{}')).toEqual({ error: 'Server configuration error' });
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it('rejects invalid request bodies', async () => {
        const res = createMockResponse();

        await handlePerformanceQueryRequest(
            {
                method: 'POST',
                body: 'this is not json',
            } as any,
            res as any
        );

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body() ?? '{}')).toEqual({ error: 'Missing or invalid question/context' });
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it('returns an answer for a valid question/context pair', async () => {
        generateContentMock.mockResolvedValue({
            response: {
                text: () => 'OTP is steady at 91%.',
            },
        });

        const res = createMockResponse();

        await handler(
            {
                method: 'POST',
                body: JSON.stringify({
                    question: 'How is OTP trending?',
                    context: 'Selected period summary',
                }),
            } as any,
            res as any
        );

        expect(getGenerativeModelMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gemini-2.0-flash',
                systemInstruction: expect.any(String),
            })
        );
        expect(generateContentMock).toHaveBeenCalledWith(
            expect.stringContaining('Question: How is OTP trending?')
        );
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body() ?? '{}')).toEqual({ answer: 'OTP is steady at 91%.' });
    });
});

describe('performanceQueryHandler', () => {
    it('normalizes empty model output', async () => {
        generateContentMock.mockResolvedValue({
            response: {
                text: () => '',
            },
        });

        const result = await performanceQueryHandler('Question?', 'Context', 'api-key');

        expect(result).toEqual({ answer: 'No response generated.' });
    });
});
