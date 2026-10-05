import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:3008/tests/street-studio/harness.html');
  await page.getByRole('button', { name: 'Street map' }).click();
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Street', exact: true }).click();
  let snap;
  for (let y = 195; y <= 300 && !snap; y += 3) {
    await page.mouse.move(989, y);
    if (await page.getByLabel('Snapped to mapped road centreline').count()) {
      snap = await page.getByLabel('Snapped to mapped road centreline').boundingBox();
    }
  }
  if (!snap) { await page.screenshot({ path: 'docs/street-design-studio/studio-snap-debug.png', fullPage: true }); throw new Error(`No road snap found beside visible mapped road; ${errors.join('; ')}`); }
  const sx = snap.x + snap.width / 2, sy = snap.y + snap.height / 2;
  await page.mouse.click(989, sy + 5);
  const start = await page.getByLabel('Start of street alignment').boundingBox();
  if (!start || Math.abs(start.x + start.width / 2 - sx) > 16) throw new Error('Start marker did not land at snapped road position');
  let secondSnap;
  for (let y = sy + 35; y <= Math.min(sy + 90, 335) && !secondSnap; y += 4) {
    for (let x = 900; x <= 1020 && !secondSnap; x += 5) {
      await page.mouse.move(x, y);
      if (await page.getByLabel('Snapped to mapped road centreline').count()) secondSnap = await page.getByLabel('Snapped to mapped road centreline').boundingBox();
    }
  }
  if (!secondSnap) throw new Error('No snap found for second road point');
  await page.mouse.click(secondSnap.x + secondSnap.width / 2 + 5, secondSnap.y + secondSnap.height / 2 + 5);
  if (!(await page.getByLabel('End of street alignment').isVisible())) throw new Error('End marker is not visible');
  await page.getByRole('button', { name: /Finish \(2\)/ }).click();
  if (!(await page.getByRole('button', { name: /Finish \(2\)/ }).isVisible())) throw new Error('Rejected short alignment incorrectly discarded its draft');
  await page.mouse.move(989, sy, { steps: 2 });
  await page.keyboard.down('Shift');
  await page.mouse.move(990, sy + 1);
  if (await page.getByLabel('Snapped to mapped road centreline').count()) throw new Error('Shift did not disable snap preview');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Escape');
  await page.getByLabel('Concept envelope width in metres').fill('12');
  if (!(await page.getByText('Proposed 12.00 m envelope').isVisible())) throw new Error('Width preview missing');
  await page.getByRole('button', { name: 'Apply overall width' }).click();
  if (!(await page.getByText('12.00 m', { exact: false }).first().isVisible())) throw new Error('12 m width not shown');
  await page.getByRole('button', { name: 'Saved on this device' }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: 'docs/street-design-studio/studio-road-fixes.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Street map' }).click();
  await page.waitForTimeout(1200);
  if (!(await page.getByLabel('Start of street alignment').isVisible()) || !(await page.getByLabel('End of street alignment').isVisible())) throw new Error('Endpoint markers missing after reload');
  if (!(await page.getByText('12.00 m', { exact: false }).first().isVisible())) throw new Error('12 m width was not saved');
  await page.getByLabel('Name', { exact: true }).fill('Browser road snap concept');
  await page.getByLabel('Longitude').fill('-79.6931');
  await page.getByLabel('Latitude').fill('44.3362');
  await page.getByRole('button', { name: 'Create at location' }).click();
  await page.getByRole('button', { name: 'Street', exact: true }).click();
  let firstRoad;
  for (let y = 250; y < 540 && !firstRoad; y += 8) for (let x = 350; x < 780 && !firstRoad; x += 12) {
    await page.mouse.move(x, y);
    if (await page.getByLabel('Snapped to mapped road centreline').count()) firstRoad = { x, y, box: await page.getByLabel('Snapped to mapped road centreline').boundingBox() };
  }
  if (!firstRoad) throw new Error('No road centreline available near new project');
  await page.mouse.click(firstRoad.x, firstRoad.y);
  let lastRoad;
  for (let y = 190; y < 580 && !lastRoad; y += 12) for (let x = 290; x < 880 && !lastRoad; x += 14) {
    if (Math.hypot(x - firstRoad.x, y - firstRoad.y) < 95) continue;
    await page.mouse.move(x, y);
    if (await page.getByLabel('Snapped to mapped road centreline').count()) lastRoad = { x, y };
  }
  if (!lastRoad) throw new Error('No second road centreline point available');
  await page.mouse.click(lastRoad.x, lastRoad.y);
  await page.getByRole('button', { name: /Finish \(2\)/ }).click();
  if (await page.getByRole('button', { name: /Finish \(2\)/ }).count()) throw new Error(`New-project road trace was not committed: ${await page.locator('.sds-status').innerText()}`);
  await page.getByRole('button', { name: 'Saved on this device' }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: 'docs/street-design-studio/studio-snapped-new-project.png', fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ snapFound: true, startVisible: true, endVisible: true, widthMetres: 12, reload: true, errors }, null, 2));
} finally { await browser.close(); }
