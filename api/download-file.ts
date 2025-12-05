import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Serverless proxy for downloading files from Firebase Storage
 * This bypasses CORS issues when running on localhost
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { downloadUrl } = req.body;

    if (!downloadUrl) {
        return res.status(400).json({ error: 'Missing downloadUrl' });
    }

    try {
        console.log('Proxying file download:', downloadUrl);

        // Fetch the file content server-side (no CORS restrictions)
        const response = await fetch(downloadUrl);

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }

        const content = await response.text();

        console.log('Downloaded file content length:', content.length);

        return res.status(200).json({
            success: true,
            content
        });
    } catch (error: any) {
        console.error('File download proxy error:', error);
        return res.status(500).json({
            error: 'Failed to download file',
            details: error.message
        });
    }
}
