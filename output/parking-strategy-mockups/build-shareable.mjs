import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const mockupDirectory = path.dirname(fileURLToPath(import.meta.url));
const destination = process.argv[2];

if (!destination) {
  throw new Error('Provide the destination path for the self-contained HTML file.');
}

const [sourceHtml, sharedCss, sharedData] = await Promise.all([
  readFile(path.join(mockupDirectory, '01-executive-evidence-board.html'), 'utf8'),
  readFile(path.join(mockupDirectory, 'shared.css'), 'utf8'),
  readFile(path.join(mockupDirectory, 'shared-data.js'), 'utf8'),
]);

const bundledHtml = sourceHtml
  .replace('<link rel="stylesheet" href="shared.css">', `<style>\n${sharedCss}\n</style>`)
  .replace('<script src="shared-data.js"></script>', `<script>\n${sharedData}\n</script>`)
  .replace('<body>', '<body id="top">')
  .replaceAll('href="index.html"', 'href="#top"')
  .replace('← Back to concepts', 'Parking Strategy · Shared briefing');

if (bundledHtml.includes('shared.css') || bundledHtml.includes('shared-data.js')) {
  throw new Error('The self-contained HTML still has a local shared-file dependency.');
}

await writeFile(destination, bundledHtml, 'utf8');

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`page: ${error.message}`));
  await page.goto(pathToFileURL(destination).href);
  await page.locator('.executive-marker[data-location-id="2"]').click();
  if (await page.locator('#mapSelectedName').textContent() !== 'SOUTHSHORE 1') {
    errors.push('interaction: bundled location map selection failed');
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
    errors.push('layout: bundled page overflows at 390 px');
  }
  await page.close();
} finally {
  await browser.close();
}

if (errors.length > 0) {
  throw new Error(`Self-contained HTML verification failed: ${JSON.stringify(errors)}`);
}

console.log(JSON.stringify({ destination, selfContained: true, browserErrors: errors, locationMapInteraction: true, mobileHorizontalOverflow: false }, null, 2));
