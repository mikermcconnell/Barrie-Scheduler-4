import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
    const results: Record<string, string> = {};

    try {
        await import('./security');
        results.security = 'OK';
    } catch (e: any) {
        results.security = e.message;
    }

    try {
        await import('@google/generative-ai');
        results.generativeAi = 'OK';
    } catch (e: any) {
        results.generativeAi = e.message;
    }

    res.status(200).json(results);
}
