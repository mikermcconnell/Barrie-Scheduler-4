/* global document, getComputedStyle, window */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4800 + Math.floor(Math.random() * 200);
const BASE_URL = `http://${HOST}:${PORT}`;
const HARNESS_URL = `${BASE_URL}/tests/browser/strategicWorkplanHarness.html`;

const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForServer(child) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
        if (child.exitCode !== null) throw new Error(`Vite exited with code ${child.exitCode}`);
        try {
            const response = await fetch(HARNESS_URL);
            if (response.ok) return;
        } catch {
            // Retry while Vite starts.
        }
        await sleep(400);
    }
    throw new Error('Timed out waiting for the Strategic Work Plan browser harness.');
}

function stopServer(child) {
    if (child.killed) return;
    if (process.platform === 'win32') {
        try {
            execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
            return;
        } catch {
            // Fall through to best-effort termination.
        }
    }
    child.kill('SIGTERM');
}

async function run() {
    const server = spawn(process.execPath, [
        'node_modules/vite/bin/vite.js',
        '--host', HOST,
        '--port', String(PORT),
        '--strictPort',
    ], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let browser;
    const browserErrors = [];

    try {
        await waitForServer(server);
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        page.on('pageerror', error => browserErrors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') browserErrors.push(message.text());
        });

        await page.goto(HARNESS_URL, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: '2027–2032 Strategic Plan' }).waitFor();
        await page.getByText('Shared project control', { exact: true }).waitFor();
        await page.getByText('Read-only source workspaces remain separate from project-control edits.').waitFor();
        await page.getByRole('button').filter({ hasText: 'Project Work Plan' }).click();

        const fullSchedule = page.getByRole('tab', { name: /Full Schedule/ });
        await fullSchedule.waitFor();
        assert.equal(await fullSchedule.getAttribute('aria-selected'), 'true');
        await page.getByText('Aug 2026', { exact: true }).waitFor();

        await page.getByRole('button', { name: 'Full screen' }).click();
        const fullScreenSchedule = page.getByLabel('Full-screen project schedule');
        await fullScreenSchedule.waitFor();
        const fullScreenLayout = await fullScreenSchedule.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            return {
                position: getComputedStyle(element).position,
                width: Math.round(bounds.width),
                height: Math.round(bounds.height),
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
            };
        });
        assert.equal(fullScreenLayout.position, 'fixed');
        assert.equal(fullScreenLayout.width, fullScreenLayout.viewportWidth);
        assert.equal(fullScreenLayout.height, fullScreenLayout.viewportHeight);

        const moveTask = page.getByRole('button', { name: /^Move 1\.02 / });
        const moveBounds = await moveTask.boundingBox();
        assert.ok(moveBounds, 'The first task bar should have a draggable body.');
        await page.mouse.move(moveBounds.x + moveBounds.width / 2, moveBounds.y + moveBounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(moveBounds.x + moveBounds.width / 2 + 24, moveBounds.y + moveBounds.height / 2, { steps: 6 });
        await page.mouse.up();
        await page.getByText(/1\.02 moved to Aug 10, 2026 - Sep 7, 2026/).waitFor();

        const resizeFinish = page.getByTestId('timeline-end-1.02');
        const finishBounds = await resizeFinish.boundingBox();
        assert.ok(finishBounds, 'The task bar should expose a finish resize handle.');
        await page.mouse.move(finishBounds.x + finishBounds.width / 2, finishBounds.y + finishBounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(finishBounds.x + finishBounds.width / 2 + 24, finishBounds.y + finishBounds.height / 2, { steps: 6 });
        await page.mouse.up();
        await page.getByText(/1\.02 finish resized to Aug 10, 2026 - Sep 14, 2026/).waitFor();

        mkdirSync('output/playwright', { recursive: true });
        await page.screenshot({ path: 'output/playwright/strategic-workplan-drag-fullscreen.png', fullPage: false });
        await page.getByRole('button', { name: 'Exit full screen' }).click();

        await page.getByRole('button', { name: /^Edit 1\.01 / }).click();
        const dialog = page.getByRole('dialog', { name: /Edit task 1\.01/ });
        await dialog.waitFor();
        await dialog.getByLabel('Task name').fill('Project Initiation Meeting – reviewed');
        await dialog.getByLabel('Status').selectOption('in-progress');
        await dialog.getByRole('button', { name: 'Close task editor' }).click();
        await page.getByText('Unsaved changes', { exact: true }).waitFor();

        await page.getByRole('button', { name: 'Publish baseline' }).click();
        await page.getByText('Shared revision 1 saved by Browser Planner.').waitFor();
        await page.getByRole('button', { name: /History/ }).click();
        await page.getByText('Revision 1 · Browser Planner').waitFor();
        await page.getByText(/Published proposal baseline with 73 tasks and changed 2 tasks across 5 fields/).waitFor();

        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('button', { name: /^Edit 1\.01 / }).click();
        await page.getByRole('dialog', { name: /Edit task 1\.01/ }).waitFor();
        const noPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        assert.equal(noPageOverflow, true, 'The narrow-screen page should not overflow horizontally.');

        await page.screenshot({ path: 'output/playwright/strategic-workplan-hardened-mobile.png', fullPage: true });
        assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(' | ')}`);
        console.log('Strategic Work Plan browser smoke passed.');
    } finally {
        if (browser) await browser.close();
        stopServer(server);
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
