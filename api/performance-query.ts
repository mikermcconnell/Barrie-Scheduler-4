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
