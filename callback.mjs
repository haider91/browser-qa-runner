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
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-qa-secret': process.env.CALLBACK_SECRET || '' },
      body,
      signal: AbortSignal.timeout(60000),
    });
    console.log(`Callback attempt ${attempt}: HTTP ${res.status}`);
    if (res.ok) process.exit(0);
    if (res.status < 500 && res.status !== 429) break;
  } catch (e) {
    console.log(`Callback attempt ${attempt} failed: ${String((e && e.message) || e).slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, attempt * 10000));
}
process.exit(1);
