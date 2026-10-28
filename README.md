# browser-qa-runner

Real-browser QA for a list of pages, run on GitHub Actions. Each page is opened in headless Chromium and
checked for console errors, uncaught exceptions, unhandled promise rejections, failed requests and 4xx/5xx
resources, broken images, loaders still visible, blank pages, and TTFB / FCP / LCP / CLS.

The runner is generic: the caller sends the URLs and options, and receives the results by callback.
It is used by the n8n "Website QA Monitor" workflows as a free replacement for an Apify actor. The result
items keep the Apify playwright-scraper dataset shape.

## Start a run (API)

Use a fine-grained token with **Actions: Read and write** on this repository only.

```http
POST https://api.github.com/repos/haider91/browser-qa-runner/actions/workflows/browser-qa.yml/dispatches
Authorization: Bearer <token>
Accept: application/vnd.github+json

{
  "ref": "main",
  "inputs": {
    "job": "{\"urls\":[\"https://example.com/\"],\"concurrency\":5}",
    "callback_url": "https://n8n.example.com/webhook-waiting/...",
    "job_id": "site-2026-11"
  }
}
```

GitHub answers `204` and the run starts. When it ends, `callback.mjs` POSTs the results JSON to
`callback_url` with the header `x-qa-secret: <CALLBACK_SECRET>` (repository secret). If the run fails, the
callback receives `{ "status": "failed", "reason": ..., "runUrl": ... }` instead.

## Job options

| Field | Default | |
|---|---|---|
| `urls` | required | Pages to open (http/https, duplicates removed) |
| `jobId` | `null` | Echoed back in the results |
| `concurrency` | `5` | Pages open at the same time (max 10) |
| `navTimeoutMs` | `45000` | Until DOMContentLoaded; beyond = page failed to open |
| `loadWaitMs` | `12000` | Then up to this long for the `load` event (beyond = `loadTimedOut`) |
| `settleMs` | `2000` | Extra wait after `load` for late scripts |
| `retries` | `1` | Extra attempts for a page that failed to open |
| `blockHosts` | `[]` | Hosts not loaded (e.g. video, ads, analytics) |
| `respectRobotsTxt` | `true` | Skip pages disallowed for `User-agent: *` |
| `maxPages` | `1000` | Cap on `urls` |
| `userAgent` | browser UA | Default: Chromium's UA without "Headless" |

## Results

```json
{
  "status": "completed", "jobId": "...", "runUrl": "...", "durationSecs": 312,
  "counts": { "requested": 210, "returned": 207, "failed": 3, "skipped": 0 },
  "skipped": [{ "url": "...", "reason": "Disallowed by robots.txt" }],
  "items": [
    { "url": "...", "loadedUrl": "...", "nav": { "status": 200 }, "loadTimedOut": false,
      "consoleErrors": [], "consoleWarnings": 0, "pageErrors": [], "failedRequests": [], "badResponses": [],
      "title": "...", "textLength": 5120, "h1Count": 1, "hasMain": true, "loaderVisible": [],
      "brokenImages": [], "links": [], "perf": { "ttfb": 180, "fcp": 900, "lcp": 1400, "cls": 0.01 } },
    { "url": "...", "#error": true, "#debug": { "errorMessages": ["page.goto: Timeout 45000ms exceeded."] } }
  ]
}
```

## Run locally

```bash
npm ci
npx playwright install chromium
node run.mjs --job examples/job.json --out results.json
```

## Security

This repository is public, and so are its run logs. Inputs are passed to scripts only through environment
variables, the callback URL is masked, and results go to the callback only (no artifacts). Logs list the
URLs checked and a status per page, nothing else.
