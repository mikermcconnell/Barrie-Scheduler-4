import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless Function - Gemini Schedule Parser Proxy
 * 
 * This keeps your API key secure by running on the server,
 * not in the user's browser.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error('GEMINI_API_KEY is not set in environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const { fileContent } = req.body;

        if (!fileContent || typeof fileContent !== 'string') {
            return res.status(400).json({ error: 'Missing or invalid fileContent' });
        }

        const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);

        const schema = {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    tableName: { type: SchemaType.STRING, description: "Name of this route/schedule." },
                    stops: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                        description: "Ordered list of row headers."
                    },
                    trips: {
                        type: SchemaType.ARRAY,
                        items: {
                            type: SchemaType.OBJECT,
                            properties: {
                                block: { type: SchemaType.STRING, description: "The Block number" },
                                tripName: { type: SchemaType.STRING, description: "The header label for this column" },
                                timesArray: {
                                    type: SchemaType.ARRAY,
                                    items: { type: SchemaType.STRING },
                                    description: "Values matching the 'stops' order."
                                }
                            },
                            required: ["block", "tripName", "timesArray"]
                        }
                    }
                },
                required: ["tableName", "stops", "trips"]
            }
        };

        const prompt = `
      Analyze the following CSV data extracted from a transit schedule spreadsheet.
      
      YOUR GOAL: Extract route schedules, capturing Block numbers, Recovery times, and combining directions.
      
      CRITICAL DATA FIDELITY RULES:
      1. **No Ghost Trips**: Do NOT create trips that don't exist in the header row.
      2. **Strict Column Mapping**: If the spreadsheet has 10 columns of times, return exactly 10 trips.
      3. **Block Numbers**: Look for a row labeled "Block" near the top.
      
      DATA (First 50k chars):
      ${fileContent.substring(0, 50000)} 
    `;

        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-pro-preview",
            systemInstruction: "You are a Transit Schedule Parser.",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema as any,
                temperature: 0.0,
            }
        });

        const result = await model.generateContent(prompt);
        const response = result.response;

        let jsonText = response.text();
        if (!jsonText) {
            return res.status(500).json({ error: 'Empty response from Gemini' });
        }

        jsonText = jsonText.replace(/```json/g, "").replace(/```/g, "").trim();
        const rawTables = JSON.parse(jsonText);

        // Post-process
        const parsedTables = rawTables.map((table: any) => {
            const processedTrips = table.trips.map((t: any, idx: number) => {
                const timeMap: { [key: string]: string } = {};
                table.stops.forEach((stop: string, i: number) => {
                    timeMap[stop] = t.timesArray[i] || "";
                });
                return {
                    tripId: `trip-${idx}-${Math.random().toString(36).substr(2, 5)}`,
                    block: t.block || String((idx % 2) + 1),
                    tripName: t.tripName,
                    times: timeMap
                };
            });

            return {
                tableName: table.tableName,
                stops: table.stops,
                trips: processedTrips
            };
        });

        return res.status(200).json({ tables: parsedTables });

    } catch (error) {
        console.error('Schedule Parser Error:', error);
        return res.status(500).json({
            error: 'Failed to parse schedule',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
