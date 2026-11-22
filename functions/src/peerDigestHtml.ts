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

/** City of Barrie brand: dark blue #1F4E79 and tints of it, Arial. */
const BRAND = '#1F4E79';
const BRAND_DARK = '#163A5C';
const BRAND_TINT = '#E8F0F7';
const BRAND_LINE = '#C9DAEA';
const BRAND_SOFT = '#9EC0DF';
const FONT = 'Arial,Helvetica,sans-serif';
const INK = '#1F2937';
const MUTED = '#5F6B7A';
const IMPORTANCE_ACCENT = { high: BRAND, medium: '#8FB0CF', low: '#D5DEE8' } as const;
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
        ? `<a href="${href}" style="color:${BRAND};font-weight:bold;text-decoration:underline;">${esc(sourceLabel(url))}</a>`
        : '';
    })
    .filter(Boolean)
    .join(`<span style="color:${BRAND_LINE};"> &nbsp;|&nbsp; </span>`);
}

function pill(text: string, bg: string, fg: string, border: string): string {
  return `<span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${border};border-radius:3px;padding:1px 7px;font-size:10px;font-weight:bold;letter-spacing:0.4px;text-transform:uppercase;">${text}</span>`;
}

function categoryPill(category: PeerDigestCategory): string {
  return pill(esc(PEER_DIGEST_CATEGORY_LABEL[category]), BRAND_TINT, BRAND, BRAND_LINE);
}

function itemRow(item: PeerDigestItem): string {
  const accent = IMPORTANCE_ACCENT[item.importance];
  const date = shortDate(item.date);
  const priority = item.importance === 'high' ? ` ${pill('Priority', BRAND, '#ffffff', BRAND)}` : '';
  return `
      <tr>
        <td style="padding:0 0 10px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND_LINE};border-left:5px solid ${accent};background:#ffffff;">
            <tr>
              <td style="padding:12px 14px;font-family:${FONT};">
                <div style="font-size:11px;color:${MUTED};margin-bottom:6px;">
                  ${categoryPill(item.category)}${priority}
                  <span style="margin-left:6px;color:${BRAND};font-weight:bold;">${esc(item.agency)}</span>${date ? `<span style="color:${MUTED};"> &middot; ${date}</span>` : ''}
                </div>
                <div style="font-size:15px;font-weight:bold;color:${INK};line-height:1.35;">${esc(item.title)}</div>
                <div style="font-size:13px;color:${INK};line-height:1.55;margin-top:5px;">${esc(item.summary)}</div>
                ${item.barrieRelevance ? `
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:9px;">
                  <tr>
                    <td style="background:${BRAND_TINT};border-left:3px solid ${BRAND};padding:7px 10px;font-family:${FONT};font-size:12px;color:${BRAND_DARK};line-height:1.5;">
                      <b style="color:${BRAND};">For Barrie:</b> ${esc(item.barrieRelevance)}
                    </td>
                  </tr>
                </table>` : ''}
                <div style="font-size:12px;margin-top:8px;color:${MUTED};">Sources: ${sourceLinks(item.sourceUrls)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

function headlineBox(headline: string[]): string {
  if (headline.length === 0) return '';
  const bullets = headline
    .map(line => `<tr><td style="vertical-align:top;padding:3px 8px 3px 0;color:${BRAND_SOFT};font-family:${FONT};font-size:12px;">&#9632;</td><td style="padding:3px 0;font-family:${FONT};font-size:14px;color:#ffffff;line-height:1.5;">${esc(line)}</td></tr>`)
    .join('');
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;background:${BRAND};">
      <tr><td style="padding:12px 16px;font-family:${FONT};">
        <div style="font-size:11px;font-weight:bold;color:${BRAND_SOFT};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">This week</div>
        <table cellpadding="0" cellspacing="0">${bullets}</table>
      </td></tr>
    </table>`;
}

function upcomingTable(doc: PeerDigestDoc): string {
  const upcoming = doc.content?.upcoming ?? [];
  if (upcoming.length === 0) return '';
  const rows = upcoming.map(event => {
    const href = safeHref(event.sourceUrl);
    const cell = `border-top:1px solid ${BRAND_TINT};padding:7px 10px;font-family:${FONT};font-size:12px;vertical-align:top;`;
    return `<tr>
        <td style="${cell}font-weight:bold;color:${BRAND};white-space:nowrap;">${shortDate(event.date)}</td>
        <td style="${cell}font-weight:bold;color:${INK};">${esc(event.agency)}</td>
        <td style="${cell}color:${INK};line-height:1.45;">${esc(event.what)}${href ? ` <a href="${href}" style="color:${BRAND};font-weight:bold;">source</a>` : ''}</td>
      </tr>`;
  }).join('');
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND_LINE};background:#ffffff;margin:4px 0 10px;">
      <tr><td colspan="3" style="background:${BRAND_TINT};padding:6px 10px;font-family:${FONT};font-size:11px;font-weight:bold;color:${BRAND};text-transform:uppercase;letter-spacing:0.8px;">Coming up</td></tr>
      ${rows}
    </table>`;
}

/** The section that goes in the Monday daily report. Empty string when there is nothing to show. */
export function buildPeerDigestSection(doc: PeerDigestDoc | null | undefined): string {
  if (!doc || doc.status !== 'ready' || !doc.content) return '';
  const { content } = doc;
  const checked = doc.agencies.filter(agency => agency.ok).length;
  const subtitle = `News from ${shortDate(doc.coverageStart)} to ${shortDate(doc.coverageEnd)} · ${checked} agencies and funding sources checked`;

  const body = content.items.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0">${content.items.map(itemRow).join('')}</table>`
    : `<div style="font-size:13px;color:${MUTED};padding:10px 0;">A quiet week: no peer news relevant to Barrie.</div>`;

  const quiet = content.quietAgencies.length
    ? `<div style="font-size:11px;color:${MUTED};margin-top:4px;line-height:1.5;"><b style="color:${BRAND};">Nothing new:</b> ${esc(content.quietAgencies.join(', '))}.</div>`
    : '';

  return `
    <div style="font-family:${FONT};">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 12px;border-bottom:3px solid ${BRAND};">
        <tr><td style="padding:0 0 6px;font-family:${FONT};">
          <div style="font-size:19px;font-weight:bold;color:${BRAND};">Peer Agency Watch</div>
          <div style="font-size:11px;color:${MUTED};margin-top:2px;">${esc(subtitle)}</div>
        </td></tr>
      </table>
      ${headlineBox(content.headline)}
      ${body}
      ${upcomingTable(doc)}
      ${quiet}
      <div style="font-size:11px;color:${MUTED};margin-top:6px;line-height:1.5;">Researched and summarized by Claude (Anthropic) from public websites and local news. Open the source before quoting a figure.</div>
    </div>`;
}

/** Stand-alone draft email for tuning: the section plus a run summary for the Barrie team. */
export function buildPeerDigestDraftHtml(doc: PeerDigestDoc): string {
  const failed = doc.agencies.filter(agency => !agency.ok);
  const section = buildPeerDigestSection(doc)
    || `<div style="font-family:${FONT};font-size:14px;color:#991b1b;padding:16px 0;">The digest did not build: ${esc(doc.error ?? 'unknown error')}</div>`;
  const runRows = [
    ['Week of', doc.weekOf],
    ['Agencies', `${doc.agencies.length - failed.length} researched${failed.length ? `, ${failed.length} failed (${failed.map(agency => `${agency.name}: ${agency.error ?? 'error'}`).join('; ')})` : ''}`],
    ['Items dropped by checks', String(doc.droppedItems)],
    ['Searches / fetches', `${doc.usage.webSearches} / ${doc.usage.webFetches}`],
    ['Tokens in / out', `${doc.usage.inputTokens.toLocaleString('en-CA')} / ${doc.usage.outputTokens.toLocaleString('en-CA')}`],
    ['Estimated cost', `US$${doc.usage.estimatedCostUsd.toFixed(2)}`],
    ['Run time', `${Math.round(doc.durationSeconds / 60)} min`],
  ].map(([label, value]) => `<tr><td style="padding:3px 12px 3px 0;font-family:${FONT};font-size:11px;color:${MUTED};white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:3px 0;font-family:${FONT};font-size:11px;color:${INK};">${esc(value)}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EEF2F6;font-family:${FONT};">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND};border-bottom:4px solid ${BRAND_DARK};">
      <tr><td style="padding:16px 20px;font-family:${FONT};">
        <div style="font-size:20px;font-weight:bold;color:#ffffff;">Peer Agency Watch <span style="font-size:11px;background:#F2C14E;color:${BRAND_DARK};border-radius:3px;padding:2px 7px;vertical-align:middle;letter-spacing:0.5px;">DRAFT</span></div>
        <div style="font-size:13px;color:${BRAND_LINE};margin-top:3px;">Barrie Transit &middot; for the Monday ${esc(doc.weekOf)} report &middot; not sent to management</div>
      </td></tr>
    </table>
    <div style="padding:0 18px 18px;">
      ${section}
      <div style="margin-top:18px;border-top:1px dashed ${BRAND_LINE};padding-top:10px;">
        <div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${BRAND};margin-bottom:4px;">Run details (draft only)</div>
        <table cellpadding="0" cellspacing="0">${runRows}</table>
      </div>
    </div>
  </div>
</body>
</html>`;
}
