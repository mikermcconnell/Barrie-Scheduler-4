import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
    const results: Record<string, string> = {};

    try {
        await import('../lib/apiSecurity');
        results.apiSecurity = 'OK';
    } catch (e: any) {
        results.apiSecurity = e.message;
    }

    try {
        await import('@google/generative-ai');
        results.googleGenAi = 'OK';
    } catch (e: any) {
        results.googleGenAi = e.message;
    }

    res.status(200).json(results);
}
