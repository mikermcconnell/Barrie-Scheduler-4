import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 4700 + Math.floor(Math.random() * 300);
const SERVER_START_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1920, height: 1080 };
const DELIVERY_MAX_BYTES = 10 * 1024 * 1024;
const DELIVERY_BITRATE = '900k';
const DELIVERY_SECONDS = 60;
const TIME_SCALE = Number(process.env.DEMO_TIME_SCALE ?? '0.25');
const STAGING_TIMEOUT_MS = TIME_SCALE < 1 ? 5_000 : 30_000;
const OUTPUT_DIR = path.resolve('output', 'demo', 'transit-on-demand');
const FRAME_DIR = path.join(OUTPUT_DIR, 'frames');
const RAW_VIDEO_PATH = path.join(OUTPUT_DIR, 'transit-on-demand-demo-raw.webm');
const DELIVERY_VIDEO_PATH = path.join(OUTPUT_DIR, 'transit-on-demand-demo-60s.webm');
const MASTER_FIXTURE_PATH = path.resolve(
  'demo',
  'fixtures',
  'Barrie_TOD_Demo_Schedule_Master.csv',
);
const SHIFTS_FIXTURE_PATH = path.resolve(
  'demo',
  'fixtures',
  'Barrie_TOD_Demo_Contractor_Shifts.csv',
);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const hold = (ms) => sleep(Math.max(25, Math.round(ms * TIME_SCALE)));

async function waitForServer(url, timeoutMs, child) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 304) return;
      lastError = new Error(`Server responded with status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(400);
  }

  throw new Error(
    `Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`,
  );
}

async function openOnDemandWorkspace(page, baseUrl) {
  await page.goto(`${baseUrl}/demo/on-demand-capture.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByText('Manage Master Schedules vs. MVT Driver Shifts', { exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.onDemandCaptureFileBridge === 'ready',
    null,
    { timeout: 15_000 },
  );
}

function startPreviewServer() {
  const command = `npm run dev -- --host ${HOST} --port ${PORT} --strictPort`;
  const child = spawn(command, {
    env: process.env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let logs = '';
  child.stdout.on('data', chunk => {
    const output = chunk.toString();
    logs += output;
    process.stdout.write(output);
  });
  child.stderr.on('data', chunk => {
    const output = chunk.toString();
    logs += output;
    process.stderr.write(output);
  });

  return { child, getLogs: () => logs };
}

function stopPreviewServer(child) {
  if (!child || child.killed) return;

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
      return;
    } catch {
      // Fall through to best-effort termination.
    }
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // Best-effort cleanup only.
  }
}

function findPlaywrightFfmpeg() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const browsersPath = path.join(localAppData, 'ms-playwright');
  if (!existsSync(browsersPath)) return null;

  const ffmpegFolders = readdirSync(browsersPath)
    .filter(name => name.startsWith('ffmpeg-'))
    .sort()
    .reverse();

  for (const folder of ffmpegFolders) {
    const candidate = path.join(browsersPath, folder, 'ffmpeg-win64.exe');
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

async function installDemoOverlay(page) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'tod-demo-overlay-style';
    style.textContent = `
      #tod-demo-title,
      #tod-demo-caption,
      #tod-demo-progress,
      #tod-demo-highlight,
      #tod-demo-disclaimer {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        box-sizing: border-box;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #tod-demo-title {
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 18px;
        color: #111827;
        background:
          radial-gradient(circle at 20% 20%, rgba(24, 144, 255, 0.18), transparent 34%),
          radial-gradient(circle at 80% 78%, rgba(16, 185, 129, 0.16), transparent 30%),
          #f8fafc;
        opacity: 1;
        transition: opacity 500ms ease;
      }

      #tod-demo-title[data-hidden="true"] {
        opacity: 0;
      }

      #tod-demo-title .eyebrow {
        color: #0369a1;
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.22em;
        text-transform: uppercase;
      }

      #tod-demo-title h1 {
        max-width: 1200px;
        margin: 0;
        text-align: center;
        font-size: 66px;
        line-height: 1.04;
        letter-spacing: -0.04em;
      }

      #tod-demo-title p {
        max-width: 980px;
        margin: 0;
        color: #475569;
        text-align: center;
        font-size: 30px;
        font-weight: 650;
        line-height: 1.35;
      }

      #tod-demo-caption {
        left: 50%;
        bottom: 34px;
        width: min(1320px, calc(100vw - 96px));
        min-height: 112px;
        padding: 22px 34px;
        border: 1px solid rgba(148, 163, 184, 0.7);
        border-radius: 24px;
        color: #0f172a;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
        backdrop-filter: blur(18px);
        transform: translate(-50%, 20px);
        opacity: 0;
        transition: opacity 280ms ease, transform 280ms ease;
      }

      #tod-demo-caption[data-visible="true"] {
        transform: translate(-50%, 0);
        opacity: 1;
      }

      #tod-demo-caption .kicker {
        margin-bottom: 6px;
        color: #0369a1;
        font-size: 17px;
        font-weight: 850;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      #tod-demo-caption .copy {
        font-size: 29px;
        font-weight: 760;
        line-height: 1.25;
        letter-spacing: -0.015em;
      }

      #tod-demo-progress {
        top: 0;
        left: 0;
        width: 100vw;
        height: 8px;
        background: rgba(226, 232, 240, 0.9);
      }

      #tod-demo-progress::after {
        content: "";
        display: block;
        width: var(--demo-progress, 0%);
        height: 100%;
        background: linear-gradient(90deg, #0284c7, #10b981);
        transition: width 350ms ease;
      }

      #tod-demo-highlight {
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        border: 5px solid #0284c7;
        border-radius: 20px;
        box-shadow:
          0 0 0 7px rgba(255, 255, 255, 0.9),
          0 0 0 12px rgba(2, 132, 199, 0.25),
          0 20px 60px rgba(15, 23, 42, 0.2);
        opacity: 0;
        transition:
          top 320ms ease,
          left 320ms ease,
          width 320ms ease,
          height 320ms ease,
          opacity 220ms ease;
      }

      #tod-demo-highlight[data-visible="true"] {
        opacity: 1;
      }

      #tod-demo-disclaimer {
        top: 24px;
        right: 28px;
        padding: 10px 16px;
        border: 1px solid rgba(203, 213, 225, 0.9);
        border-radius: 999px;
        color: #475569;
        background: rgba(255, 255, 255, 0.92);
        font-size: 15px;
        font-weight: 750;
        letter-spacing: 0.02em;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
      }
    `;
    document.head.appendChild(style);

    const title = document.createElement('div');
    title.id = 'tod-demo-title';
    title.innerHTML = `
      <div class="eyebrow">Barrie Transit</div>
      <h1>Transit On-Demand Schedule Planning</h1>
      <p>Compare required service with contractor shifts, identify a gap, and test an adjustment.</p>
    `;

    const caption = document.createElement('div');
    caption.id = 'tod-demo-caption';
    caption.innerHTML = '<div class="kicker"></div><div class="copy"></div>';

    const progress = document.createElement('div');
    progress.id = 'tod-demo-progress';

    const highlight = document.createElement('div');
    highlight.id = 'tod-demo-highlight';

    const disclaimer = document.createElement('div');
    disclaimer.id = 'tod-demo-disclaimer';
    disclaimer.textContent = 'Illustrative data · No customer or driver information';

    document.body.append(title, caption, progress, highlight, disclaimer);
  });
}

async function hideTitle(page) {
  await page.evaluate(() => {
    const title = document.querySelector('#tod-demo-title');
    if (title instanceof HTMLElement) {
      title.dataset.hidden = 'true';
      setTimeout(() => title.remove(), 600);
    }
  });
  await sleep(650);
}

async function showTitle(page, heading, copy, eyebrow = 'Barrie Transit') {
  await page.evaluate(
    ({ heading, copy, eyebrow }) => {
      let title = document.querySelector('#tod-demo-title');
      if (!(title instanceof HTMLElement)) {
        title = document.createElement('div');
        title.id = 'tod-demo-title';
        document.body.appendChild(title);
      }

      title.innerHTML = `
        <div class="eyebrow"></div>
        <h1></h1>
        <p></p>
      `;
      title.querySelector('.eyebrow').textContent = eyebrow;
      title.querySelector('h1').textContent = heading;
      title.querySelector('p').textContent = copy;
      title.dataset.hidden = 'false';

      const caption = document.querySelector('#tod-demo-caption');
      if (caption instanceof HTMLElement) caption.dataset.visible = 'false';
      const highlight = document.querySelector('#tod-demo-highlight');
      if (highlight instanceof HTMLElement) highlight.dataset.visible = 'false';
    },
    { heading, copy, eyebrow },
  );
}

async function narrate(page, kicker, copy, progress) {
  await page.evaluate(
    ({ kicker, copy, progress }) => {
      const caption = document.querySelector('#tod-demo-caption');
      const progressBar = document.querySelector('#tod-demo-progress');
      if (!(caption instanceof HTMLElement)) return;

      const kickerElement = caption.querySelector('.kicker');
      const copyElement = caption.querySelector('.copy');
      if (kickerElement) kickerElement.textContent = kicker;
      if (copyElement) copyElement.textContent = copy;
      caption.dataset.visible = 'true';

      if (progressBar instanceof HTMLElement) {
        progressBar.style.setProperty('--demo-progress', `${progress}%`);
      }
    },
    { kicker, copy, progress },
  );
}

async function spotlight(page, locator, padding = 14) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(350);
  const box = await locator.boundingBox();
  assert(box, 'Could not resolve the demo highlight target');

  await page.evaluate(
    ({ box, padding }) => {
      const highlight = document.querySelector('#tod-demo-highlight');
      if (!(highlight instanceof HTMLElement)) return;

      highlight.style.left = `${Math.max(8, box.x - padding)}px`;
      highlight.style.top = `${Math.max(8, box.y - padding)}px`;
      highlight.style.width = `${Math.min(
        window.innerWidth - Math.max(8, box.x - padding) - 8,
        box.width + padding * 2,
      )}px`;
      highlight.style.height = `${Math.min(
        window.innerHeight - Math.max(8, box.y - padding) - 8,
        box.height + padding * 2,
      )}px`;
      highlight.dataset.visible = 'true';
    },
    { box, padding },
  );
}

async function clearSpotlight(page) {
  await page.evaluate(() => {
    const highlight = document.querySelector('#tod-demo-highlight');
    if (highlight instanceof HTMLElement) highlight.dataset.visible = 'false';
  });
}

async function stageFixtureFile(page, filePath) {
  const name = path.basename(filePath);
  await page.evaluate(
    async ({ name }) => {
      const response = await fetch(`/demo/fixtures/${encodeURIComponent(name)}`);
      if (!response.ok) {
        throw new Error(`Unable to load demo fixture ${name}: ${response.status}`);
      }

      const content = await response.text();
      const file = new File([content], name, { type: 'text/csv' });
      window.dispatchEvent(new CustomEvent('tod-demo-stage-files', {
        detail: [file],
      }));
    },
    { name },
  );
}

async function captureFrame(page, name) {
  await page.screenshot({
    path: path.join(FRAME_DIR, `${name}.png`),
    animations: 'disabled',
  });
}

async function transcodeDeliveryVideo(storyStartOffsetSeconds) {
  const ffmpeg = findPlaywrightFfmpeg();
  if (!ffmpeg) {
    copyFileSync(RAW_VIDEO_PATH, DELIVERY_VIDEO_PATH);
    return { transcoded: false, ffmpeg: null };
  }

  await execFileAsync(ffmpeg, [
    '-y',
    '-ss',
    String(Math.max(0, storyStartOffsetSeconds - 0.2)),
    '-i',
    RAW_VIDEO_PATH,
    '-t',
    String(DELIVERY_SECONDS),
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop_duration=60',
    '-an',
    '-c:v',
    'libvpx',
    '-b:v',
    DELIVERY_BITRATE,
    '-deadline',
    'good',
    '-cpu-used',
    '4',
    DELIVERY_VIDEO_PATH,
  ]);

  return { transcoded: true, ffmpeg };
}

async function runDemoCapture() {
  mkdirSync(FRAME_DIR, { recursive: true });

  for (const fixture of [MASTER_FIXTURE_PATH, SHIFTS_FIXTURE_PATH]) {
    assert(existsSync(fixture), `Missing demo fixture: ${fixture}`);
  }

  const server = startPreviewServer();
  let browser;
  let context;
  const baseUrl = `http://${HOST}:${PORT}`;

  try {
    await waitForServer(baseUrl, SERVER_START_TIMEOUT_MS, server.child);

    browser = await chromium.launch({ headless: true });

    const warmupPage = await browser.newPage({ viewport: VIEWPORT });
    await openOnDemandWorkspace(warmupPage, baseUrl);
    await warmupPage.close();

    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: {
        dir: OUTPUT_DIR,
        size: VIEWPORT,
      },
    });
    const recordingStartedAt = Date.now();
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        console.log(`[demo browser ${message.type()}] ${message.text()}`);
      }
    });
    page.on('pageerror', error => {
      console.log(`[demo browser pageerror] ${error.message}`);
    });
    const video = page.video();

    await openOnDemandWorkspace(page, baseUrl);

    await installDemoOverlay(page);
    const storyStartOffsetSeconds = (Date.now() - recordingStartedAt) / 1000;
    await captureFrame(page, '00-title');
    await hold(3_200);
    await hideTitle(page);

    const dismissSampleButton = page.getByTitle('Dismiss sample data notice');
    if (await dismissSampleButton.isVisible().catch(() => false)) {
      await dismissSampleButton.click();
    }

    const uploadDropzone = page.getByRole('heading', {
      name: 'Drop Schedule Files Here',
      exact: true,
    });
    const uploadSurface = uploadDropzone.locator(
      'xpath=ancestor::div[input[@type="file"]][1]',
    );
    await narrate(
      page,
      'Start a schedule',
      'Begin with the service Barrie needs to provide.',
      8,
    );
    await spotlight(page, uploadSurface, 16);
    await captureFrame(page, '01-empty-upload');
    await hold(2_800);

    await stageFixtureFile(page, MASTER_FIXTURE_PATH);
    await page.waitForFunction(
      () => {
        const heading = Array.from(document.querySelectorAll('h3'))
          .find(element => element.textContent?.trim() === 'Master Demand');
        return Boolean(heading?.parentElement?.innerText.match(/\b(?!0(?:\.0)?h\b)\d+(?:\.\d+)?h\b/));
      },
      null,
      { timeout: STAGING_TIMEOUT_MS },
    );
    const masterDemandCard = page
      .getByRole('heading', { name: 'Master Demand', exact: true })
      .locator('..');
    await narrate(
      page,
      'Add service requirements',
      'The requirements file establishes the number of vehicles needed in each zone throughout the weekday.',
      18,
    );
    await spotlight(page, masterDemandCard, 14);
    await captureFrame(page, '02-master-loaded');
    await hold(3_800);

    await spotlight(page, uploadSurface, 16);
    await stageFixtureFile(page, SHIFTS_FIXTURE_PATH);
    const importPreviewHeading = page.getByRole('heading', {
      name: 'Review RideCo import before applying',
      exact: true,
    });
    await importPreviewHeading.waitFor({
      state: 'visible',
      timeout: STAGING_TIMEOUT_MS,
    });
    await narrate(
      page,
      'Add contractor shifts',
      'The workspace detects the contractor shifts and asks staff to review them before applying.',
      32,
    );
    await spotlight(page, importPreviewHeading.locator('..').locator('..'), 18);
    await captureFrame(page, '03-import-review');
    await hold(4_200);

    await page.getByRole('button', { name: 'Apply import', exact: true }).click();
    const gapHeading = page.getByRole('heading', {
      name: /Gap Analysis/,
    });
    await gapHeading.waitFor({ state: 'visible' });
    await gapHeading.scrollIntoViewIfNeeded();

    const southFilter = page.getByRole('button', {
      name: 'South',
      exact: true,
    });
    await southFilter.click();
    await narrate(
      page,
      'Identify the gap',
      'Back-to-back South shifts hide a 20-minute off-site changeoff gap.',
      49,
    );
    await spotlight(page, gapHeading.locator('..').locator('..'), 12);
    await captureFrame(page, '05-south-gap');
    await hold(6_500);

    const overviewTab = page.getByRole('button', {
      name: /Overview & Metrics/i,
    });
    await overviewTab.click();
    const coverageScoreHeading = page.getByRole('heading', {
      name: 'Coverage Score',
      exact: true,
    });
    await narrate(
      page,
      'Before',
      'The schedule covers less than 100 percent of the required service.',
      58,
    );
    await spotlight(page, coverageScoreHeading.locator('..').locator('..'), 12);
    await captureFrame(page, '06-coverage-before');
    await hold(3_800);

    const shiftEditorTab = page.getByRole('button', { name: /Shift Editor/i });
    await shiftEditorTab.click();
    const southShiftTwo = page.getByText('South Shift 2', { exact: true }).first();
    await southShiftTwo.waitFor({ state: 'visible' });
    await narrate(
      page,
      'Adjust one shift',
      'A planner can move the second South shift 30 minutes earlier to cover the service gap.',
      68,
    );
    await spotlight(page, southShiftTwo.locator('..').locator('..'), 12);
    await captureFrame(page, '07-shift-selected');
    await hold(3_500);
    await southShiftTwo.click();

    const startTimeInput = page.getByRole('textbox', {
      name: 'Shift start time',
      exact: true,
    });
    const endTimeInput = page.getByRole('textbox', {
      name: 'Shift end time',
      exact: true,
    });
    await startTimeInput.waitFor({ state: 'visible' });
    await spotlight(page, startTimeInput.locator('..').locator('..').locator('..'), 18);
    await hold(2_500);

    await startTimeInput.fill('10:45');
    await startTimeInput.press('Enter');
    await endTimeInput.fill('15:45');
    await endTimeInput.press('Enter');
    await narrate(
      page,
      'Test the change',
      'The preview updates immediately while the five-hour shift length stays unchanged.',
      78,
    );
    await clearSpotlight(page);
    await captureFrame(page, '08-shift-preview');
    await hold(5_500);

    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await gapHeading.scrollIntoViewIfNeeded();
    await narrate(
      page,
      'Gap resolved',
      'The adjusted contractor shift now covers the full South-zone requirement.',
      88,
    );
    await spotlight(page, gapHeading.locator('..').locator('..'), 12);
    await captureFrame(page, '09-gap-resolved');
    await hold(4_000);

    await overviewTab.click();
    await narrate(
      page,
      'After',
      'Coverage reaches 100 percent, with the planning decision still reviewed and controlled by staff.',
      95,
    );
    await spotlight(page, coverageScoreHeading.locator('..').locator('..'), 12);
    await captureFrame(page, '10-coverage-after');
    await hold(4_200);

    await showTitle(
      page,
      'Compare. Adjust. Review.',
      'Transit On-Demand schedule planning with clear, staff-controlled decisions.',
      'Barrie Transit · Illustrative demonstration',
    );
    await page.evaluate(() => {
      const progress = document.querySelector('#tod-demo-progress');
      if (progress instanceof HTMLElement) {
        progress.style.setProperty('--demo-progress', '100%');
      }
    });
    await captureFrame(page, '11-closing');
    await hold(15_000);

    await context.close();
    context = null;
    assert(video, 'Playwright did not create a recording');
    await video.saveAs(RAW_VIDEO_PATH);

    const transcode = await transcodeDeliveryVideo(storyStartOffsetSeconds);
    const deliverySize = statSync(DELIVERY_VIDEO_PATH).size;
    assert(
      deliverySize <= DELIVERY_MAX_BYTES,
      `Delivery video is ${(deliverySize / 1024 / 1024).toFixed(2)} MB, exceeding the 10 MB limit`,
    );

    console.log('\n[demo] Transit On-Demand capture complete.');
    console.log(`[demo] Raw: ${RAW_VIDEO_PATH}`);
    console.log(
      `[demo] Delivery: ${DELIVERY_VIDEO_PATH} (${(deliverySize / 1024 / 1024).toFixed(2)} MB)`,
    );
    console.log(
      `[demo] Encoding: ${transcode.transcoded ? `VP8 via ${transcode.ffmpeg}` : 'raw Playwright recording'}`,
    );
  } catch (error) {
    const logs = server.getLogs().trim();
    if (logs) {
      console.error('\n[demo] Preview server output:');
      console.error(logs);
    }
    throw error;
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    stopPreviewServer(server.child);
  }
}

runDemoCapture().catch(error => {
  console.error('\n[demo] Transit On-Demand capture failed.');
  console.error(error);
  process.exitCode = 1;
});
