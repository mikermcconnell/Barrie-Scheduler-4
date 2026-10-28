import { describe, expect, it } from 'vitest';
import { RIDERSHIP_TREND_BASELINE } from '../utils/ridership-trends/baseline';
import { buildMonthlyRidershipReportModel } from '../utils/ridership-trends/monthlyReport';
import { buildMonthlyRidershipReportModel as buildMonthlyRidershipReportModelV1 } from '../utils/ridership-trends/monthlyReportV1';
import {
  buildMonthlyRidershipMailDocument,
  DEFAULT_MONTHLY_RIDERSHIP_TEMPLATE_VERSION,
  monthlyRidershipTemplateConfigPath,
  parseMonthlyRidershipTemplateVersion,
  extractPriorYearFixedDailyTotals,
  monthlyRidershipDocumentPaths,
  monthlyServiceHoursPath,
  parseMonthlyServiceHours,
  queueMonthlyRidershipMail,
  sendMonthlyRidershipReport,
} from '../functions/src/monthlyRidershipReport';

const modelInput = {
  baseline: RIDERSHIP_TREND_BASELINE,
  reportMonth: '2026-08',
  generatedAt: '2026-09-01T14:00:00.000Z',
};
const model = buildMonthlyRidershipReportModel(modelInput);
const PNG = Buffer.from([137, 80, 78, 71]);

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

  it('reads official service hours from a validated monthly document', () => {
    expect(monthlyServiceHoursPath('team-1', '2026-09')).toBe('teams/team-1/monthlyServiceHours/2026-09');
    expect(() => monthlyServiceHoursPath('team-1', '2026-13')).toThrow('Report month must use YYYY-MM format.');
    expect(parseMonthlyServiceHours({
      conventional: 15_800,
      onDemand: 0,
      specialized: '2350',
      updatedBy: 'user-1',
    })).toEqual({ conventional: 15_800 });
  });

  it('keeps the scheduled send on template 1 unless template 2 is switched on', () => {
    expect(DEFAULT_MONTHLY_RIDERSHIP_TEMPLATE_VERSION).toBe(1);
    expect(monthlyRidershipTemplateConfigPath('team-1')).toBe('teams/team-1/monthlyRidershipReportConfig/active');
    expect(parseMonthlyRidershipTemplateVersion(2)).toBe(2);
    expect(parseMonthlyRidershipTemplateVersion('1')).toBe(1);
    expect(parseMonthlyRidershipTemplateVersion(3)).toBeNull();
    expect(parseMonthlyRidershipTemplateVersion(undefined)).toBeNull();
  });

  it('builds the original template 1 email with its single chart', () => {
    const mailDocument = buildMonthlyRidershipMailDocument({
      recipients: ['manager@example.com'],
      reportMonth: '2026-08',
      report: {
        templateVersion: 1,
        model: buildMonthlyRidershipReportModelV1(modelInput),
        charts: [{ cid: 'monthly-ridership-chart', filename: 'barrie-transit-monthly-ridership-2026-08.png', png: PNG }],
      },
      logoPng: PNG,
    });

    expect(mailDocument.message.html).toContain('Five-Year View');
    expect(mailDocument.message.html).toContain('src="cid:monthly-ridership-chart"');
    expect(mailDocument.message.html).not.toContain('Ridership by Service');
    expect(mailDocument.message.attachments.map(attachment => attachment.cid)).toEqual([
      'monthly-ridership-chart',
      'barrie-transit-logo',
    ]);
  });

  it('queues the audit and mail atomically once', async () => {
    const { db, documents } = fakeFirestore();
    const report = {
      templateVersion: 2 as const,
      model,
      charts: [
        { cid: 'monthly-ridership-change-chart', filename: 'change.png', png: PNG },
        { cid: 'monthly-ridership-trend-chart', filename: 'trend.png', png: PNG },
      ],
    };
    const mailDocument = buildMonthlyRidershipMailDocument({
      recipients: ['manager@example.com'],
      reportMonth: '2026-08',
      report,
      logoPng: PNG,
    });
    const input = {
      db,
      teamId: 'team-1',
      reportMonth: '2026-08',
      recipients: ['manager@example.com'],
      report,
      mailDocument,
    };

    await expect(queueMonthlyRidershipMail(input)).resolves.toBe(true);
    await expect(queueMonthlyRidershipMail(input)).resolves.toBe(false);
    expect(documents.get('teams/team-1/monthlyRidershipReports/2026-08')).toMatchObject({ templateVersion: 2 });
    expect(documents.has('mail/monthly-ridership-team-1-2026-08')).toBe(true);
    expect(mailDocument.message.attachments.map(attachment => attachment.cid)).toEqual([
      'monthly-ridership-change-chart',
      'monthly-ridership-trend-chart',
      'barrie-transit-logo',
    ]);
    expect(mailDocument.message.attachments[0]).toMatchObject({
      encoding: 'base64',
      contentDisposition: 'inline',
    });
    expect(mailDocument.message.html).toContain('src="cid:barrie-transit-logo"');
    expect(mailDocument.message.html).toContain('src="cid:monthly-ridership-change-chart"');
    expect(mailDocument.message.html).not.toContain('cid:monthly-ridership-sparkline-');
    expect(mailDocument.message.attachments[2]).toMatchObject({
      filename: 'barrie-transit-logo.png',
      encoding: 'base64',
      cid: 'barrie-transit-logo',
      contentDisposition: 'inline',
    });
  }, 30_000);
});
