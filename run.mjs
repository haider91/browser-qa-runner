// Browser QA runner: opens every URL of a job in headless Chromium and writes one result item per page.
// Items have the same shape as the Apify playwright-scraper dataset used before (failures carry
// "#error" and "#debug.errorMessages"), so callers can switch provider without changing their analysis.
//
//   node run.mjs --job job.json [--out results.json]
//   QA_JOB='{"urls":[...]}' node run.mjs --out results.json

import { chromium } from 'playwright';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { attachQa } from './src/qa-hooks.js';
import { checkPage } from './src/check-page.js';
import { robotsAllowed } from './src/robots.js';

const DEFAULTS = {
  concurrency: 5,       // more overloaded a Cloudflare + Laravel origin in testing
  navTimeoutMs: 45000,  // until DOMContentLoaded; beyond this the page counts as "failed to open"
  loadWaitMs: 12000,    // then up to this long for the full "load" event (beyond = reported as slow)
  settleMs: 2000,       // extra wait after "load" for dynamic content
  retries: 1,           // extra attempts for a page that failed to open
  blockHosts: [],
  respectRobotsTxt: true,
  maxPages: 1000,
  userAgent: null,      // null = the browser's own UA without "Headless"
};
const MAX_CONCURRENCY = 10;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

function errMsg(e) {
  return String((e && e.message) || e).split('\n')[0].slice(0, 500);
}

async function loadJob() {
  const file = arg('--job');
  const raw = file ? await readFile(file, 'utf8') : process.env.QA_JOB;
  if (!raw) throw new Error('No job: pass --job <file> or set QA_JOB');
  const job = { ...DEFAULTS, ...JSON.parse(raw) };
  if (!Array.isArray(job.urls) || job.urls.length === 0) throw new Error('Job has no "urls"');
  job.urls = [...new Set(job.urls.map(String).filter((u) => /^https?:\/\//i.test(u)))].slice(0, job.maxPages);
  job.concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(job.concurrency) || 1));
  return job;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function visit(browser, url, job, userAgent) {
  const errorMessages = [];
  for (let attempt = 0; attempt <= job.retries; attempt++) {
    const context = await browser.newContext({ userAgent });
    try {
      const page = await context.newPage();
      const qa = await attachQa(page, job);
      // Navigation only waits for the DOM; checkPage then waits for "load" with its own limit,
      // so a page with slow resources is reported as slow instead of "failed to open".
      // networkidle is not used: it hangs on pages with open connections.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: job.navTimeoutMs });
      return await withTimeout(checkPage(page, qa, url, job), job.loadWaitMs + job.settleMs + 30000, 'Page check timed out');
    } catch (e) {
      errorMessages.push(errMsg(e));
    } finally {
      await context.close().catch(() => {});
    }
  }
  return { url, '#error': true, '#debug': { url, errorMessages } };
}

async function main() {
  const startedAt = new Date();
  const job = await loadJob();
  const out = arg('--out') || 'results.json';
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const browser = await chromium.launch({ headless: true });
  let userAgent = job.userAgent;
  if (!userAgent) {
    const probe = await browser.newPage();
    userAgent = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
    await probe.close();
  }

  const items = [];
  const skipped = [];
  let next = 0;
  let done = 0;
  const total = job.urls.length;
  console.log(`Job ${job.jobId || '-'}: ${total} pages, concurrency ${job.concurrency}`);

  async function worker() {
    while (next < total) {
      const url = job.urls[next++];
      const t0 = Date.now();
      if (job.respectRobotsTxt && !(await robotsAllowed(url, userAgent))) {
        skipped.push({ url, reason: 'Disallowed by robots.txt' });
        console.log(`[${++done}/${total}] robots ${url}`);
        continue;
      }
      const item = await visit(browser, url, job, userAgent);
      items.push(item);
      const state = item['#error'] ? 'FAIL' : `ok ${item.nav ? item.nav.status : '-'}`;
      console.log(`[${++done}/${total}] ${state} ${((Date.now() - t0) / 1000).toFixed(1)}s ${url}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(job.concurrency, total) }, worker));
  await browser.close();

  const failed = items.filter((it) => it['#error']).length;
  const finishedAt = new Date();
  const result = {
    status: 'completed',
    jobId: job.jobId || null,
    runUrl,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSecs: Math.round((finishedAt - startedAt) / 1000),
    counts: { requested: total, returned: items.length - failed, failed, skipped: skipped.length },
    userAgent,
    skipped,
    items,
  };
  await writeFile(out, JSON.stringify(result));
  console.log(`Done in ${result.durationSecs}s: ${result.counts.returned} ok, ${failed} failed, ${skipped.length} skipped -> ${out}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### Browser QA\n\n| Requested | OK | Failed | Skipped | Duration |\n|---|---|---|---|---|\n`
      + `| ${total} | ${result.counts.returned} | ${failed} | ${skipped.length} | ${result.durationSecs}s |\n`);
  }
}

main().catch((e) => {
  console.error('Runner failed: ' + errMsg(e));
  process.exit(1);
});
