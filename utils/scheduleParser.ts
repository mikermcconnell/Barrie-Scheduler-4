import { GoogleGenAI, Type } from "@google/genai";

// Initialize the API client
// Note: process.env.API_KEY is assumed to be available
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface ParsedTrip {
  tripId: string;
  block: string; // "1", "2", etc.
  tripName: string; // e.g., "Run 101" or "6:00 AM"
  times: { [stopId: string]: string }; // stopId -> "HH:MM" or "5" (for recovery)
}

export interface ParsedTable {
  tableName: string; // "400 Full Cycle" or "400 North"
  stops: string[]; // List of stop names in order, including (Arr), (Dep), and Recovery
  trips: ParsedTrip[];
}

export const parseScheduleWithGemini = async (fileContent: string): Promise<ParsedTable[]> => {
  if (!fileContent || fileContent.trim().length === 0) {
    console.warn("Empty file content provided to parser");
    return [];
  }

  try {
    // 1. Define the Schema for the AI to fill
    const schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tableName: { type: Type.STRING, description: "Name of this route/schedule. If combining directions, use something like 'Route 400 Full Cycle'." },
          stops: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Ordered list of row headers. IMPORTANT: If a stop has an Arrive, Recovery, and Depart, create 3 separate items: 'Location (Arr)', 'Location (Recovery)', 'Location (Dep)'."
          },
          trips: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                block: { type: Type.STRING, description: "The Block number found in the header (e.g., '1', '2', '12'). Default to '?' if not found." },
                tripName: { type: Type.STRING, description: "The header label for this column (e.g. 'Trip 1' or the first time '6:50 AM')." },
                timesArray: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "Values matching the 'stops' order. Use empty string if cell is blank. For Recovery rows, extract the integer minutes (e.g. '6')." 
                }
              },
              required: ["block", "tripName", "timesArray"]
            }
          }
        },
        required: ["tableName", "stops", "trips"]
      }
    };

    // 2. Prompt
    const prompt = `
      Analyze the following CSV data extracted from a transit schedule spreadsheet.
      
      YOUR GOAL: Extract route schedules, capturing Block numbers, Recovery times, and combining directions.
      
      CRITICAL DATA FIDELITY RULES:
      1. **No Ghost Trips**: Do NOT create trips that don't exist in the header row. The "Trip Name" is usually the time in the first row of data (e.g. 6:50 AM). Do NOT treat the second row of data as a new trip header.
      2. **Strict Column Mapping**: If the spreadsheet has 10 columns of times, you MUST return exactly 10 trips.
      3. **Block Numbers**: Look for a row labeled "Block", "Blk", or similar near the top. Extract this value for each trip column. If "1, 2, 1, 2" pattern exists, map it accurately.
      
      RECOVERY & DIRECTION RULES:
      1. **Recovery Columns ("R")**: 
         - Look specifically for narrow columns labeled "R" or "Rec" containing small integers (5, 6, 8, 10).
         - These are durations, NOT times.
         - Structure: [Arrive Row] -> [Recovery Row] -> [Depart Row].
         - Name the rows: "Location (Arr)", "Location (Recovery)", "Location (Dep)".
      
      2. **Combine Directions (Cycle Logic)**: 
         - If the sheet contains "North" and "South" tables, COMBINE them into a single continuous list to show the full bus cycle.
         - Sequence: Start -> Intermediate -> Terminal (Arr) -> Terminal (Recovery) -> Terminal (Dep) -> Return.
      
      DATA (First 50k chars):
      ${fileContent.substring(0, 50000)} 
    `;

    // 3. Call API
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.0, // Zero temp to reduce hallucinations
      }
    });

    let jsonText = response.text;
    
    if (!jsonText) {
        console.error("Gemini returned empty response.");
        return [];
    }

    // CLEANUP: Sometimes the model wraps JSON in markdown blocks despite the config
    jsonText = jsonText.replace(/```json/g, "").replace(/```/g, "").trim();

    const rawTables = JSON.parse(jsonText);

    // 4. Post-process
    const parsedTables: ParsedTable[] = rawTables.map((table: any) => {
        const processedTrips: ParsedTrip[] = table.trips.map((t: any, idx: number) => {
            const timeMap: { [key: string]: string } = {};
            table.stops.forEach((stop: string, i: number) => {
                timeMap[stop] = t.timesArray[i] || "";
            });
            return {
                tripId: `trip-${idx}-${Math.random().toString(36).substr(2, 5)}`,
                block: t.block || String((idx % 2) + 1), // Fallback block assignment if AI misses it
                tripName: t.tripName,
                times: timeMap
            };
        });

        // Sort trips by the time of the first stop to ensure chronological order
        // This helps fix issues where AI might grab columns out of order
        processedTrips.sort((a: ParsedTrip, b: ParsedTrip) => {
             const firstStop = table.stops[0];
             const timeA = a.times[firstStop];
             const timeB = b.times[firstStop];
             if (!timeA || !timeB) return 0;
             
             // Simple helper to compare times roughly
             const parse = (t: string) => {
                 const d = new Date(`1970/01/01 ${t}`);
                 return isNaN(d.getTime()) ? 0 : d.getTime();
             };
             return parse(timeA) - parse(timeB);
        });

        return {
            tableName: table.tableName,
            stops: table.stops,
            trips: processedTrips
        };
    });

    return parsedTables;

  } catch (error) {
    console.error("Schedule Parsing Failed:", error);
    return [];
  }
};