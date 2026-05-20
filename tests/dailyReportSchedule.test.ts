import { describe, expect, test } from 'vitest';
import { sendDailyReport } from '../functions/src/dailyReport';

describe('sendDailyReport schedule', () => {
  test('retries transient scheduler delivery failures', () => {
    const retryConfig = sendDailyReport.__endpoint?.scheduleTrigger?.retryConfig;

    expect(retryConfig).toMatchObject({
      retryCount: 3,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 900,
      maxRetrySeconds: 3600,
    });
  });
});
