import type { OTPBreakdown } from './performanceDataTypes';

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Merge OTP buckets by raw observation counts.
 *
 * Use this for multi-day and multi-route rollups. Averaging stored percentages
 * gives small days the same weight as busy days and can disagree with the raw
 * early/on-time/late totals shown elsewhere.
 */
export function mergeOTPBreakdowns(breakdowns: readonly OTPBreakdown[]): OTPBreakdown {
  let total = 0;
  let onTime = 0;
  let early = 0;
  let late = 0;
  let weightedDeviation = 0;

  for (const b of breakdowns) {
    total += b.total;
    onTime += b.onTime;
    early += b.early;
    late += b.late;
    weightedDeviation += b.avgDeviationSeconds * b.total;
  }

  return {
    total,
    onTime,
    early,
    late,
    onTimePercent: safeDivide(onTime * 100, total),
    earlyPercent: safeDivide(early * 100, total),
    latePercent: safeDivide(late * 100, total),
    avgDeviationSeconds: safeDivide(weightedDeviation, total),
  };
}
