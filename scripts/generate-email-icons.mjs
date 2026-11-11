// Renders the daily email's flat illustrated icons to PNG and writes them as base64 into
// functions/src/emailIconData.ts. The email embeds them as inline (cid) attachments.
// Design reference: explainers/email-icon-custom.html (style 2, "Flat spot illustration").
// Run: node scripts/generate-email-icons.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// One palette per accent colour the email can use. `accent` is the shared second colour.
const PALETTES = {
  '#ffffff': { light: '#93c5fd', mid: '#3b82f6', dark: '#1d4ed8', deep: '#1e3a8a', tint: '#dbeafe', accent: '#fbbf24' },
  '#2563eb': { light: '#93c5fd', mid: '#3b82f6', dark: '#1d4ed8', deep: '#1e3a8a', tint: '#dbeafe', accent: '#fbbf24' },
  '#16a34a': { light: '#86efac', mid: '#22c55e', dark: '#15803d', deep: '#14532d', tint: '#dcfce7', accent: '#fbbf24' },
  '#6d28d9': { light: '#c4b5fd', mid: '#8b5cf6', dark: '#6d28d9', deep: '#4c1d95', tint: '#ede9fe', accent: '#fbbf24' },
  '#0891b2': { light: '#67e8f9', mid: '#06b6d4', dark: '#0e7490', deep: '#164e63', tint: '#cffafe', accent: '#fbbf24' },
  '#d97706': { light: '#fcd34d', mid: '#f59e0b', dark: '#d97706', deep: '#92400e', tint: '#fef3c7', accent: '#fde047' },
  '#dc2626': { light: '#fca5a5', mid: '#ef4444', dark: '#dc2626', deep: '#991b1b', tint: '#fee2e2', accent: '#fbbf24' },
};

// 64 x 64 drawings. Each sits on a tinted backdrop circle.
const DRAW = {
  bus: P => `
    <rect x="7" y="18" width="5" height="10" rx="2.5" fill="${P.deep}"/>
    <rect x="52" y="18" width="5" height="10" rx="2.5" fill="${P.deep}"/>
    <rect x="16" y="47" width="9" height="11" rx="3" fill="#1e293b"/>
    <rect x="39" y="47" width="9" height="11" rx="3" fill="#1e293b"/>
    <rect x="11" y="5" width="42" height="47" rx="10" fill="${P.mid}"/>
    <rect x="19" y="8.5" width="26" height="6" rx="3" fill="${P.accent}"/>
    <rect x="15" y="18" width="34" height="17" rx="4.5" fill="#bae6fd"/>
    <rect x="14" y="40" width="36" height="8" rx="4" fill="${P.deep}" opacity=".28"/>
    <circle cx="20" cy="44" r="3" fill="#fef9c3"/><circle cx="44" cy="44" r="3" fill="#fef9c3"/>
    <rect x="27" y="43" width="10" height="2" rx="1" fill="#fff" opacity=".65"/>`,
  performance: P => `
    <path d="M19 50l-4.5 6.5M45 50l4.5 6.5" stroke="${P.deep}" stroke-width="4"/>
    <circle cx="14.5" cy="13" r="7.5" fill="${P.accent}"/><circle cx="49.5" cy="13" r="7.5" fill="${P.accent}"/>
    <path d="M27 9.5h10" stroke="${P.deep}" stroke-width="3.5"/>
    <circle cx="32" cy="33" r="23" fill="${P.mid}"/>
    <circle cx="32" cy="33" r="18" fill="#fff"/>
    <g fill="${P.mid}" opacity=".55"><rect x="31" y="17.5" width="2" height="4" rx="1"/><rect x="31" y="44.5" width="2" height="4" rx="1"/><rect x="44.5" y="32" width="4" height="2" rx="1"/><rect x="15.5" y="32" width="4" height="2" rx="1"/></g>
    <path d="M32 33V22.5M32 33l7.5 4.5" stroke="${P.deep}" stroke-width="3.2"/>
    <circle cx="32" cy="33" r="2.6" fill="${P.deep}"/>
    <circle cx="49" cy="49" r="10.5" fill="#fff"/><circle cx="49" cy="49" r="8.2" fill="${P.mid}"/>
    <path d="M45 49.2l2.8 2.8 5.4-5.6" stroke="#fff" stroke-width="2.7"/>`,
  ridership: P => `
    <circle cx="43" cy="18.5" r="7.5" fill="${P.light}"/>
    <path d="M28 51c0-9.5 6.5-15.5 15-15.5S58 41.5 58 51v1.5a2.5 2.5 0 0 1-2.5 2.5h-25A2.5 2.5 0 0 1 28 52.5z" fill="${P.light}"/>
    <circle cx="25" cy="21" r="9.5" fill="${P.mid}" stroke="#fff" stroke-width="2.5"/>
    <path d="M6 54c0-12 8.5-19.5 19-19.5S44 42 44 54v1a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="${P.mid}" stroke="#fff" stroke-width="2.5"/>`,
  trips: P => `
    <path d="M10 51C15 37 29 47 33 37S43 27 49 27" stroke="${P.mid}" stroke-width="9.5"/>
    <path d="M10 51C15 37 29 47 33 37S43 27 49 27" stroke="#fff" stroke-width="1.9" stroke-dasharray="3 4.2" opacity=".9"/>
    <circle cx="10" cy="51" r="5.5" fill="#fff" stroke="${P.dark}" stroke-width="3.2"/>
    <path d="M50 31s-11-9-11-16.8a11 11 0 0 1 22 0C61 22 50 31 50 31z" fill="${P.accent}"/>
    <circle cx="50" cy="14.5" r="4.2" fill="#fff"/>`,
  dwell: P => `
    <rect x="29" y="9" width="6" height="6" fill="${P.deep}"/>
    <rect x="25" y="3" width="14" height="7" rx="3" fill="${P.accent}"/>
    <rect x="46" y="12" width="7" height="6" rx="2" fill="${P.deep}" transform="rotate(45 49.5 15)"/>
    <circle cx="32" cy="36" r="22" fill="${P.mid}"/>
    <circle cx="32" cy="36" r="17" fill="#fff"/>
    <path d="M32 36V19a17 17 0 0 1 16.17 11.75z" fill="${P.light}" opacity=".75"/>
    <g fill="${P.mid}" opacity=".55"><circle cx="45.5" cy="36" r="1.4"/><circle cx="32" cy="49.5" r="1.4"/><circle cx="18.5" cy="36" r="1.4"/></g>
    <path d="M32 36l12-3.9" stroke="${P.deep}" stroke-width="3.2"/>
    <circle cx="32" cy="36" r="2.6" fill="${P.deep}"/>`,
};

// Every colour each icon can take in the email. Card colours follow the KPI accent.
// Box sizes must match iconBadge() calls in functions/src/reportHtml.ts.
const VARIANTS = [
  { name: 'bus', color: '#ffffff', box: 44, tile: true },
  ...['#16a34a', '#d97706', '#dc2626'].map(color => ({ name: 'performance', color, box: 48 })),
  { name: 'ridership', color: '#2563eb', box: 48 },
  ...['#6d28d9', '#dc2626'].map(color => ({ name: 'trips', color, box: 48 })),
  ...['#0891b2', '#d97706'].map(color => ({ name: 'dwell', color, box: 48 })),
];

function iconHtml({ name, color, box, tile }) {
  const P = PALETTES[color];
  const art = `<svg viewBox="0 0 64 64" width="${tile ? box - 8 : box}" height="${tile ? box - 8 : box}" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="32" cy="33" r="29" fill="${P.tint}"/>${DRAW[name](P)}</svg>`;
  // The header bus sits on a white tile so it reads on the navy header and in dark mode.
  return `<span id="icon" style="display:inline-flex;align-items:center;justify-content:center;width:${box}px;height:${box}px;${tile ? 'background:#fff;border-radius:11px;' : ''}">${art}</span>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 3 });
const entries = [];
for (const variant of VARIANTS) {
  await page.setContent(`<body style="margin:0;background:transparent">${iconHtml(variant)}</body>`);
  const png = await page.locator('#icon').screenshot({ omitBackground: true });
  entries.push(`  '${variant.name}-${variant.color.slice(1)}': '${png.toString('base64')}',`);
}
await browser.close();

const out = fileURLToPath(new URL('../functions/src/emailIconData.ts', import.meta.url));
writeFileSync(out, `// Generated by scripts/generate-email-icons.mjs. Do not edit by hand.
// Key: <icon>-<hex colour>. Value: base64 PNG of the icon at 3x.
export const EMAIL_ICON_PNG: Record<string, string> = {
${entries.join('\n')}
};
`);
console.log(`Wrote ${entries.length} icons to ${out}`);
