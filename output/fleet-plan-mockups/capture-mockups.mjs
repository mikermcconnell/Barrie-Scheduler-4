import { chromium } from 'playwright';
import path from 'node:path';
const outDir = process.cwd();
const htmlPath = path.join(outDir, 'fleet-plan-mockups.html');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
for (const [id, name] of [['mock1','fleet-plan-command-center.png'], ['mock2','fleet-plan-capital-board.png'], ['mock3','fleet-plan-data-ops-workbench.png']]) {
  await page.locator(`#${id}`).screenshot({ path: path.join(outDir, name) });
}
await browser.close();
