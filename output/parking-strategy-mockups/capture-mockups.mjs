import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outputDirectory = process.cwd();
const concepts = [
  ['01-executive-evidence-board.html', '01-executive-evidence-board.png'],
  ['02-strategy-analyst-workbench.html', '02-strategy-analyst-workbench.png'],
  ['03-spatial-portfolio.html', '03-spatial-portfolio.png'],
];

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const [htmlName, screenshotName] of concepts) {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    await page.goto(pathToFileURL(path.join(outputDirectory, htmlName)).href);
    await page.screenshot({ path: path.join(outputDirectory, screenshotName), fullPage: true });
    let interactionVerified = null;
    if (htmlName === '01-executive-evidence-board.html') {
      await page.locator('.executive-marker[data-location-id="2"]').click();
      const markerSelection = await page.locator('#mapSelectedName').textContent();
      await page.locator('.location-bar[data-location-id="3"]').click();
      const barSelection = await page.locator('#mapSelectedName').textContent();
      interactionVerified = markerSelection === 'SOUTHSHORE 1' && barSelection === 'LAKESHORE LOT';
      if (!interactionVerified) errors.push('interaction: location ranking and map selection did not stay synchronized');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    results.push({ htmlName, errors, mobileHorizontalOverflow: overflow, ...(interactionVerified === null ? {} : { locationMapInteraction: interactionVerified }) });
    await page.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter(result => result.errors.length > 0 || result.mobileHorizontalOverflow);
if (failures.length > 0) {
  throw new Error(`Mockup verification failed: ${JSON.stringify(failures)}`);
}

console.log(JSON.stringify(results, null, 2));
