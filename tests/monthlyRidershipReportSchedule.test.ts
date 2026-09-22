import { describe, expect, it } from 'vitest';
import { RIDERSHIP_TREND_BASELINE } from '../utils/ridership-trends/baseline';
import { buildMonthlyRidershipReportModel } from '../utils/ridership-trends/monthlyReport';
import {
  buildMonthlyRidershipMailDocument,
  extractPriorYearFixedDailyTotals,
  monthlyRidershipDocumentPaths,
  queueMonthlyRidershipMail,
  sendMonthlyRidershipReport,
} from '../functions/src/monthlyRidershipReport';

const model = buildMonthlyRidershipReportModel({
  baseline: RIDERSHIP_TREND_BASELINE,
  reportMonth: '2026-08',
  generatedAt: '2026-09-01T14:00:00.000Z',
});

function fakeFirestore() {
  const documents = new Map<string, unknown>();
  const db = {
    doc(path: string) {
      return { id: path.split('/').at(-1), path };
    },
    runTransaction: async (callback: (transaction: {
      get(ref: { path: string }): Promise<{ exists: boolean }>;
      create(ref: { path: string }, value: unknown): void;
    }) => Promise<boolean>) => callback({
      get: async ref => ({ exists: documents.has(ref.path) }),
      create: (ref, value) => { documents.set(ref.path, value); },
    }),
  };
  type QueueDb = Parameters<typeof queueMonthlyRidershipMail>[0]['db'];
  return { db: db as unknown as QueueDb, documents };
}

describe('monthly ridership report delivery', () => {
  it('runs at 10:00 Toronto time on the first day and retries transient failures', () => {
    const endpoint = sendMonthlyRidershipReport.__endpoint?.scheduleTrigger;

    expect(endpoint?.schedule).toBe('0 10 1 * *');
    expect(endpoint?.timeZone).toBe('America/Toronto');
    expect(endpoint?.retryConfig).toMatchObject({
      retryCount: 3,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 900,
      maxRetrySeconds: 3600,
    });
  });

  it('uses deterministic month-based audit and mail paths', () => {
    expect(monthlyRidershipDocumentPaths('team-1', '2026-08')).toEqual({
      auditPath: 'teams/team-1/monthlyRidershipReports/2026-08',
      mailPath: 'mail/monthly-ridership-team-1-2026-08',
    });
  });

  it('extracts validated same-month daily STREETS boardings for comparisons', () => {
    expect(extractPriorYearFixedDailyTotals({
      dailySummaries: [
        { date: '2025-08-01', system: { totalRidership: 8_600 } },
        { date: '2025-08-02', system: { totalRidership: 6_200 } },
        { date: '2025-07-31', system: { totalRidership: 9_000 } },
      ],
    }, '2025-08')).toEqual({
      '2025-08-01': 8_600,
      '2025-08-02': 6_200,
    });

    expect(() => extractPriorYearFixedDailyTotals({
      dailySummaries: [{ date: '2025-08-01', system: { totalRidership: -1 } }],
    }, '2025-08')).toThrow('Stored prior-year STREETS boardings are invalid.');
  });

  it('queues the audit and mail atomically once', async () => {
    const { db, documents } = fakeFirestore();
    const mailDocument = buildMonthlyRidershipMailDocument({
      recipients: ['manager@example.com'],
      reportMonth: '2026-08',
      model,
      chartPng: Buffer.from([137, 80, 78, 71]),
    });
    const input = {
      db,
      teamId: 'team-1',
      reportMonth: '2026-08',
      recipients: ['manager@example.com'],
      model,
      mailDocument,
    };

    await expect(queueMonthlyRidershipMail(input)).resolves.toBe(true);
    await expect(queueMonthlyRidershipMail(input)).resolves.toBe(false);
    expect(documents.has('teams/team-1/monthlyRidershipReports/2026-08')).toBe(true);
    expect(documents.has('mail/monthly-ridership-team-1-2026-08')).toBe(true);
    expect(mailDocument.message.attachments[0]).toMatchObject({
      encoding: 'base64',
      cid: 'monthly-ridership-chart',
      contentDisposition: 'inline',
    });
    expect(mailDocument.message.html).toContain('src="cid:barrie-transit-logo"');
    expect(mailDocument.message.attachments[1]).toMatchObject({
      filename: 'barrie-transit-logo.png',
      encoding: 'base64',
      cid: 'barrie-transit-logo',
      contentDisposition: 'inline',
    });
  });
});
