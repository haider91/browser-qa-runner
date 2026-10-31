// Posts the results file to CALLBACK_URL (e.g. an n8n Wait node resume URL).
// Runs after run.mjs even when it failed, so the caller never waits for a run that died:
// without a results file it posts { status: "failed" } with a link to the run log.
//
//   CALLBACK_URL=... CALLBACK_SECRET=... node callback.mjs [results.json]

import { readFile } from 'node:fs/promises';

const url = process.env.CALLBACK_URL;
const file = process.argv[2] || 'results.json';
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

if (!url) {
  console.log('No callback URL, nothing to send');
  process.exit(0);
}

let body;
try {
  body = await readFile(file, 'utf8');
} catch (e) {
  body = JSON.stringify({
    status: 'failed',
    jobId: process.env.JOB_ID || null,
    runUrl,
    reason: 'The browser runner produced no results (see the GitHub Actions run log)',
  });
}

// The URL itself is never printed: it lets anyone resume the waiting workflow.
// n8n answers 409 while the execution is still being saved before it waits ("is running already"), so 409,
// 429, 5xx and network errors are retried for about 10 minutes. Other 4xx (bad secret, unknown or finished
// execution) will not change by retrying.
const MAX_ATTEMPTS = 20;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-qa-secret': process.env.CALLBACK_SECRET || '' },
      body,
      signal: AbortSignal.timeout(60000),
    });
    const detail = res.ok ? '' : ` ${(await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`;
    console.log(`Callback attempt ${attempt}: HTTP ${res.status}${detail}`);
    if (res.ok) process.exit(0);
    if (res.status < 500 && res.status !== 429 && res.status !== 409) break;
  } catch (e) {
    console.log(`Callback attempt ${attempt} failed: ${String((e && e.message) || e).slice(0, 200)}`);
  }
  if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 30000));
}
process.exit(1);
