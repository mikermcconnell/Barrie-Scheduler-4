import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = 4900 + Math.floor(Math.random() * 300);
const baseUrl = `http://${host}:${port}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activate = (locator) => locator.evaluate((element) => element.click());

async function waitForServer(child) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (child.exitCode != null) throw new Error(`Vite exited with ${child.exitCode}`);
        try { if ((await fetch(baseUrl)).ok) return; } catch { /* retry */ }
        await sleep(500);
    }
    throw new Error('Timed out waiting for Vite.');
}

function stop(child) {
    if (!child || child.killed) return;
    if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); return; } catch { /* best effort */ }
    }
    child.kill('SIGTERM');
}

const server = spawn(`npm run dev -- --host ${host} --port ${port} --strictPort`, { shell: true, windowsHide: true, stdio: 'ignore' });
let browser;

try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`${baseUrl}/tests/browser/routeConceptPlannerHarness.html`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('heading', { name: 'Route Concept Planner' }).waitFor();
    await page.getByRole('button', { name: /Import GTFS route/i }).click();
    await page.getByRole('heading', { name: 'Import complete GTFS route' }).waitFor();
    await page.getByRole('button', { name: 'Select route' }).click();
    await page.getByRole('button', { name: /Import 2 selected patterns/i }).click();

    await page.getByText('Route 400 — Weekday', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Duplicate alternative' }).click();
    await page.getByText('Keyboard route editor', { exact: true }).click();
    await page.getByRole('spinbutton', { name: /Runtime override for RVH to Park Place/i }).fill('14');
    await page.getByText('Unsaved changes', { exact: true }).waitFor();
    // Programmatic activation avoids Playwright waiting on the continuously
    // updating map canvas after the comparison overlay replaces its hit area.
    await activate(page.getByRole('button', { name: /Compare 2/i }));
    await page.getByRole('dialog', { name: 'Compare alternatives' }).waitFor();
    await activate(page.getByRole('button', { name: 'Close' }));

    await activate(page.getByRole('button', { name: 'Mark preferred' }));
    await page.getByLabel('Project name').fill('Route 400 concept test');
    await activate(page.getByRole('button', { name: /^Save$/ }));
    await page.getByText(/Saved · revision 1/).waitFor();

    await activate(page.getByText('Simulate external save'));
    await page.getByText('External saves simulated: 1').waitFor();
    await page.getByLabel('Project name').fill('Route 400 concept conflict');
    await activate(page.getByRole('button', { name: /^Save$/ }));
    await page.getByRole('dialog', { name: 'A newer team version exists' }).waitFor();
    const conflictDialog = page.getByRole('dialog', { name: 'A newer team version exists' });
    await activate(page.getByRole('button', { name: 'Save local work as a new copy' }));
    await conflictDialog.waitFor({ state: 'hidden' });
    await page.getByText(/Saved · revision 1/).waitFor();

    await activate(page.getByRole('tab', { name: /^review$/i }));
    await page.getByText('Daily planning estimates').waitFor();
    await page.getByText('Runtime source mix').waitFor();

    await activate(page.getByRole('button', { name: /^Load$/ }));
    const loadDialog = page.getByRole('dialog', { name: 'Team projects' });
    await loadDialog.waitFor();
    await activate(loadDialog.getByRole('button', { name: /Route 400 concept conflict copy/i }));
    await loadDialog.waitFor({ state: 'hidden' });
    await page.getByLabel('Project name').fill('Local name that should be discarded');
    await activate(page.getByText('Simulate external save'));
    await page.getByText('External saves simulated: 2').waitFor();
    await activate(page.getByRole('button', { name: /^Save$/ }));
    const reloadConflict = page.getByRole('dialog', { name: 'A newer team version exists' });
    await reloadConflict.waitFor();
    page.once('dialog', (dialog) => dialog.accept());
    await activate(reloadConflict.getByRole('button', { name: 'Reload team version' }));
    await reloadConflict.waitFor({ state: 'hidden' });
    assert.equal(await page.getByLabel('Project name').inputValue(), 'Route 400 concept conflict copy');

    assert.equal((await page.locator('body').innerText()).toLowerCase().includes('camper'), false);
    console.log('[route-concept-planner] Browser smoke passed.');
} finally {
    await browser?.close();
    stop(server);
}
