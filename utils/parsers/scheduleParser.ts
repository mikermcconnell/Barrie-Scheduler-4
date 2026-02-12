/**
 * Schedule Parser - Calls our secure serverless API
 * 
 * WHY THIS IS BETTER:
 * - Before: We had the Gemini API key in browser code (anyone could steal it!)
 * - Now: The API key is only on the Vercel server, safe and hidden
 */

export interface ParsedTrip {
  tripId: string;
  block: string;
  tripName: string;
  times: { [stopId: string]: string };
}

export interface ParsedTable {
  tableName: string;
  stops: string[];
  trips: ParsedTrip[];
}

export const parseScheduleWithGemini = async (fileContent: string): Promise<ParsedTable[]> => {
  if (!fileContent || fileContent.trim().length === 0) {
    console.warn("Empty file content provided to parser");
    return [];
  }

  try {
    // Check if we're running locally or deployed
    const isLocalhost = window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
      // For local development, show a message and return empty
      // The full parsing only works when deployed to Vercel
      console.log("Schedule parsing with AI requires deployment to Vercel.");
      console.log("For local testing, you can use the CSV parsers in csvParsers.ts");

      // Return a simple placeholder to indicate local mode
      return [{
        tableName: "Local Mode - Deploy to Vercel for AI parsing",
        stops: ["Deploy to Vercel to enable AI schedule parsing"],
        trips: []
      }];
    }

    // When deployed, call our secure serverless API
    const response = await fetch('/api/parse-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileContent }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'API request failed');
    }

    const data = await response.json();

    // Sort trips chronologically
    const parsedTables: ParsedTable[] = data.tables.map((table: ParsedTable) => {
      const sortedTrips = [...table.trips].sort((a, b) => {
        const firstStop = table.stops[0];
        const timeA = a.times[firstStop];
        const timeB = b.times[firstStop];
        if (!timeA || !timeB) return 0;

        const parse = (t: string) => {
          const d = new Date(`1970/01/01 ${t}`);
          return isNaN(d.getTime()) ? 0 : d.getTime();
        };
        return parse(timeA) - parse(timeB);
      });

      return { ...table, trips: sortedTrips };
    });

    return parsedTables;

  } catch (error) {
    console.error("Schedule Parsing Failed:", error);
    return [];
  }
};