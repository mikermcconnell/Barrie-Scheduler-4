import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4300 + Math.floor(Math.random() * 500);
const SERVER_START_TIMEOUT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs, child) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 304) {
        return;
      }
      lastError = new Error(`Server responded with status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

function startPreviewServer() {
  const command = `npm run preview -- --host ${HOST} --port ${PORT} --strictPort`;
  const child = spawn(command, {
    env: process.env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    logs += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    logs += text;
    process.stderr.write(text);
  });

  return {
    child,
    getLogs: () => logs,
  };
}

function stopPreviewServer(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      return;
    } catch {
      // Fall through to best-effort kill below.
    }
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // Best-effort cleanup only.
  }
}

async function assertVisible(locator, description) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await locator.isVisible(), true, `${description} should be visible`);
}

function cardByTitle(page, title) {
  return page.locator('button').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  }).first();
}

async function runSmoke() {
  const server = startPreviewServer();
  let browser;
  const baseUrl = `http://${HOST}:${PORT}`;

  try {
    await waitForServer(baseUrl, SERVER_START_TIMEOUT_MS, server.child);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

    console.log(`\n[smoke] Opening ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await assertVisible(page.getByRole('heading', { name: 'Select Workspace' }), 'Home heading');
    await assertVisible(cardByTitle(page, 'Transit On-Demand'), 'Transit On-Demand card');
    await assertVisible(cardByTitle(page, 'Scheduled Transit'), 'Scheduled Transit card');
    await assertVisible(cardByTitle(page, 'Dashboard & Reporting'), 'Dashboard & Reporting card');

    console.log('[smoke] Opening Scheduled Transit workspace');
    await cardByTitle(page, 'Scheduled Transit').click();
    await page.waitForURL(/#fixed$/, { timeout: 10_000 });
    await assertVisible(page.getByRole('heading', { name: 'Fixed Route Operations' }), 'Fixed Route dashboard heading');
    await assertVisible(cardByTitle(page, 'Master Schedule'), 'Master Schedule card');
    await assertVisible(cardByTitle(page, 'Timetable Publisher'), 'Timetable Publisher card');
    await page.getByRole('button', { name: /Back to Main/i }).click();
    await page.waitForURL((url) => !url.hash, { timeout: 10_000 });
    await assertVisible(page.getByRole('heading', { name: 'Select Workspace' }), 'Home heading after leaving fixed workspace');

    console.log('[smoke] Opening Transit On-Demand workspace');
    await cardByTitle(page, 'Transit On-Demand').click();
    await page.waitForURL(/#ondemand$/, { timeout: 10_000 });
    await assertVisible(page.getByText('Manage Master Schedules vs. MVT Driver Shifts', { exact: true }), 'On-Demand workspace subtitle');
    await assertVisible(page.getByRole('button', { name: /Overview & Metrics/i }), 'Overview & Metrics tab');
    await assertVisible(page.getByRole('button', { name: /Optimization Rules/i }), 'Optimization Rules tab');
    await page.getByRole('button', { name: /Back to Main/i }).click();
    await page.waitForURL((url) => !url.hash, { timeout: 10_000 });
    await assertVisible(page.getByRole('heading', { name: 'Select Workspace' }), 'Home heading after leaving on-demand workspace');

    console.log('[smoke] Opening Operations workspace');
    await cardByTitle(page, 'Dashboard & Reporting').click();
    await page.waitForURL(/#operations$/, { timeout: 10_000 });
    await assertVisible(page.getByRole('heading', { name: 'Dashboard & Reporting' }), 'Operations dashboard heading');
    await assertVisible(cardByTitle(page, 'Operations Dashboard'), 'Operations Dashboard card');
    await assertVisible(cardByTitle(page, 'STREETS Reports'), 'STREETS Reports card');
    await page.getByRole('button', { name: /Back to Main/i }).click();
    await page.waitForURL((url) => !url.hash, { timeout: 10_000 });
    await assertVisible(page.getByRole('heading', { name: 'Select Workspace' }), 'Home heading after leaving operations workspace');

    console.log('[smoke] Verifying direct hash load for Scheduled Transit');
    await page.goto(`${baseUrl}/#fixed`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/#fixed$/, { timeout: 10_000 });
    await assertVisible(page.getByRole('heading', { name: 'Fixed Route Operations' }), 'Fixed Route heading on direct hash load');

    console.log('\n[smoke] Browser smoke passed.');
  } catch (error) {
    const logs = server.getLogs().trim();
    if (logs) {
      console.error('\n[smoke] Preview server output:');
      console.error(logs);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    stopPreviewServer(server.child);
  }
}

runSmoke().catch((error) => {
  console.error('\n[smoke] Browser smoke failed.');
  console.error(error);
  process.exitCode = 1;
});
