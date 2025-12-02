
import { OTPRecord } from '../types';

// Helper to convert HH:MM to minutes
const toMins = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

// Helper to convert minutes to HH:MM
const toTime = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const generateMockOTPData = (): OTPRecord[] => {
  const records: OTPRecord[] = [];
  const route = "Route 8A";
  const stop = "Barrie South GO";
  const scheduledTime = "07:10"; // Bus scheduled to arrive 07:10
  const scheduledMins = toMins(scheduledTime);

  // Generate 30 days of data
  for (let i = 30; i > 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    // Simulate realistic variance
    // Most buses are 1-3 mins late. Some early. Occasional major delay.
    let variance = 0;
    const r = Math.random();
    
    if (r > 0.95) variance = 8 + Math.floor(Math.random() * 10); // Major delay (5% chance)
    else if (r > 0.7) variance = 2 + Math.floor(Math.random() * 4); // Minor delay
    else if (r > 0.3) variance = -1 + Math.floor(Math.random() * 3); // On Timeish
    else variance = -3 + Math.floor(Math.random() * 2); // Early

    const actualMins = scheduledMins + variance;
    const deviation = actualMins - scheduledMins;

    // Classification
    let status: OTPRecord['status'] = 'On Time';
    if (deviation < -1) status = 'Early';
    else if (deviation > 5) status = 'Late';

    records.push({
      id: `otp-${i}`,
      date: dateStr,
      routeId: route,
      stopName: stop,
      scheduledTime,
      actualTime: toTime(actualMins),
      scheduledMinutes: scheduledMins,
      actualMinutes: actualMins,
      deviation,
      status
    });
  }

  return records;
};

// In a real app, this would interpret CSV/Excel columns using Gemini
// For prototype, we mimic the structure needed
export const analyzeConnectionSuccess = (records: OTPRecord[], trainDepartureTime: string, bufferMinutes: number = 5) => {
    const trainMins = toMins(trainDepartureTime);
    const cutoff = trainMins - bufferMinutes; // Bus must arrive by this time

    let successCount = 0;
    records.forEach(r => {
        if (r.actualMinutes <= cutoff) successCount++;
    });

    return (successCount / records.length) * 100;
};
