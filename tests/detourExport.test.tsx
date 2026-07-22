import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DetourNoticePreview } from '../components/detours/DetourNoticePreview';
import {
  buildMyRideCopyPackage,
  formatDetourEffectiveSchedule,
  type DetourExportNoticeInput,
} from '../utils/detours/detourCopy';
import { createDetourPdf, DetourExportError } from '../utils/detours/detourExport';
import { buildDetourFilename, toDetourFilenameSlug } from '../utils/detours/detourFilename';

const notice: DetourExportNoticeInput = {
  noticeType: 'route-detour',
  title: 'Livingstone Avenue Detour',
  publicSummary: 'Routes 8A and 100 will use a temporary routing.',
  publicDetails: 'Stops on Livingstone Avenue will be closed. Use the temporary stops shown on the map.',
  effectiveSchedule: {
    startDate: '2026-07-18',
    startTime: '08:00',
    endMode: 'date',
    endDate: '2026-08-01',
    endTime: '17:00',
    recurrence: { days: ['saturday', 'sunday'], startTime: '08:00', endTime: '17:00' },
    timezone: 'America/Toronto',
  },
  routes: [
    { routeShortName: '8A', directionLabel: 'Downtown' },
    { routeShortName: '100', directionLabel: 'Clockwise' },
  ],
  revision: 2,
  stopCounts: { closed: 3, temporary: 2 },
};

describe('detour filenames', () => {
  it('creates URL-safe, versioned filenames', () => {
    expect(toDetourFilenameSlug('Route 8A & 8B — Bayfield / Livingstone')).toBe('route-8a-and-8b-bayfield-livingstone');
    expect(buildDetourFilename({ title: notice.title, revision: 2, startDate: '2026-07-18', extension: 'pdf' }))
      .toBe('2026-07-18-livingstone-avenue-detour-v2.pdf');
  });
});

describe('detour public copy', () => {
  it('formats weekly recurrence and finite dates', () => {
    expect(formatDetourEffectiveSchedule(notice.effectiveSchedule)).toBe(
      'July 18, 2026 at 8:00 a.m. to August 1, 2026 at 5:00 p.m.; applies Saturday and Sunday, 8:00 a.m. to 5:00 p.m.',
    );
  });

  it('formats blank effective times as date-only copy', () => {
    expect(formatDetourEffectiveSchedule({
      ...notice.effectiveSchedule,
      startTime: '',
      endTime: '',
      recurrence: { days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], startTime: '', endTime: '' },
    })).toBe('July 18, 2026 to August 1, 2026; applies Monday to Friday');
  });

  it('supports open-ended notices and builds accessible MyRide copy', () => {
    const copy = buildMyRideCopyPackage({
      ...notice,
      title: '<b>Bayfield detour</b>',
      effectiveSchedule: { ...notice.effectiveSchedule, endMode: 'until-further-notice' },
    });
    expect(copy.title).toBe('Bayfield detour');
    expect(copy.routeTags).toEqual(['Route 8A', 'Route 100']);
    expect(copy.accessibleDetails).toContain('until further notice');
    expect(copy.altText).toContain('3 closed stops and 2 temporary stops');
    expect(copy.title).not.toContain('<');
  });

  it('generates MyRide summary copy when no custom summary exists', () => {
    const copy = buildMyRideCopyPackage({ ...notice, publicSummary: '' });
    expect(copy.summary).toContain('is operating on a temporary detour');
    expect(copy.summary).toContain('July 18, 2026');
    expect(copy.summary).not.toContain('p.m..');
  });
});

describe('detour PDF and preview', () => {
  it('creates one landscape letter page with expected vector text', () => {
    // Valid one-pixel PNG; the map itself stays the only raster layer in the PDF.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const doc = createDetourPdf({ notice, mapImageDataUrl: png });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(792, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(612, 0);
    const commands = ((doc.internal as unknown as { pages: string[][] }).pages[1] ?? []).join('\n');
    expect(commands).toContain('BARRIE TRANSIT');
    expect(commands).toContain('Livingstone Avenue Detour');
    expect(commands).not.toContain('Routes not shown are on regular routing.');
    expect(commands).toContain('MAP LEGEND');
    expect(commands).toContain('Service Barrie 705-726-4242');
    expect(commands).toContain('servicebarrie@barrie.ca');
    expect(commands).toContain('barrie.ca/TransitNotices');
  });

  it('rejects missing or malformed map captures with a typed error', () => {
    expect(() => createDetourPdf({ notice, mapImageDataUrl: 'https://example.com/map.png' }))
      .toThrowError(DetourExportError);
  });

  it('renders planner copy as escaped text in the preview', () => {
    const html = renderToStaticMarkup(
      <DetourNoticePreview notice={{ ...notice, publicDetails: '<script>alert(1)</script>' }} />,
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Active Stops');
    expect(html).toContain('Active Routing');
    expect(html).toContain('Out of Service Routing');
    expect(html).toContain('Out-of-Service Stops');
    expect(html).toContain('Temporary Stops');
    expect(html.match(/data-legend-item="true"/g)).toHaveLength(5);
    expect(html.match(/flex min-w-0 flex-col items-center gap-2 text-center/g)).toHaveLength(5);
    expect(html).toContain('Effective Date');
    expect(html).not.toContain('Routes not shown are on regular routing.');
    expect(html).toContain('For More Information Contact');
    expect(html).toContain('data-contact-icon="phone"');
    expect(html).toContain('data-contact-icon="email"');
    expect(html).toContain('data-contact-icon="website"');
    expect(html).toContain('data-warning-icon="true"');
    expect(html).toContain('h-[82px] w-[82px]');
  });

  it('keeps a date-only effective range on one line in previews and PDFs', () => {
    const dateOnlyNotice: DetourExportNoticeInput = {
      ...notice,
      effectiveSchedule: {
        ...notice.effectiveSchedule,
        startDate: '2026-07-22',
        startTime: '',
        endDate: '2026-07-30',
        endTime: '',
        recurrence: undefined,
      },
    };
    const html = renderToStaticMarkup(<DetourNoticePreview notice={dateOnlyNotice} />);
    expect(html).toContain('data-effective-date-nowrap="true"');
    expect(html).toContain('whitespace-nowrap');
    expect(html).toContain('July 22, 2026 to July 30, 2026');

    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const doc = createDetourPdf({ notice: dateOnlyNotice, mapImageDataUrl: png });
    const commands = ((doc.internal as unknown as { pages: string[][] }).pages[1] ?? []).join('\n');
    expect(commands).toContain('July 22, 2026 to July 30, 2026');
  });

  it('renders the supplied transit logo in branded previews and PDFs', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const html = renderToStaticMarkup(
      <DetourNoticePreview notice={notice} brandAssets={{ transitLogoDataUrl: png }} />,
    );
    expect(html).toContain('alt="Barrie Transit"');
    expect(html).toContain(png);

    const doc = createDetourPdf({ notice, mapImageDataUrl: png, brandAssets: { transitLogoDataUrl: png } });
    const commands = ((doc.internal as unknown as { pages: string[][] }).pages[1] ?? []).join('\n');
    expect(commands).not.toContain('BARRIE TRANSIT');
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
