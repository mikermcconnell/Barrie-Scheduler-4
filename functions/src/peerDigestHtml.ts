/**
 * Peer Agency Watch in email HTML. Tables and inline styles only (Outlook), every model-written
 * string escaped. `buildPeerDigestSection` goes inside the Monday daily report;
 * `buildPeerDigestDraftHtml` wraps the same section as a stand-alone draft for tuning.
 */
import {
  PEER_DIGEST_CATEGORY_LABEL,
  PeerDigestCategory,
  PeerDigestDoc,
  PeerDigestItem,
  sourceLabel,
} from './peerDigest';

const BRAND = '#1F4E79';
const IMPORTANCE_ACCENT = { high: '#b45309', medium: BRAND, low: '#94a3b8' } as const;
const CATEGORY_COLOR: Record<PeerDigestCategory, { bg: string; fg: string }> = {
  service: { bg: '#dbeafe', fg: '#1e40af' },
  fares: { bg: '#dcfce7', fg: '#166534' },
  'on-demand': { bg: '#f3e8ff', fg: '#6b21a8' },
  funding: { bg: '#fef3c7', fg: '#92400e' },
  procurement: { bg: '#e0e7ff', fg: '#3730a3' },
  technology: { bg: '#cffafe', fg: '#155e75' },
  fleet: { bg: '#d1fae5', fg: '#065f46' },
  council: { bg: '#fee2e2', fg: '#991b1b' },
  ridership: { bg: '#e0f2fe', fg: '#075985' },
  labour: { bg: '#ffe4e6', fg: '#9f1239' },
  other: { bg: '#f1f5f9', fg: '#334155' },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links reach an href. */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? esc(url) : null;
}

function shortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function sourceLinks(urls: string[]): string {
  return urls
    .map(url => {
      const href = safeHref(url);
      return href
        ? `<a href="${href}" style="color:${BRAND};font-weight:700;text-decoration:none;">${esc(sourceLabel(url))} &#8599;</a>`
        : '';
    })
    .filter(Boolean)
    .join('<span style="color:#cbd5e1;"> &nbsp;·&nbsp; </span>');
}

function categoryPill(category: PeerDigestCategory): string {
  const color = CATEGORY_COLOR[category];
  return `<span style="display:inline-block;background:${color.bg};color:${color.fg};border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;letter-spacing:0.3px;text-transform:uppercase;">${esc(PEER_DIGEST_CATEGORY_LABEL[category])}</span>`;
}

function itemRow(item: PeerDigestItem): string {
  const accent = IMPORTANCE_ACCENT[item.importance];
  const date = shortDate(item.date);
  return `
      <tr>
        <td style="padding:0 0 10px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-left:4px solid ${accent};border-radius:8px;background:#ffffff;">
            <tr>
              <td style="padding:12px 14px;">
                <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:5px;">
                  ${categoryPill(item.category)}
                  <span style="margin-left:6px;color:#0f172a;">${esc(item.agency)}</span>${date ? `<span style="color:#94a3b8;"> · ${date}</span>` : ''}${item.importance === 'high' ? `<span style="color:${accent};"> · Worth a look</span>` : ''}
                </div>
                <div style="font-size:15px;font-weight:800;color:#0f172a;line-height:1.35;">${esc(item.title)}</div>
                <div style="font-size:13px;color:#334155;line-height:1.55;margin-top:5px;">${esc(item.summary)}</div>
                ${item.barrieRelevance ? `
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                  <tr>
                    <td style="background:#eff6ff;border-radius:6px;padding:7px 10px;font-size:12px;color:#1e3a5f;line-height:1.5;">
                      <b style="color:${BRAND};">For Barrie:</b> ${esc(item.barrieRelevance)}
                    </td>
                  </tr>
                </table>` : ''}
                <div style="font-size:12px;margin-top:8px;">${sourceLinks(item.sourceUrls)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

function headlineBox(headline: string[]): string {
  if (headline.length === 0) return '';
  const bullets = headline
    .map(line => `<tr><td style="vertical-align:top;padding:3px 8px 3px 0;color:${BRAND};font-weight:900;">&#9679;</td><td style="padding:3px 0;font-size:14px;color:#0f172a;line-height:1.5;">${esc(line)}</td></tr>`)
    .join('');
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;background:#f0f6fc;border:1px solid #c7dbef;border-radius:10px;">
      <tr><td style="padding:12px 14px;">
        <div style="font-size:11px;font-weight:800;color:${BRAND};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">This week</div>
        <table cellpadding="0" cellspacing="0">${bullets}</table>
      </td></tr>
    </table>`;
}

function upcomingTable(doc: PeerDigestDoc): string {
  const upcoming = doc.content?.upcoming ?? [];
  if (upcoming.length === 0) return '';
  const rows = upcoming.map((event, index) => {
    const href = safeHref(event.sourceUrl);
    const border = index === 0 ? '' : 'border-top:1px solid #f1f5f9;';
    return `<tr>
        <td style="${border}padding:7px 10px;font-size:12px;font-weight:800;color:#0f172a;white-space:nowrap;vertical-align:top;">${shortDate(event.date)}</td>
        <td style="${border}padding:7px 10px;font-size:12px;color:#475569;font-weight:700;vertical-align:top;">${esc(event.agency)}</td>
        <td style="${border}padding:7px 10px;font-size:12px;color:#334155;line-height:1.45;vertical-align:top;">${esc(event.what)}${href ? ` <a href="${href}" style="color:${BRAND};text-decoration:none;font-weight:700;">&#8599;</a>` : ''}</td>
      </tr>`;
  }).join('');
  return `
    <div style="font-size:13px;font-weight:800;color:#374151;margin:6px 0 6px;">Coming up</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;margin-bottom:10px;">${rows}</table>`;
}

/** The section that goes in the Monday daily report. Empty string when there is nothing to show. */
export function buildPeerDigestSection(doc: PeerDigestDoc | null | undefined): string {
  if (!doc || doc.status !== 'ready' || !doc.content) return '';
  const { content } = doc;
  const checked = doc.agencies.filter(agency => agency.ok).length;
  const subtitle = `News from ${shortDate(doc.coverageStart)} to ${shortDate(doc.coverageEnd)} · ${checked} agencies and funding sources checked`;

  const body = content.items.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0">${content.items.map(itemRow).join('')}</table>`
    : `<div style="font-size:13px;color:#475569;padding:10px 0;">A quiet week: no peer news relevant to Barrie.</div>`;

  const quiet = content.quietAgencies.length
    ? `<div style="font-size:11px;color:#64748b;margin-top:4px;"><b style="color:#475569;">Nothing new:</b> ${esc(content.quietAgencies.join(', '))}.</div>`
    : '';

  return `
    <div style="margin:26px 0 10px;border-top:2px solid #e2e8f0;padding-top:18px;">
      <div style="font-size:18px;font-weight:800;color:#082b63;">Peer Agency Watch</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${esc(subtitle)}</div>
    </div>
    ${headlineBox(content.headline)}
    ${body}
    ${upcomingTable(doc)}
    ${quiet}
    <div style="font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.5;">Researched and summarized by Claude (Anthropic) from public websites and local news. Open the source before quoting a figure.</div>`;
}

/** Stand-alone draft email for tuning: the section plus a run summary for the Barrie team. */
export function buildPeerDigestDraftHtml(doc: PeerDigestDoc): string {
  const failed = doc.agencies.filter(agency => !agency.ok);
  const section = buildPeerDigestSection(doc)
    || `<div style="font-size:14px;color:#991b1b;padding:16px 0;">The digest did not build: ${esc(doc.error ?? 'unknown error')}</div>`;
  const runRows = [
    ['Week of', doc.weekOf],
    ['Agencies', `${doc.agencies.length - failed.length} researched${failed.length ? `, ${failed.length} failed (${failed.map(agency => `${agency.name}: ${agency.error ?? 'error'}`).join('; ')})` : ''}`],
    ['Items dropped by checks', String(doc.droppedItems)],
    ['Searches / fetches', `${doc.usage.webSearches} / ${doc.usage.webFetches}`],
    ['Tokens in / out', `${doc.usage.inputTokens.toLocaleString('en-CA')} / ${doc.usage.outputTokens.toLocaleString('en-CA')}`],
    ['Estimated cost', `US$${doc.usage.estimatedCostUsd.toFixed(2)}`],
    ['Run time', `${Math.round(doc.durationSeconds / 60)} min`],
  ].map(([label, value]) => `<tr><td style="padding:3px 12px 3px 0;font-size:11px;color:#64748b;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:3px 0;font-size:11px;color:#334155;">${esc(value)}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;">
    <div style="background:#082f69;padding:16px 20px;border-bottom:4px solid #f59e0b;">
      <div style="font-size:20px;font-weight:900;color:#ffffff;">Peer Agency Watch <span style="font-size:12px;background:#f59e0b;color:#111827;border-radius:4px;padding:2px 6px;vertical-align:middle;">DRAFT</span></div>
      <div style="font-size:13px;color:#93c5fd;font-weight:700;margin-top:3px;">For the Monday ${esc(doc.weekOf)} report · not sent to management</div>
    </div>
    <div style="padding:0 18px 18px;background:#f8fafc;">
      ${section}
      <div style="margin-top:18px;border-top:1px dashed #cbd5e1;padding-top:10px;">
        <div style="font-size:11px;font-weight:800;color:#475569;margin-bottom:4px;">Run details (draft only)</div>
        <table cellpadding="0" cellspacing="0">${runRows}</table>
      </div>
    </div>
  </div>
</body>
</html>`;
}
